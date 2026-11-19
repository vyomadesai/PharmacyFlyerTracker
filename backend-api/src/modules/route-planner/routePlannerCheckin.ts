import { getPool, sql } from '../../config/db.js';
import { buildLocationStopsForCampaign, type RouteLocationStop } from './routePlannerStops.js';
import { getCampaignCoverage } from './routePlannerMatching.js';
import { getRoutePlanById, saveRoutePlan } from './routePlannerPlans.js';
import { assignRoutePlan, clearAssignedRoutePlansForUserDate } from './routePlannerExecution.js';
import {
  computeLocationVisit,
  getLastVisitDateByDoctorsAllCampaigns,
  getLocationVisitFrequencies,
} from './routePlannerVisit.js';
import {
  DEFAULT_VISIT_FREQUENCY_DAYS,
  CHECK_IN_DISCOVERY_RADIUS_MILES,
} from './routePlannerConfig.js';
import { filterByRadius } from './routePlannerGeo.js';
import { toFloridaDateString } from '../../utils/timezone.js';
import {
  attachHoldsToSession,
  autoCloseOpenSessionsForUser,
  autoCloseStaleSessionsForUser,
  getActiveHeldLocationKeys,
  releaseHoldsForCheckIn,
  releaseHoldsForUserOnDate,
  tryClaimLocationHold,
} from './routePlannerLocationHold.js';
import { sortStopsByDistanceFromStart, applyDrivingDistancesFromCheckIn } from './routePlannerRoute.js';
import { appendCampaignNpiRegistryStops } from './routePlannerNpiStops.js';
import {
  appendMappedLocationStops,
  mergeStopsByLocationAndAddress,
} from './routePlannerMappedStops.js';
import { loadPracticeNameForRouteStop } from '../route-three/routeThreeEnrichment.js';

type ActiveCampaignRow = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  frequencyInDays: number | null;
};

async function loadAllActiveRoutePlannerCampaigns(): Promise<ActiveCampaignRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT
      c.CampaignId,
      c.CampaignName,
      c.FlyerTitle,
      COALESCE(c.FrequencyInDays, c.DefaultVisitFrequencyDays) AS FrequencyInDays
    FROM dbo.PharmacyFlyer_Campaign c
    INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      ON cs.CampaignId = c.CampaignId AND cs.IsActive = 1
    WHERE c.IsActive = 1
    ORDER BY c.CampaignName
  `);

  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    campaignId: Number(row.CampaignId),
    campaignName: String(row.CampaignName || ''),
    flyerTitle: row.FlyerTitle != null ? String(row.FlyerTitle) : null,
    frequencyInDays: row.FrequencyInDays != null ? Number(row.FrequencyInDays) : null,
  }));
}

function mergeStopsByLocationKey(stops: RouteLocationStop[]): RouteLocationStop[] {
  const byKey = new Map<string, RouteLocationStop>();

  for (const stop of stops) {
    const existing = byKey.get(stop.locationKey);
    if (!existing) {
      byKey.set(stop.locationKey, {
        ...stop,
        doctors: [...stop.doctors],
        flyers: [...stop.flyers],
      });
      continue;
    }

    for (const doctor of stop.doctors) {
      const dup = existing.doctors.some(
        (d) => d.doctorId === doctor.doctorId && d.matchedCampaignId === doctor.matchedCampaignId,
      );
      if (!dup) existing.doctors.push({ ...doctor });
    }
    existing.doctorCount = existing.doctors.length;

    for (const flyer of stop.flyers) {
      if (!existing.flyers.some((f) => f.campaignId === flyer.campaignId)) {
        existing.flyers.push({ ...flyer });
      }
    }
    existing.flyerCount = existing.flyers.length;

    if (
      stop.distanceMiles != null
      && (existing.distanceMiles == null || stop.distanceMiles < existing.distanceMiles)
    ) {
      existing.distanceMiles = stop.distanceMiles;
    }
    if (!existing.phone && stop.phone) existing.phone = stop.phone;
    if (!existing.latitude && stop.latitude) existing.latitude = stop.latitude;
    if (!existing.longitude && stop.longitude) existing.longitude = stop.longitude;
  }

  return [...byKey.values()];
}

async function applyLocationDueFilter(stops: RouteLocationStop[]): Promise<RouteLocationStop[]> {
  if (!stops.length) return [];

  const savedFrequencies = await getLocationVisitFrequencies(stops.map((s) => s.locationKey));
  const allDoctorIds = stops.flatMap((s) => s.doctors.map((d) => d.doctorId));
  const lastVisitByDoctor = await getLastVisitDateByDoctorsAllCampaigns(allDoctorIds);

  const withDue: RouteLocationStop[] = [];
  for (const stop of stops) {
    const freq = savedFrequencies.get(stop.locationKey) ?? stop.visitFrequencyDays ?? DEFAULT_VISIT_FREQUENCY_DAYS;
    const doctorDates = stop.doctors.map((d) => lastVisitByDoctor.get(d.doctorId) ?? null);
    const visit = computeLocationVisit(freq, doctorDates);
    const updated = {
      ...stop,
      visitFrequencyDays: visit.visitFrequencyDays,
      lastVisitDate: visit.lastVisitDate,
      nextVisitDate: visit.nextVisitDate,
      isDue: visit.isDue,
    };
    if (updated.isDue) withDue.push(updated);
  }
  return withDue;
}

async function logCheckIn(input: {
  userId: number;
  campaignId: number | null;
  routePlanId: number | null;
  lat: number;
  lng: number;
  radiusMiles: number;
  stopCount: number;
}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserId', sql.Int, input.userId)
    .input('CampaignId', sql.Int, input.campaignId)
    .input('RoutePlanId', sql.BigInt, input.routePlanId)
    .input('CheckInLat', sql.Decimal(10, 7), input.lat)
    .input('CheckInLng', sql.Decimal(10, 7), input.lng)
    .input('RadiusMiles', sql.Decimal(8, 2), input.radiusMiles)
    .input('StopCount', sql.Int, input.stopCount)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_RouteCheckInV2 (
        UserId, CampaignId, RoutePlanId, CheckInLat, CheckInLng, RadiusMiles, StopCount
      )
      OUTPUT INSERTED.RouteCheckInId
      VALUES (@UserId, @CampaignId, @RoutePlanId, @CheckInLat, @CheckInLng, @RadiusMiles, @StopCount)
    `);
  return Number(result.recordset[0]?.RouteCheckInId);
}

/** Mobile: all active route-planner campaigns with aggregate coverage progress. */
export async function listRepCampaigns(_userId: number) {
  const campaigns = await loadAllActiveRoutePlannerCampaigns();
  const result = [];

  for (const row of campaigns) {
    const coverage = await getCampaignCoverage(row.campaignId);
    result.push({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      flyerTitle: row.flyerTitle,
      frequencyInDays: row.frequencyInDays,
      total: coverage?.total ?? 0,
      covered: coverage?.covered ?? 0,
      remaining: coverage?.remaining ?? 0,
    });
  }
  return result;
}

/**
 * A new check-in builds a fresh plan. Stops this person already finished today
 * stay finished, so the route continues at the next open stop.
 */
async function restoreTodayProgress(userId: number, planDate: string, routePlanId: number) {
  const pool = await getPool();
  const columns = await pool.request().query(`
    SELECT
      COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'PracticeNameEntered') AS PracticeName,
      COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskOutcome') AS FrontDeskOutcome,
      COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'BestTimeToVisit') AS BestTimeToVisit,
      COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskContactName') AS FrontDeskContactName,
      COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskNote') AS FrontDeskNote
  `);
  const columnRow = (columns.recordset[0] || {}) as Record<string, unknown>;
  const extraSets = [
    columnRow.PracticeName != null
      ? 'PracticeNameEntered = COALESCE(NULLIF(LTRIM(RTRIM(prev.PracticeNameEntered)), \'\'), n.PracticeNameEntered)'
      : '',
    columnRow.FrontDeskOutcome != null
      ? 'FrontDeskOutcome = COALESCE(prev.FrontDeskOutcome, n.FrontDeskOutcome)'
      : '',
    columnRow.BestTimeToVisit != null
      ? 'BestTimeToVisit = COALESCE(prev.BestTimeToVisit, n.BestTimeToVisit)'
      : '',
    columnRow.FrontDeskContactName != null
      ? 'FrontDeskContactName = COALESCE(prev.FrontDeskContactName, n.FrontDeskContactName)'
      : '',
    columnRow.FrontDeskNote != null
      ? 'FrontDeskNote = COALESCE(prev.FrontDeskNote, n.FrontDeskNote)'
      : '',
  ].filter(Boolean);
  const extraSelect = [
    columnRow.PracticeName != null ? 's.PracticeNameEntered' : 'CAST(NULL AS NVARCHAR(300)) AS PracticeNameEntered',
    columnRow.FrontDeskOutcome != null ? 's.FrontDeskOutcome' : 'CAST(NULL AS NVARCHAR(40)) AS FrontDeskOutcome',
    columnRow.BestTimeToVisit != null ? 's.BestTimeToVisit' : 'CAST(NULL AS NVARCHAR(40)) AS BestTimeToVisit',
    columnRow.FrontDeskContactName != null ? 's.FrontDeskContactName' : 'CAST(NULL AS NVARCHAR(200)) AS FrontDeskContactName',
    columnRow.FrontDeskNote != null ? 's.FrontDeskNote' : 'CAST(NULL AS NVARCHAR(1000)) AS FrontDeskNote',
  ].join(',\n        ');

  await pool.request()
    .input('UserId', sql.Int, userId)
    .input('PlanDate', sql.Date, planDate)
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      UPDATE n
      SET
        Status = prev.Status,
        CompletedAt = prev.CompletedAt
        ${extraSets.length ? `,\n        ${extraSets.join(',\n        ')}` : ''}
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 n
      CROSS APPLY (
        SELECT TOP 1
          s.Status,
          s.CompletedAt,
          ${extraSelect}
        FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
        INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
        INNER JOIN dbo.PharmacyFlyer_RouteCheckInV2 ci ON ci.RoutePlanId = p.RoutePlanId
        WHERE ci.UserId = @UserId
          AND p.PlanDate = @PlanDate
          AND p.RoutePlanId <> @RoutePlanId
          AND s.Status IN ('completed', 'skipped')
          AND (
            s.LocationKey = n.LocationKey
            OR (
              UPPER(LTRIM(RTRIM(ISNULL(s.AddressStreet, '')))) = UPPER(LTRIM(RTRIM(ISNULL(n.AddressStreet, ''))))
              AND LEFT(REPLACE(ISNULL(s.AddressZip, ''), '-', ''), 5) = LEFT(REPLACE(ISNULL(n.AddressZip, ''), '-', ''), 5)
              AND LTRIM(RTRIM(ISNULL(s.AddressStreet, ''))) <> ''
            )
          )
        ORDER BY s.CompletedAt DESC
      ) prev
      WHERE n.RoutePlanId = @RoutePlanId
        AND ISNULL(n.Status, 'pending') NOT IN ('completed', 'skipped')
    `);

  await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      UPDATE d
      SET Status = n.Status, CompletedAt = n.CompletedAt
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 d
      INNER JOIN dbo.PharmacyFlyer_RoutePlanStopV2 n ON n.RoutePlanStopId = d.RoutePlanStopId
      WHERE n.RoutePlanId = @RoutePlanId
        AND n.Status IN ('completed', 'skipped')
        AND ISNULL(d.Status, 'pending') NOT IN ('completed', 'skipped')
    `);
}

/**
 * Start-of-day check-in: build ONE combined route from all active campaigns near the
 * rep's GPS. Includes configured (mapped) and unconfigured (unmapped) locations,
 * sorted by distance from check-in GPS, persists + assigns.
 */
export async function checkInRep(
  userId: number,
  lat: number,
  lng: number,
  _campaignId?: number | null,
) {
  const t0 = Date.now();
  const log = (label: string) => {
    console.log(`[checkin] ${label} (${Date.now() - t0}ms)`);
  };

  const activeCampaigns = await loadAllActiveRoutePlannerCampaigns();
  if (!activeCampaigns.length) {
    return { error: 'No active route planner campaigns are available.' as const };
  }
  log(`campaigns=${activeCampaigns.length}`);

  const planDate = toFloridaDateString();
  await autoCloseStaleSessionsForUser(userId);
  await autoCloseOpenSessionsForUser(userId);
  await clearAssignedRoutePlansForUserDate(userId, planDate);

  const radiusMiles = CHECK_IN_DISCOVERY_RADIUS_MILES;
  const builtResults = await Promise.allSettled(
    activeCampaigns.map((campaign) =>
      buildLocationStopsForCampaign(campaign.campaignId, {
        startLatitude: lat,
        startLongitude: lng,
        radiusMiles,
        includeUnmappedLocations: true,
      }),
    ),
  );
  const allStops: RouteLocationStop[] = [];
  for (const result of builtResults) {
    if (result.status !== 'fulfilled') {
      console.warn('[checkin] campaign build failed:', result.reason);
      continue;
    }
    const built = result.value;
    if (!built || ('error' in built && built.error)) continue;
    allStops.push(...(built.stops ?? []));
  }
  log(`campaign stops=${allStops.length}`);

  const withMapped = await appendMappedLocationStops(allStops, {
    latitude: lat,
    longitude: lng,
    radiusMiles,
  });
  const merged = mergeStopsByLocationAndAddress(withMapped);
  const withNpiStops = await appendCampaignNpiRegistryStops(merged, {
    latitude: lat,
    longitude: lng,
    radiusMiles,
  });
  const mergedNearby = mergeStopsByLocationAndAddress(withNpiStops);
  const dueStops = filterByRadius(mergedNearby, lat, lng, radiusMiles);
  log(`stops within ${radiusMiles}mi=${dueStops.length}`);

  const heldByOthers = await getActiveHeldLocationKeys(planDate, userId);
  const availableDueStops = dueStops.filter((stop) => !heldByOthers.has(stop.locationKey));
  let skippedHeldCount = dueStops.length - availableDueStops.length;

  try {
    await applyDrivingDistancesFromCheckIn(availableDueStops, lat, lng);
  } catch (err) {
    console.warn('[route-planner] driving distances skipped:', err);
  }

  const preClaimSorted = sortStopsByDistanceFromStart(availableDueStops, lat, lng);
  const claimedStops: RouteLocationStop[] = [];
  for (const stop of preClaimSorted) {
    const claimed = await tryClaimLocationHold(userId, stop.locationKey, planDate);
    if (claimed) claimedStops.push(stop);
    else skippedHeldCount += 1;
  }

  const optimizedStops = sortStopsByDistanceFromStart(claimedStops, lat, lng);
  log(`claimed=${optimizedStops.length}`);

  const totalInRadius = dueStops.length;
  const aggregateCoverage = { total: 0, covered: 0, remaining: 0 };

  let routePlanId: number | null = null;
  let checkInId = 0;
  let holdStopRows: { locationKey: string; routePlanStopId: number }[] = [];

  try {
    if (optimizedStops.length) {
      const now = new Date();
      const time = now.toTimeString().slice(0, 5);
      const routeName = `Routes For You — Check-in ${time}`;
      const saved = await saveRoutePlan({
        routeName,
        campaignId: null,
        startType: 'gps',
        startLabel: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        startLatitude: lat,
        startLongitude: lng,
        radiusMiles,
        stops: optimizedStops,
        createdBy: userId,
        preserveStopOrder: true,
      });
      routePlanId = Number(saved.plan?.RoutePlanId) || null;
      if (routePlanId) {
        await assignRoutePlan(routePlanId, userId);
      }

      const stopIdByKey = new Map<string, number>();
      for (const row of saved.stops as Record<string, unknown>[]) {
        const key = String(row.LocationKey ?? '').trim();
        const stopId = Number(row.RoutePlanStopId);
        if (key && Number.isFinite(stopId) && stopId > 0) {
          stopIdByKey.set(key, stopId);
        }
      }
      holdStopRows = optimizedStops
        .map((stop) => ({
          locationKey: stop.locationKey,
          routePlanStopId: stopIdByKey.get(stop.locationKey) ?? 0,
        }))
        .filter((row) => row.routePlanStopId > 0);
    }

    checkInId = await logCheckIn({
      userId,
      campaignId: null,
      routePlanId,
      lat,
      lng,
      radiusMiles,
      stopCount: optimizedStops.length,
    });

    if (routePlanId && checkInId && holdStopRows.length) {
      await attachHoldsToSession({
        userId,
        planDate,
        checkInId,
        routePlanId,
        stops: holdStopRows,
      });
    }
    if (routePlanId) {
      await restoreTodayProgress(userId, planDate, routePlanId);
    }
  } catch (err) {
    await releaseHoldsForUserOnDate(userId, planDate);
    throw err;
  }

  const plan = routePlanId ? await getRoutePlanById(routePlanId) : null;
  log(`done checkInId=${checkInId} stops=${optimizedStops.length}`);

  return {
    checkInId,
    routePlanId,
    radiusMiles,
    maxStopsPerDay: null,
    stopCount: optimizedStops.length,
    totalInRadius,
    dueInRadius: dueStops.length,
    skippedHeldCount,
    plan,
    coverage: {
      total: aggregateCoverage.total,
      covered: aggregateCoverage.covered,
      remaining: aggregateCoverage.remaining,
      frequencyInDays: null,
    },
  };
}

export type CheckInSessionRow = {
  checkInId: number;
  userId: number;
  fullName: string | null;
  routePlanId: number | null;
  routeName: string | null;
  planDate: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  radiusMiles: number | null;
  stopCount: number | null;
  campaigns: { campaignId: number; campaignName: string; flyerTitle: string | null }[];
};

/** Admin: recent mobile check-in sessions with campaigns present on the built route. */
export async function listCheckInSessions(limit = 200): Promise<CheckInSessionRow[]> {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 200, 1), 500);

  const sessionsResult = await pool.request().query(`
    SELECT TOP ${safeLimit}
      ci.RouteCheckInId,
      ci.UserId,
      ci.RoutePlanId,
      ci.CheckInAt,
      ci.CheckOutAt,
      ci.CheckInLat,
      ci.CheckInLng,
      ci.RadiusMiles,
      ci.StopCount,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS FullName,
      p.RouteName,
      p.PlanDate
    FROM dbo.PharmacyFlyer_RouteCheckInV2 ci
    LEFT JOIN dbo.Master_User u ON u.ID = ci.UserId
    LEFT JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = ci.RoutePlanId
    ORDER BY ci.CheckInAt DESC
  `);

  const rows: CheckInSessionRow[] = [];
  for (const row of sessionsResult.recordset as Record<string, unknown>[]) {
    const routePlanId = row.RoutePlanId != null ? Number(row.RoutePlanId) : null;
    let campaigns: CheckInSessionRow['campaigns'] = [];

    if (routePlanId) {
      const campaignsResult = await pool.request()
        .input('RoutePlanId', sql.BigInt, routePlanId)
        .query(`
          SELECT DISTINCT
            c.CampaignId,
            c.CampaignName,
            c.FlyerTitle
          FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
          INNER JOIN dbo.PharmacyFlyer_RoutePlanDropV2 d ON d.RoutePlanStopId = s.RoutePlanStopId
          INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = d.CampaignId
          WHERE s.RoutePlanId = @RoutePlanId
          ORDER BY c.CampaignName
        `);
      campaigns = (campaignsResult.recordset as Record<string, unknown>[]).map((c) => ({
        campaignId: Number(c.CampaignId),
        campaignName: String(c.CampaignName || ''),
        flyerTitle: c.FlyerTitle != null ? String(c.FlyerTitle) : null,
      }));
    }

    rows.push({
      checkInId: Number(row.RouteCheckInId),
      userId: Number(row.UserId),
      fullName: row.FullName != null ? String(row.FullName).trim() || null : null,
      routePlanId,
      routeName: row.RouteName != null ? String(row.RouteName) : null,
      planDate: row.PlanDate != null ? String(row.PlanDate).slice(0, 10) : null,
      checkInAt: row.CheckInAt instanceof Date
        ? row.CheckInAt.toISOString()
        : String(row.CheckInAt),
      checkOutAt: row.CheckOutAt != null
        ? (row.CheckOutAt instanceof Date ? row.CheckOutAt.toISOString() : String(row.CheckOutAt))
        : null,
      checkInLat: row.CheckInLat != null ? Number(row.CheckInLat) : null,
      checkInLng: row.CheckInLng != null ? Number(row.CheckInLng) : null,
      radiusMiles: row.RadiusMiles != null ? Number(row.RadiusMiles) : null,
      stopCount: row.StopCount != null ? Number(row.StopCount) : null,
      campaigns,
    });
  }

  return rows;
}

export type RepDeliveryFlyer = {
  title: string;
  status: 'completed' | 'pending' | 'skipped';
};

export type RepDeliveryStop = {
  routePlanStopId: number;
  stopOrder: number;
  locationName: string;
  address: string;
  status: string;
  completedAt: string | null;
  outcome: string | null;
  flyerTotal: number;
  flyerDone: number;
  flyers: RepDeliveryFlyer[];
};

export type RepDeliverySession = {
  checkInId: number;
  checkInAt: string;
  checkOutAt: string | null;
  deliveryCount: number;
  stops: RepDeliveryStop[];
};

export type RepDeliveryDay = {
  date: string;
  totalDeliveries: number;
  sessions: RepDeliverySession[];
};

function isoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const withZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`;
  return withZone.replace(/(\.\d{3})\d+/, '$1');
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function flyerDropStatus(value: unknown): RepDeliveryFlyer['status'] {
  const status = cleanText(value).toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  return 'pending';
}

function joinStopAddress(row: Record<string, unknown>) {
  const street = cleanText(row.AddressStreet);
  const city = cleanText(row.AddressCity);
  const state = cleanText(row.AddressState);
  const zip = cleanText(row.AddressZip);
  const cityState = [city, state].filter(Boolean).join(', ');
  const locality = [cityState, zip].filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

/** Locations and flyer completion for check-ins from the last two days. */
async function attachRecentDeliveryStops(
  pool: Awaited<ReturnType<typeof getPool>>,
  userId: number,
  sessions: RepDeliverySession[],
) {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const ids = sessions
    .filter((session) => {
      const at = new Date(session.checkInAt).getTime();
      return Number.isFinite(at) && at >= cutoff;
    })
    .map((session) => session.checkInId)
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) return;

  const columns = await pool.request().query(`
    SELECT COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskOutcome') AS FrontDeskOutcome
  `);
  const columnRow = (columns.recordset[0] || {}) as Record<string, unknown>;
  const outcomeSql = columnRow.FrontDeskOutcome != null
    ? 's.FrontDeskOutcome'
    : 'CAST(NULL AS NVARCHAR(40)) AS FrontDeskOutcome';

  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT
        ci.RouteCheckInId,
        s.RoutePlanStopId,
        s.StopOrder,
        s.AddressStreet,
        s.AddressCity,
        s.AddressState,
        s.AddressZip,
        s.Status AS StopStatus,
        CONVERT(varchar(33), TODATETIMEOFFSET(s.CompletedAt, DATEPART(TZOFFSET, SYSDATETIMEOFFSET())) AT TIME ZONE 'UTC', 127) AS CompletedAt,
        ${outcomeSql},
        d.CampaignId,
        d.Status AS DropStatus,
        c.CampaignName,
        c.FlyerTitle
      FROM dbo.PharmacyFlyer_RouteCheckInV2 ci
      INNER JOIN dbo.PharmacyFlyer_RoutePlanStopV2 s ON s.RoutePlanId = ci.RoutePlanId
      LEFT JOIN dbo.PharmacyFlyer_RoutePlanDropV2 d ON d.RoutePlanStopId = s.RoutePlanStopId
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = d.CampaignId
      WHERE ci.UserId = @UserId
        AND ci.RouteCheckInId IN (${ids.join(',')})
      ORDER BY ci.RouteCheckInId, s.StopOrder, c.CampaignName, d.RoutePlanDropId
    `);

  type FlyerBuild = { title: string; statuses: RepDeliveryFlyer['status'][] };
  type StopBuild = {
    routePlanStopId: number;
    stopOrder: number;
    locationName: string;
    address: string;
    status: string;
    completedAt: string | null;
    outcome: string | null;
    flyers: Map<number, FlyerBuild>;
  };

  const byCheckIn = new Map<number, Map<number, StopBuild>>();

  for (const row of result.recordset as Record<string, unknown>[]) {
    const checkInId = Number(row.RouteCheckInId);
    const stopId = Number(row.RoutePlanStopId);
    if (!byCheckIn.has(checkInId)) byCheckIn.set(checkInId, new Map());
    const stops = byCheckIn.get(checkInId)!;
    let stop = stops.get(stopId);
    if (!stop) {
      stop = {
        routePlanStopId: stopId,
        stopOrder: Number(row.StopOrder ?? 0),
        locationName: '',
        address: joinStopAddress(row),
        status: cleanText(row.StopStatus).toLowerCase() || 'pending',
        completedAt: isoTimestamp(row.CompletedAt),
        outcome: cleanText(row.FrontDeskOutcome).toLowerCase() || null,
        flyers: new Map(),
      };
      stops.set(stopId, stop);
    }

    if (row.CampaignId == null) continue;
    const campaignId = Number(row.CampaignId);
    const title = cleanText(row.FlyerTitle) || cleanText(row.CampaignName) || 'Flyer';
    const flyer = stop.flyers.get(campaignId) ?? { title, statuses: [] };
    flyer.statuses.push(flyerDropStatus(row.DropStatus));
    stop.flyers.set(campaignId, flyer);
  }

  for (const stops of byCheckIn.values()) {
    for (const [stopId, stop] of stops) {
      const visited = Boolean(stop.completedAt)
        || Boolean(stop.outcome)
        || stop.status === 'completed'
        || stop.status === 'skipped'
        || [...stop.flyers.values()].some((flyer) =>
          flyer.statuses.some((status) => status === 'completed' || status === 'skipped'));
      if (!visited) stops.delete(stopId);
    }
  }

  const practiceByStop = new Map<number, string>();
  const stopIds = [...new Set(
    [...byCheckIn.values()].flatMap((stops) => [...stops.keys()]),
  )];
  for (let i = 0; i < stopIds.length; i += 8) {
    await Promise.all(stopIds.slice(i, i + 8).map(async (stopId) => {
      try {
        const lookedUp = await loadPracticeNameForRouteStop(stopId);
        if ('error' in lookedUp) return;
        const name = cleanText(lookedUp.practiceName);
        if (name) practiceByStop.set(stopId, name);
      } catch {
        // The address line still identifies the stop.
      }
    }));
  }

  for (const session of sessions) {
    const stops = byCheckIn.get(session.checkInId);
    if (!stops) continue;
    session.stops = [...stops.values()]
      .sort((a, b) => a.stopOrder - b.stopOrder)
      .map((stop) => {
        const flyers = [...stop.flyers.values()].map((flyer) => {
          const status: RepDeliveryFlyer['status'] = flyer.statuses.every((item) => item === 'completed')
            ? 'completed'
            : flyer.statuses.every((item) => item === 'skipped')
              ? 'skipped'
              : 'pending';
          return { title: flyer.title, status };
        });
        return {
          routePlanStopId: stop.routePlanStopId,
          stopOrder: stop.stopOrder,
          locationName: practiceByStop.get(stop.routePlanStopId) || stop.address,
          address: stop.address,
          status: stop.status,
          completedAt: stop.completedAt,
          outcome: stop.outcome,
          flyerTotal: flyers.length,
          flyerDone: flyers.filter((flyer) => flyer.status === 'completed').length,
          flyers,
        };
      });
  }
}

/** Mobile: delivery counts grouped by check-in session and day. */
export async function listRepDeliveryHistory(userId: number, limit = 100): Promise<{
  days: RepDeliveryDay[];
  totalDeliveries: number;
}> {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);

  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT TOP ${safeLimit}
        ci.RouteCheckInId,
        ci.CheckInAt,
        ci.CheckOutAt,
        (
          SELECT COUNT(*)
          FROM dbo.PharmacyFlyer_Delivery d
          WHERE d.StaffUserId = ci.UserId
            AND ISNULL(d.FlyerDelivered, 0) = 1
            AND d.SubmittedAt >= ci.CheckInAt
            AND d.SubmittedAt <= COALESCE(ci.CheckOutAt, SYSDATETIME())
        ) AS DeliveryCount
      FROM dbo.PharmacyFlyer_RouteCheckInV2 ci
      WHERE ci.UserId = @UserId
      ORDER BY ci.CheckInAt DESC
    `);

  const sessions: RepDeliverySession[] = (result.recordset as Record<string, unknown>[]).map((row) => ({
    checkInId: Number(row.RouteCheckInId),
    checkInAt: row.CheckInAt instanceof Date
      ? row.CheckInAt.toISOString()
      : String(row.CheckInAt),
    checkOutAt: row.CheckOutAt != null
      ? (row.CheckOutAt instanceof Date ? row.CheckOutAt.toISOString() : String(row.CheckOutAt))
      : null,
    deliveryCount: Number(row.DeliveryCount ?? 0),
    stops: [],
  }));

  await attachRecentDeliveryStops(pool, userId, sessions);

  const dayMap = new Map<string, RepDeliveryDay>();
  for (const session of sessions) {
    const date = session.checkInAt.slice(0, 10);
    const bucket = dayMap.get(date) ?? { date, totalDeliveries: 0, sessions: [] };
    bucket.sessions.push(session);
    bucket.totalDeliveries += session.deliveryCount;
    dayMap.set(date, bucket);
  }

  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  const totalDeliveries = sessions.reduce((sum, s) => sum + s.deliveryCount, 0);

  return { days, totalDeliveries };
}

export type RepDeliveryCalendarDay = {
  date: string;
  stopCount: number;
  flyerCount: number;
};

/** Mobile calendar: per-day distinct stops visited and flyers delivered. */
export async function listRepDeliveryCalendar(userId: number): Promise<{
  today: string;
  days: RepDeliveryCalendarDay[];
}> {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT
        CAST(d.SubmittedAt AS DATE) AS DeliveryDate,
        COUNT(*) AS FlyerCount,
        COUNT(DISTINCT CONCAT(
          ISNULL(NULLIF(LTRIM(RTRIM(d.ClinicName)), ''), LTRIM(RTRIM(ISNULL(d.DoctorName, '')))),
          '|',
          ISNULL(LTRIM(RTRIM(d.DoctorAddressStreet)), ''),
          '|',
          ISNULL(LTRIM(RTRIM(d.DoctorAddressCity)), ''),
          '|',
          ISNULL(LTRIM(RTRIM(d.DoctorAddressZip)), '')
        )) AS StopCount
      FROM dbo.PharmacyFlyer_Delivery d
      WHERE d.StaffUserId = @UserId
        AND ISNULL(d.FlyerDelivered, 0) = 1
      GROUP BY CAST(d.SubmittedAt AS DATE)
      ORDER BY DeliveryDate DESC
    `);

  const days = (result.recordset as Record<string, unknown>[]).map((row) => ({
    date: row.DeliveryDate instanceof Date
      ? row.DeliveryDate.toISOString().slice(0, 10)
      : String(row.DeliveryDate).slice(0, 10),
    stopCount: Number(row.StopCount ?? 0),
    flyerCount: Number(row.FlyerCount ?? 0),
  }));

  return { today: toFloridaDateString(), days };
}

export async function checkOutRep(userId: number, checkInId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteCheckInId', sql.BigInt, checkInId)
    .input('UserId', sql.Int, userId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteCheckInV2
      SET CheckOutAt = SYSDATETIME()
      WHERE RouteCheckInId = @RouteCheckInId AND UserId = @UserId AND CheckOutAt IS NULL;
      SELECT @@ROWCOUNT AS Updated;
    `);
  const updated = Number(result.recordset[0]?.Updated ?? 0) > 0;
  if (updated) {
    await releaseHoldsForCheckIn(checkInId);
  }
  return { checkInId, checkedOut: updated };
}
