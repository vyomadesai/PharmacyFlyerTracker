import { getPool, sql } from '../config/db.js';
import { milesBetween } from '../utils/geography.js';
import { toFloridaDateString } from '../utils/timezone.js';
import { recordTargetVisit } from './campaignTargets.js';
import { getMyFlyersSummary, getTodayInventoryTotals } from './distributorInventory.js';
import { getRouteById, listRoutes } from './routeManagement.js';

const VERIFY_RADIUS_MILES = 0.5;
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

const STOP_DETAIL_SELECT = `
  s.RouteStopId,
  s.RouteId,
  s.StopOrder,
  s.CampaignTargetId,
  s.CampaignId,
  s.CampaignConfigId,
  s.TargetType,
  s.DoctorId,
  s.NPI,
  s.PharmacyId,
  s.AssignedFlyerName,
  s.StopLabel,
  s.StopAddress,
  s.StopLatitude,
  s.StopLongitude,
  s.Status,
  s.CheckInRequired,
  s.ProofUploadRequired,
  s.CompletedAt,
  s.SkippedReason,
  s.Notes,
  r.RouteName,
  r.RouteDate,
  r.Status AS RouteStatus,
  r.DistributorUserId,
  c.CampaignName,
  t.VisitFrequencyType,
  t.VisitFrequencyDays,
  t.LastVisitedAt AS TargetLastVisitedAt,
  t.NextDueDate AS TargetNextDueDate,
  CASE
    WHEN t.VisitFrequencyType = 'one_time' AND t.LastVisitedAt IS NOT NULL THEN 'completed'
    WHEN t.VisitFrequencyType = 'one_time' THEN 'due_now'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate < ${FLORIDA_SQL_TODAY} THEN 'overdue'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate = ${FLORIDA_SQL_TODAY} THEN 'due_now'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate > ${FLORIDA_SQL_TODAY} THEN 'upcoming'
    ELSE 'due_now'
  END AS VisitDueStatus,
  COALESCE(
    NULLIF(LTRIM(RTRIM(pdi.pri_spec)), ''),
    NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''),
    NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')
  ) AS Specialty,
  CASE
    WHEN s.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_MobileNo)), ''))
    ELSE p.Phone
  END AS Phone,
  CASE
    WHEN s.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.City)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressCity)), ''))
    ELSE p.City
  END AS City,
  CASE
    WHEN s.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.State)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressState)), ''))
    ELSE p.State
  END AS State,
  CASE
    WHEN s.TargetType = 'doctor' THEN LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), '')))
    ELSE p.Zip
  END AS Zip,
  ci.RouteStopCheckInId,
  ci.CheckInLatitude,
  ci.CheckInLongitude,
  ci.GpsAccuracyMeters,
  ci.DistanceMiles AS CheckInDistanceMiles,
  ci.LocationVerified,
  ci.VerificationNote,
  ci.CheckedInAt,
  (SELECT TOP 1 rp.RouteStopProofId FROM dbo.PharmacyFlyer_RouteStopProof rp WHERE rp.RouteStopId = s.RouteStopId ORDER BY rp.UploadedAt DESC) AS RouteStopProofId,
  (SELECT TOP 1 rp.UploadedAt FROM dbo.PharmacyFlyer_RouteStopProof rp WHERE rp.RouteStopId = s.RouteStopId ORDER BY rp.UploadedAt DESC) AS ProofUploadedAt
`;

async function loadStopRow(routeStopId: number, distributorUserId?: number | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('DistributorUserId', sql.Int, Number.isFinite(distributorUserId) ? distributorUserId : null)
    .query(`
      WITH DoctorInfoByNpi AS (
        SELECT
          LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) AS NPI,
          LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) AS pri_spec,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10))))
            ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) <> '' THEN 0 ELSE 1 END, pdi.adrs_id
          ) AS NpiRank
        FROM dbo.PharmacyFlyer_DoctorInfo pdi WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) <> ''
      )
      SELECT ${STOP_DETAIL_SELECT}
      FROM dbo.PharmacyFlyer_RouteStop s
      INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = s.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_CampaignTarget t ON t.CampaignTargetId = s.CampaignTargetId
      LEFT JOIN dbo.Master_Doctor d ON d.ID = s.DoctorId
      LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = s.NPI
      LEFT JOIN DoctorInfoByNpi pdi ON pdi.NPI = s.NPI AND pdi.NpiRank = 1
      LEFT JOIN dbo.PharmacyFlyer_Pharmacy p ON p.PharmacyId = s.PharmacyId
      LEFT JOIN dbo.PharmacyFlyer_RouteStopCheckIn ci ON ci.RouteStopId = s.RouteStopId
      WHERE s.RouteStopId = @RouteStopId
        AND (@DistributorUserId IS NULL OR r.DistributorUserId = @DistributorUserId)
    `);

  const stop = result.recordset[0];
  if (!stop) return null;

  return {
    ...stop,
    HasCheckIn: Boolean(stop.RouteStopCheckInId),
    HasProof: Boolean(stop.RouteStopProofId),
    CanComplete: computeCanComplete(stop),
  };
}

function computeCanComplete(stop: Record<string, unknown>) {
  if (stop.Status === 'completed' || stop.Status === 'skipped' || stop.Status === 'failed') {
    return { allowed: false, reason: `Stop is already ${stop.Status}` };
  }
  if (stop.CheckInRequired && !stop.RouteStopCheckInId) {
    return { allowed: false, reason: 'Check-in is required before completing this stop.' };
  }
  if (stop.ProofUploadRequired && !stop.RouteStopProofId) {
    return { allowed: false, reason: 'Proof photo is required before completing this stop.' };
  }
  return { allowed: true, reason: null };
}

export async function getMyRoutesCalendar(distributorUserId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .query(`
      SELECT
        r.RouteDate,
        COUNT(DISTINCT r.RouteId) AS RouteCount,
        SUM(CASE WHEN s.Status = 'completed' THEN 1 ELSE 0 END) AS CompletedStopCount,
        SUM(CASE WHEN s.Status IN ('pending', 'arrived') THEN 1 ELSE 0 END) AS PendingStopCount,
        SUM(CASE WHEN s.Status IN ('skipped', 'failed') THEN 1 ELSE 0 END) AS SkippedStopCount,
        COUNT(s.RouteStopId) AS TotalStopCount
      FROM dbo.PharmacyFlyer_Route r
      LEFT JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteId = r.RouteId
      WHERE r.DistributorUserId = @DistributorUserId
        AND r.Status NOT IN ('cancelled', 'draft')
      GROUP BY r.RouteDate
      ORDER BY r.RouteDate DESC
    `);

  const today = toFloridaDateString();
  const todayRoutes = await listRoutes({ distributorUserId, todayOnly: true });
  const inventory = await getTodayInventoryTotals(distributorUserId);

  return {
    today,
    todayRoutes,
    inventory,
    dates: result.recordset,
  };
}

export async function getMyRoutes(distributorUserId: number, routeDate?: string | null) {
  return listRoutes({
    distributorUserId,
    routeDate: routeDate || null,
  });
}

export async function getMyTodayRoute(distributorUserId: number) {
  const routes = await listRoutes({ distributorUserId, todayOnly: true });
  const route = routes[0] || null;
  if (!route) {
    return { route: null, stops: [], inventory: await getTodayInventoryTotals(distributorUserId) };
  }

  const detail = await getRouteById(route.RouteId, distributorUserId);
  const stops = await enrichStopsForList(detail?.stops || []);
  return {
    route: detail,
    stops,
    inventory: await getTodayInventoryTotals(distributorUserId),
  };
}

async function enrichStopsForList(stops: Array<Record<string, unknown>>) {
  const enriched = [];
  for (const stop of stops) {
    const detail = await loadStopRow(Number(stop.RouteStopId));
    enriched.push(detail || stop);
  }
  return enriched;
}

export async function getRouteStopById(routeStopId: number, distributorUserId?: number | null) {
  return loadStopRow(routeStopId, distributorUserId);
}

export async function checkInRouteStop(
  routeStopId: number,
  distributorUserId: number,
  input: {
    latitude?: number | null;
    longitude?: number | null;
    gpsAccuracyMeters?: number | null;
    verificationNote?: string | null;
  },
) {
  const stop = await loadStopRow(routeStopId, distributorUserId);
  if (!stop) throw new Error('Route stop not found');

  const lat = input.latitude != null ? Number(input.latitude) : null;
  const lng = input.longitude != null ? Number(input.longitude) : null;
  const targetLat = stop.StopLatitude != null ? Number(stop.StopLatitude) : null;
  const targetLng = stop.StopLongitude != null ? Number(stop.StopLongitude) : null;

  let distanceMiles: number | null = null;
  let locationVerified = false;

  if (lat != null && lng != null && targetLat != null && targetLng != null) {
    distanceMiles = milesBetween(lat, lng, targetLat, targetLng);
    locationVerified = distanceMiles <= VERIFY_RADIUS_MILES;
  }

  const pool = await getPool();
  const existing = await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .query(`SELECT TOP 1 RouteStopCheckInId FROM dbo.PharmacyFlyer_RouteStopCheckIn WHERE RouteStopId = @RouteStopId`);

  if (existing.recordset[0]) {
    await pool.request()
      .input('RouteStopId', sql.Int, routeStopId)
      .input('CheckInLatitude', sql.Decimal(10, 7), lat)
      .input('CheckInLongitude', sql.Decimal(10, 7), lng)
      .input('GpsAccuracyMeters', sql.Decimal(10, 2), input.gpsAccuracyMeters ?? null)
      .input('TargetLatitude', sql.Decimal(10, 7), targetLat)
      .input('TargetLongitude', sql.Decimal(10, 7), targetLng)
      .input('DistanceMiles', sql.Decimal(8, 2), distanceMiles != null ? Number(distanceMiles.toFixed(2)) : null)
      .input('LocationVerified', sql.Bit, locationVerified ? 1 : 0)
      .input('VerificationNote', sql.NVarChar, input.verificationNote ?? null)
      .query(`
        UPDATE dbo.PharmacyFlyer_RouteStopCheckIn
        SET
          CheckInLatitude = @CheckInLatitude,
          CheckInLongitude = @CheckInLongitude,
          GpsAccuracyMeters = @GpsAccuracyMeters,
          TargetLatitude = @TargetLatitude,
          TargetLongitude = @TargetLongitude,
          DistanceMiles = @DistanceMiles,
          LocationVerified = @LocationVerified,
          VerificationNote = @VerificationNote,
          CheckedInAt = SYSDATETIME()
        WHERE RouteStopId = @RouteStopId
      `);
  } else {
    await pool.request()
      .input('RouteStopId', sql.Int, routeStopId)
      .input('DistributorUserId', sql.Int, distributorUserId)
      .input('CheckInLatitude', sql.Decimal(10, 7), lat)
      .input('CheckInLongitude', sql.Decimal(10, 7), lng)
      .input('GpsAccuracyMeters', sql.Decimal(10, 2), input.gpsAccuracyMeters ?? null)
      .input('TargetLatitude', sql.Decimal(10, 7), targetLat)
      .input('TargetLongitude', sql.Decimal(10, 7), targetLng)
      .input('DistanceMiles', sql.Decimal(8, 2), distanceMiles != null ? Number(distanceMiles.toFixed(2)) : null)
      .input('LocationVerified', sql.Bit, locationVerified ? 1 : 0)
      .input('VerificationNote', sql.NVarChar, input.verificationNote ?? null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_RouteStopCheckIn (
          RouteStopId, DistributorUserId, CheckInLatitude, CheckInLongitude, GpsAccuracyMeters,
          TargetLatitude, TargetLongitude, DistanceMiles, LocationVerified, VerificationNote
        )
        VALUES (
          @RouteStopId, @DistributorUserId, @CheckInLatitude, @CheckInLongitude, @GpsAccuracyMeters,
          @TargetLatitude, @TargetLongitude, @DistanceMiles, @LocationVerified, @VerificationNote
        )
      `);
  }

  await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('RouteId', sql.Int, stop.RouteId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteStop
      SET Status = CASE WHEN Status = 'pending' THEN 'arrived' ELSE Status END, UpdatedAt = SYSDATETIME()
      WHERE RouteStopId = @RouteStopId;

      UPDATE dbo.PharmacyFlyer_Route
      SET Status = CASE WHEN Status = 'assigned' THEN 'in_progress' ELSE Status END, UpdatedAt = SYSDATETIME()
      WHERE RouteId = @RouteId AND Status = 'assigned';
    `);

  return loadStopRow(routeStopId, distributorUserId);
}

export async function uploadRouteStopProof(
  routeStopId: number,
  distributorUserId: number,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
) {
  const stop = await loadStopRow(routeStopId, distributorUserId);
  if (!stop) throw new Error('Route stop not found');

  const pool = await getPool();
  const result = await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('UploadedByUserId', sql.Int, distributorUserId)
    .input('FileName', sql.NVarChar, file.originalname)
    .input('ContentType', sql.NVarChar, file.mimetype)
    .input('FileSizeBytes', sql.BigInt, file.size)
    .input('PhotoData', sql.VarBinary(sql.MAX), file.buffer)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_RouteStopProof (
        RouteStopId, UploadedByUserId, FileName, ContentType, FileSizeBytes, PhotoData
      )
      OUTPUT INSERTED.RouteStopProofId
      VALUES (@RouteStopId, @UploadedByUserId, @FileName, @ContentType, @FileSizeBytes, @PhotoData)
    `);

  return {
    routeStopProofId: result.recordset[0].RouteStopProofId,
    stop: await loadStopRow(routeStopId, distributorUserId),
  };
}

async function incrementDeliveredForStop(distributorUserId: number, campaignId: number | null, flyerName: string | null) {
  if (!campaignId) return null;
  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .input('CampaignId', sql.Int, campaignId)
    .input('FlyerName', sql.NVarChar, flyerName)
    .query(`
      UPDATE i
      SET
        DeliveredQuantity = i.DeliveredQuantity + 1,
        Status = CASE
          WHEN i.DeliveredQuantity + 1 >= i.AssignedQuantity THEN 'completed'
          WHEN i.DeliveredQuantity + 1 > 0 THEN 'in_progress'
          ELSE i.Status
        END,
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      FROM dbo.PharmacyFlyer_DistributorInventory i
      INNER JOIN (
        SELECT TOP 1 DistributorInventoryId
        FROM dbo.PharmacyFlyer_DistributorInventory
        WHERE DistributorUserId = @DistributorUserId
          AND CampaignId = @CampaignId
          AND AssignmentDate = ${FLORIDA_SQL_TODAY}
          AND Status <> 'cancelled'
          AND (
            @FlyerName IS NULL
            OR FlyerName = @FlyerName
            OR LTRIM(RTRIM(ISNULL(FlyerName, ''))) = ''
          )
        ORDER BY
          CASE WHEN FlyerName = @FlyerName THEN 0 ELSE 1 END,
          RemainingQuantity DESC,
          DistributorInventoryId DESC
      ) pick ON pick.DistributorInventoryId = i.DistributorInventoryId
    `);

  return result.recordset[0] || null;
}

export async function completeRouteStopWorkflow(
  routeStopId: number,
  distributorUserId: number,
  notes?: string | null,
) {
  const stop = await loadStopRow(routeStopId, distributorUserId);
  if (!stop) throw new Error('Route stop not found');

  const canComplete = computeCanComplete(stop);
  if (!canComplete.allowed) {
    throw new Error(canComplete.reason || 'Cannot complete this stop yet.');
  }

  const pool = await getPool();
  const completedAt = new Date();

  await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('Notes', sql.NVarChar, notes ?? null)
    .input('CompletedAt', sql.DateTime2, completedAt)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteStop
      SET Status = 'completed', CompletedAt = @CompletedAt, Notes = COALESCE(@Notes, Notes), UpdatedAt = SYSDATETIME()
      WHERE RouteStopId = @RouteStopId
    `);

  if (stop.CampaignTargetId) {
    await recordTargetVisit(Number(stop.CampaignTargetId), completedAt);
  }

  await incrementDeliveredForStop(
    distributorUserId,
    stop.CampaignId != null ? Number(stop.CampaignId) : null,
    stop.AssignedFlyerName ? String(stop.AssignedFlyerName) : null,
  );

  const refreshed = await getRouteById(Number(stop.RouteId), distributorUserId);
  const pending = refreshed?.stops?.filter((s: Record<string, unknown>) => s.Status === 'pending' || s.Status === 'arrived').length ?? 0;
  if (pending === 0 && refreshed?.stops?.length) {
    await pool.request()
      .input('RouteId', sql.Int, stop.RouteId)
      .query(`
        UPDATE dbo.PharmacyFlyer_Route
        SET Status = 'completed', UpdatedAt = SYSDATETIME()
        WHERE RouteId = @RouteId AND Status IN ('assigned', 'in_progress')
      `);
  } else {
    await pool.request()
      .input('RouteId', sql.Int, stop.RouteId)
      .query(`
        UPDATE dbo.PharmacyFlyer_Route
        SET Status = 'in_progress', UpdatedAt = SYSDATETIME()
        WHERE RouteId = @RouteId AND Status = 'assigned'
      `);
  }

  const inventory = await getMyFlyersSummary(distributorUserId);
  return {
    stop: await loadStopRow(routeStopId, distributorUserId),
    route: await getRouteById(Number(stop.RouteId), distributorUserId),
    inventory: {
      totalAssignedToday: inventory.totalAssignedToday,
      totalDeliveredToday: inventory.totalDeliveredToday,
      totalRemainingToday: inventory.totalRemainingToday,
    },
  };
}

export async function skipRouteStop(
  routeStopId: number,
  distributorUserId: number,
  input: { reason: string; status?: 'skipped' | 'failed' },
) {
  const stop = await loadStopRow(routeStopId, distributorUserId);
  if (!stop) throw new Error('Route stop not found');

  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('A reason is required to skip or fail a stop.');

  const status = input.status === 'failed' ? 'failed' : 'skipped';
  const pool = await getPool();

  await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('Status', sql.VarChar, status)
    .input('SkippedReason', sql.NVarChar, reason)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteStop
      SET Status = @Status, SkippedReason = @SkippedReason, UpdatedAt = SYSDATETIME()
      WHERE RouteStopId = @RouteStopId
    `);

  return {
    stop: await loadStopRow(routeStopId, distributorUserId),
    route: await getRouteById(Number(stop.RouteId), distributorUserId),
  };
}

export async function getRouteStopProofPhoto(routeStopId: number, distributorUserId: number) {
  const stop = await loadStopRow(routeStopId, distributorUserId);
  if (!stop) return null;

  const pool = await getPool();
  const result = await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .query(`
      SELECT TOP 1 FileName, ContentType, PhotoData
      FROM dbo.PharmacyFlyer_RouteStopProof
      WHERE RouteStopId = @RouteStopId
      ORDER BY UploadedAt DESC
    `);

  return result.recordset[0] || null;
}

export async function getMyAssignments(distributorUserId: number) {
  return getMyFlyersSummary(distributorUserId);
}
