import { getPool, sql } from '../../config/db.js';
import { DEFAULT_VISIT_FREQUENCY_DAYS } from './routePlannerConfig.js';

/**
 * Per-location visit scheduling.
 *
 * Visit Frequency (days) is the number of days between sales-rep visits to a
 * physical location. Last Visit Date is computed from the most recent completed
 * flyer drop / delivery to any doctor at that location; Next Visit Date =
 * Last Visit Date + Visit Frequency.
 */

export type LocationVisitInfo = {
  visitFrequencyDays: number;
  lastVisitDate: string | null; // YYYY-MM-DD
  nextVisitDate: string | null; // YYYY-MM-DD
  isDue: boolean;
};

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Saved per-location visit frequencies, keyed by LocationKey. Missing keys fall back to the default. */
export async function getLocationVisitFrequencies(
  locationKeys: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(locationKeys.filter(Boolean))];
  if (!unique.length) return out;

  const pool = await getPool();
  const request = pool.request();
  const params = unique.map((key, i) => {
    const name = `Key${i}`;
    request.input(name, sql.NVarChar, key);
    return `@${name}`;
  });

  const result = await request.query(`
    SELECT LocationKey, VisitFrequencyDays
    FROM dbo.PharmacyFlyer_LocationVisitV2
    WHERE LocationKey IN (${params.join(', ')})
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const days = Number(row.VisitFrequencyDays);
    if (Number.isFinite(days) && days > 0) {
      out.set(String(row.LocationKey), Math.floor(days));
    }
  }
  return out;
}

/** Upsert a location's visit frequency (days). */
export async function setLocationVisitFrequency(
  locationKey: string,
  visitFrequencyDays: number,
): Promise<{ locationKey: string; visitFrequencyDays: number }> {
  const days = Math.floor(Number(visitFrequencyDays));
  if (!locationKey || !Number.isFinite(days) || days <= 0) {
    throw new Error('Valid locationKey and positive visitFrequencyDays are required.');
  }

  const pool = await getPool();
  await pool.request()
    .input('LocationKey', sql.NVarChar, locationKey)
    .input('VisitFrequencyDays', sql.Int, days)
    .query(`
      MERGE dbo.PharmacyFlyer_LocationVisitV2 AS target
      USING (SELECT @LocationKey AS LocationKey) AS src
        ON target.LocationKey = src.LocationKey
      WHEN MATCHED THEN
        UPDATE SET VisitFrequencyDays = @VisitFrequencyDays, LastModifiedDate = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (LocationKey, VisitFrequencyDays) VALUES (@LocationKey, @VisitFrequencyDays);
    `);

  return { locationKey, visitFrequencyDays: days };
}

/**
 * Most recent completed visit date per doctor for a campaign, from completed
 * route-plan drops and delivered flyers. Returns a Map of doctorId -> YYYY-MM-DD.
 */
export async function getLastVisitDateByDoctor(
  campaignId: number,
  doctorIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(doctorIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) return out;

  const pool = await getPool();
  const request = pool.request().input('CampaignId', sql.Int, campaignId);
  const params = unique.map((id, i) => {
    const name = `Doc${i}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });
  const inList = params.join(', ');

  const result = await request.query(`
    SELECT DoctorId, MAX(LastVisitAt) AS LastVisitAt
    FROM (
      SELECT del.DoctorId AS DoctorId, del.SubmittedAt AS LastVisitAt
      FROM dbo.PharmacyFlyer_Delivery del
      WHERE del.CampaignId = @CampaignId
        AND del.DoctorId IN (${inList})
        AND ISNULL(del.FlyerDelivered, 1) = 1
      UNION ALL
      SELECT rd.DoctorId AS DoctorId, rd.CompletedAt AS LastVisitAt
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 rd
      WHERE rd.CampaignId = @CampaignId
        AND rd.DoctorId IN (${inList})
        AND rd.Status = 'completed'
        AND rd.CompletedAt IS NOT NULL
    ) visits
    GROUP BY DoctorId
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const iso = toIsoDate(row.LastVisitAt);
    if (iso) out.set(Number(row.DoctorId), iso);
  }
  return out;
}

/**
 * Most recent completed visit date per doctor across ALL campaigns (for location-based
 * visit scheduling on merged multi-campaign stops).
 */
export async function getLastVisitDateByDoctorsAllCampaigns(
  doctorIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(doctorIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) return out;

  const pool = await getPool();
  const request = pool.request();
  const params = unique.map((id, i) => {
    const name = `Doc${i}`;
    request.input(name, sql.Int, id);
    return `@${name}`;
  });
  const inList = params.join(', ');

  const result = await request.query(`
    SELECT DoctorId, MAX(LastVisitAt) AS LastVisitAt
    FROM (
      SELECT del.DoctorId AS DoctorId, del.SubmittedAt AS LastVisitAt
      FROM dbo.PharmacyFlyer_Delivery del
      WHERE del.DoctorId IN (${inList})
        AND ISNULL(del.FlyerDelivered, 1) = 1
      UNION ALL
      SELECT rd.DoctorId AS DoctorId, rd.CompletedAt AS LastVisitAt
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 rd
      WHERE rd.DoctorId IN (${inList})
        AND rd.Status = 'completed'
        AND rd.CompletedAt IS NOT NULL
    ) visits
    GROUP BY DoctorId
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const iso = toIsoDate(row.LastVisitAt);
    if (iso) out.set(Number(row.DoctorId), iso);
  }
  return out;
}

/**
 * Compute the visit schedule for one location given its frequency and the last
 * visit dates of its doctors. Last Visit = latest visit across the location's
 * doctors; Next Visit = Last Visit + frequency; due when next visit <= today (or never visited).
 */
export function computeLocationVisit(
  visitFrequencyDays: number,
  doctorLastVisitDates: (string | null)[],
  today = new Date().toISOString().slice(0, 10),
): LocationVisitInfo {
  const freq = Number.isFinite(visitFrequencyDays) && visitFrequencyDays > 0
    ? Math.floor(visitFrequencyDays)
    : DEFAULT_VISIT_FREQUENCY_DAYS;

  const validDates = doctorLastVisitDates.filter((d): d is string => Boolean(d));
  const lastVisitDate = validDates.length ? validDates.sort().slice(-1)[0] : null;
  const nextVisitDate = lastVisitDate ? addDays(lastVisitDate, freq) : null;
  // Never visited -> due now. Otherwise due once the next visit date has arrived.
  const isDue = nextVisitDate == null || nextVisitDate <= today;

  return { visitFrequencyDays: freq, lastVisitDate, nextVisitDate, isDue };
}
