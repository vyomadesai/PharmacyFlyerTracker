import { getPool, sql } from '../../config/db.js';
import { isMappedLocationStop } from './routePlannerGeo.js';
import { orderStopsNearestNeighbor } from './routePlannerGeo.js';
import type { RouteLocationStop } from './routePlannerStops.js';

export type SaveRoutePlanInput = {
  routeName: string;
  /** Null for combined multi-campaign check-in routes. */
  campaignId?: number | null;
  startType: string;
  startLabel?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  radiusMiles?: number | null;
  planDate?: string | null;
  stops: RouteLocationStop[];
  createdBy?: number | null;
  /** When true, persist stops in the given order (check-in routes are pre-optimized). */
  preserveStopOrder?: boolean;
};

function parseDate(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const trimmed = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : new Date().toISOString().slice(0, 10);
}

function trimOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

async function loadDoctorPhonesByIds(doctorIds: number[]): Promise<Map<number, string | null>> {
  const ids = [...new Set(doctorIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, string | null>();
  if (!ids.length) return out;

  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, index) => request.input(`DocId${index}`, sql.Int, id));
  const inClause = ids.map((_, index) => `@DocId${index}`).join(', ');

  const result = await request.query(`
    SELECT
      d.ID AS DoctorId,
      NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS Phone
    FROM dbo.Master_Doctor d
    WHERE d.ID IN (${inClause})
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const doctorId = Number(row.DoctorId);
    if (!Number.isFinite(doctorId) || doctorId <= 0) continue;
    out.set(doctorId, trimOrNull(row.Phone));
  }

  return out;
}

async function loadLocationPhonesByIds(locationIds: number[]): Promise<Map<number, string | null>> {
  const ids = [...new Set(locationIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, string | null>();
  if (!ids.length) return out;

  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, index) => request.input(`LocId${index}`, sql.Int, id));
  const inClause = ids.map((_, index) => `@LocId${index}`).join(', ');

  const result = await request.query(`
    SELECT
      ml.ID AS LocationId,
      NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_Phone, ''))), '') AS Phone
    FROM dbo.Master_Location ml
    WHERE ml.ID IN (${inClause})
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const locationId = Number(row.LocationId);
    if (!Number.isFinite(locationId) || locationId <= 0) continue;
    out.set(locationId, trimOrNull(row.Phone));
  }

  return out;
}

export async function saveRoutePlan(input: SaveRoutePlanInput) {
  const pool = await getPool();
  const startLat = input.startLatitude != null ? Number(input.startLatitude) : null;
  const startLng = input.startLongitude != null ? Number(input.startLongitude) : null;

  let orderedStops = [...input.stops];
  if (
    !input.preserveStopOrder
    && startLat != null
    && startLng != null
    && orderedStops.length > 1
  ) {
    orderedStops = orderStopsNearestNeighbor(orderedStops, startLat, startLng);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const planResult = await new sql.Request(transaction)
      .input('RouteName', sql.NVarChar, input.routeName)
      .input('CampaignId', sql.Int, input.campaignId ?? null)
      .input('StartType', sql.VarChar, input.startType || 'custom')
      .input('StartLabel', sql.NVarChar, input.startLabel ?? null)
      .input('StartLatitude', sql.Decimal(10, 7), startLat)
      .input('StartLongitude', sql.Decimal(10, 7), startLng)
      .input('RadiusMiles', sql.Decimal(8, 2), input.radiusMiles ?? null)
      .input('PlanDate', sql.Date, parseDate(input.planDate))
      .input('CreatedBy', sql.Int, input.createdBy ?? null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_RoutePlanV2 (
          RouteName, CampaignId, StartType, StartLabel, StartLatitude, StartLongitude,
          RadiusMiles, Status, PlanDate, CreatedBy
        )
        OUTPUT INSERTED.*
        VALUES (
          @RouteName, @CampaignId, @StartType, @StartLabel, @StartLatitude, @StartLongitude,
          @RadiusMiles, 'draft', @PlanDate, @CreatedBy
        )
      `);

    const plan = planResult.recordset[0];
    const routePlanId = Number(plan.RoutePlanId);
    const savedStops: Record<string, unknown>[] = [];

    for (let i = 0; i < orderedStops.length; i++) {
      const stop = orderedStops[i];
      const stopResult = await new sql.Request(transaction)
        .input('RoutePlanId', sql.BigInt, routePlanId)
        .input('StopOrder', sql.Int, i + 1)
        .input('LocationKey', sql.NVarChar, stop.locationKey)
        .input('PracticeId', sql.Int, stop.practiceId)
        .input('LocationId', sql.Int, stop.locationId)
        .input('StopLabel', sql.NVarChar, stop.stopLabel)
        .input('AddressStreet', sql.NVarChar, stop.addressStreet)
        .input('AddressCity', sql.NVarChar, stop.addressCity)
        .input('AddressState', sql.NVarChar, stop.addressState)
        .input('AddressZip', sql.NVarChar, stop.addressZip)
        .input('Latitude', sql.Decimal(10, 7), stop.latitude)
        .input('Longitude', sql.Decimal(10, 7), stop.longitude)
        .input('DistanceMiles', sql.Decimal(8, 2), stop.distanceMiles)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_RoutePlanStopV2 (
            RoutePlanId, StopOrder, LocationKey, PracticeId, LocationId, StopLabel,
            AddressStreet, AddressCity, AddressState, AddressZip, Latitude, Longitude, DistanceMiles
          )
          OUTPUT INSERTED.*
          VALUES (
            @RoutePlanId, @StopOrder, @LocationKey, @PracticeId, @LocationId, @StopLabel,
            @AddressStreet, @AddressCity, @AddressState, @AddressZip, @Latitude, @Longitude, @DistanceMiles
          )
        `);

      const stopRow = stopResult.recordset[0];
      const routePlanStopId = Number(stopRow.RoutePlanStopId);
      const drops: Record<string, unknown>[] = [];

      for (const doctor of stop.doctors) {
        for (const flyer of stop.flyers) {
          if (
            doctor.matchedCampaignId != null
            && doctor.matchedCampaignId !== flyer.campaignId
          ) {
            continue;
          }
          const dropResult = await new sql.Request(transaction)
            .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
            .input('CampaignId', sql.Int, flyer.campaignId)
            .input('DoctorId', sql.Int, doctor.doctorId > 0 ? doctor.doctorId : null)
            .input('DoctorName', sql.NVarChar, doctor.doctorName)
            .input('MatchedSpecialityCode', sql.NVarChar, doctor.matchedSpecialityCode)
            .input('MatchedLevel', sql.VarChar, doctor.matchedLevel)
            .query(`
              INSERT INTO dbo.PharmacyFlyer_RoutePlanDropV2 (
                RoutePlanStopId, CampaignId, DoctorId, DoctorName,
                MatchedSpecialityCode, MatchedLevel
              )
              OUTPUT INSERTED.*
              VALUES (
                @RoutePlanStopId, @CampaignId, @DoctorId, @DoctorName,
                @MatchedSpecialityCode, @MatchedLevel
              )
            `);
          drops.push(dropResult.recordset[0]);
        }
      }

      savedStops.push({ ...stopRow, drops });
    }

    await transaction.commit();
    return { plan, stops: savedStops };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function listRoutePlans() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      p.RoutePlanId,
      p.RouteName,
      p.CampaignId,
      c.CampaignName,
      p.StartType,
      p.StartLabel,
      p.StartLatitude,
      p.StartLongitude,
      p.RadiusMiles,
      p.Status,
      p.AssignedUserId,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS AssignedUserName,
      p.PlanDate,
      p.CreatedDate,
      (
        SELECT COUNT(*)
        FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
        WHERE s.RoutePlanId = p.RoutePlanId
      ) AS LocationCount,
      (
        SELECT COUNT(DISTINCT d.DoctorId)
        FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
        INNER JOIN dbo.PharmacyFlyer_RoutePlanDropV2 d ON d.RoutePlanStopId = s.RoutePlanStopId
        WHERE s.RoutePlanId = p.RoutePlanId AND d.DoctorId IS NOT NULL
      ) AS DoctorCount,
      (
        SELECT COUNT(*)
        FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
        INNER JOIN dbo.PharmacyFlyer_RoutePlanDropV2 d ON d.RoutePlanStopId = s.RoutePlanStopId
        WHERE s.RoutePlanId = p.RoutePlanId
      ) AS FlyerDropCount
    FROM dbo.PharmacyFlyer_RoutePlanV2 p
    LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = p.CampaignId
    LEFT JOIN dbo.Master_User u ON u.ID = p.AssignedUserId
    ORDER BY p.CreatedDate DESC, p.RoutePlanId DESC
  `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    routePlanId: row.RoutePlanId,
    routeName: row.RouteName,
    campaignId: row.CampaignId,
    campaignName: row.CampaignName,
    startType: row.StartType,
    startLabel: row.StartLabel,
    startLatitude: row.StartLatitude,
    startLongitude: row.StartLongitude,
    radiusMiles: row.RadiusMiles,
    status: row.Status,
    assignedUserId: row.AssignedUserId,
    assignedUserName: row.AssignedUserName,
    planDate: row.PlanDate,
    createdDate: row.CreatedDate,
    locationCount: row.LocationCount,
    doctorCount: row.DoctorCount,
    flyerDropCount: row.FlyerDropCount,
  }));
}

export async function getRoutePlanById(routePlanId: number) {
  const pool = await getPool();
  const planResult = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT
        p.*,
        c.CampaignName,
        c.FlyerTitle,
        LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS AssignedUserName
      FROM dbo.PharmacyFlyer_RoutePlanV2 p
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = p.CampaignId
      LEFT JOIN dbo.Master_User u ON u.ID = p.AssignedUserId
      WHERE p.RoutePlanId = @RoutePlanId
    `);

  const plan = planResult.recordset[0];
  if (!plan) return null;

  const stopsResult = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT *
      FROM dbo.PharmacyFlyer_RoutePlanStopV2
      WHERE RoutePlanId = @RoutePlanId
      ORDER BY StopOrder
    `);

  const dropsResult = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT d.*, c.CampaignName, c.FlyerTitle
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 d
      INNER JOIN dbo.PharmacyFlyer_RoutePlanStopV2 s ON s.RoutePlanStopId = d.RoutePlanStopId
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = d.CampaignId
      WHERE s.RoutePlanId = @RoutePlanId
      ORDER BY s.StopOrder, d.DoctorName
    `);

  const dropsByStop = new Map<number, Record<string, unknown>[]>();
  for (const drop of dropsResult.recordset) {
    const stopId = Number(drop.RoutePlanStopId);
    if (!dropsByStop.has(stopId)) dropsByStop.set(stopId, []);
    dropsByStop.get(stopId)!.push(drop);
  }

  const stops = stopsResult.recordset.map((stop: Record<string, unknown>) => {
    const stopId = Number(stop.RoutePlanStopId);
    const drops = dropsByStop.get(stopId) ?? [];
    const doctorsMap = new Map<number, Record<string, unknown>>();
    const flyersMap = new Map<number, Record<string, unknown>>();

    for (const drop of drops) {
      if (drop.DoctorId != null) {
        doctorsMap.set(Number(drop.DoctorId), {
          routePlanDropId: drop.RoutePlanDropId,
          doctorId: drop.DoctorId,
          doctorName: drop.DoctorName,
          matchedSpecialityCode: drop.MatchedSpecialityCode,
          matchedLevel: drop.MatchedLevel,
          status: drop.Status,
          campaignId: drop.CampaignId,
          campaignName: drop.CampaignName,
          flyerTitle: drop.FlyerTitle,
        });
      }
      if (drop.CampaignId != null) {
        flyersMap.set(Number(drop.CampaignId), {
          campaignId: drop.CampaignId,
          campaignName: drop.CampaignName,
          flyerTitle: drop.FlyerTitle,
        });
      }
    }

    return {
      routePlanStopId: stop.RoutePlanStopId,
      stopOrder: stop.StopOrder,
      locationKey: stop.LocationKey,
      locationId: stop.LocationId != null ? Number(stop.LocationId) : null,
      isConfigured: isMappedLocationStop({
        locationId: stop.LocationId != null ? Number(stop.LocationId) : null,
        locationKey: stop.LocationKey != null ? String(stop.LocationKey) : null,
      }),
      stopLabel: stop.StopLabel,
      addressStreet: stop.AddressStreet,
      addressCity: stop.AddressCity,
      addressState: stop.AddressState,
      addressZip: stop.AddressZip,
      latitude: stop.Latitude,
      longitude: stop.Longitude,
      distanceMiles: stop.DistanceMiles,
      status: stop.Status,
      phone: null as string | null,
      doctorCount: doctorsMap.size,
      flyerCount: flyersMap.size,
      doctors: [...doctorsMap.values()],
      flyers: [...flyersMap.values()],
      drops: drops.map((drop: Record<string, unknown>) => ({
        routePlanDropId: drop.RoutePlanDropId,
        routePlanStopId: drop.RoutePlanStopId,
        campaignId: drop.CampaignId,
        campaignName: drop.CampaignName,
        flyerTitle: drop.FlyerTitle,
        doctorId: drop.DoctorId,
        doctorName: drop.DoctorName,
        matchedSpecialityCode: drop.MatchedSpecialityCode,
        matchedLevel: drop.MatchedLevel,
        status: drop.Status,
        completedAt: drop.CompletedAt,
      })),
    };
  });

  const locationPhones = await loadLocationPhonesByIds(
    stops
      .map((stop: { locationId: number | null }) => stop.locationId)
      .filter((id: number | null): id is number => id != null && id > 0),
  );
  const doctorPhones = await loadDoctorPhonesByIds(
    stops.flatMap((stop: { doctors: Array<{ doctorId: unknown }> }) =>
      stop.doctors.map((doc) => Number(doc.doctorId)).filter((id) => id > 0),
    ),
  );

  for (const stop of stops as Array<{
    locationId: number | null;
    phone: string | null;
    doctors: Array<{ doctorId: unknown; phone?: string | null }>;
  }>) {
    if (stop.locationId != null) {
      stop.phone = locationPhones.get(stop.locationId) ?? null;
    }
    for (const doctor of stop.doctors) {
      const doctorId = Number(doctor.doctorId);
      doctor.phone = doctorPhones.get(doctorId) ?? null;
      if (!stop.phone && doctor.phone) stop.phone = doctor.phone;
    }
  }

  const mappedStops = stops;

  return {
    routePlanId: plan.RoutePlanId,
    routeName: plan.RouteName,
    campaignId: plan.CampaignId,
    campaignName: plan.CampaignName,
    flyerTitle: plan.FlyerTitle,
    startType: plan.StartType,
    startLabel: plan.StartLabel,
    startLatitude: plan.StartLatitude,
    startLongitude: plan.StartLongitude,
    radiusMiles: plan.RadiusMiles,
    status: plan.Status,
    assignedUserId: plan.AssignedUserId,
    assignedUserName: plan.AssignedUserName,
    planDate: plan.PlanDate,
    createdDate: plan.CreatedDate,
    stops: mappedStops,
  };
}
