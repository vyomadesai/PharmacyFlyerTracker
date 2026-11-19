import { getPool, sql } from '../config/db.js';
import { milesBetween } from '../utils/geography.js';
import { toFloridaDateString } from '../utils/timezone.js';
import { isTargetDueForVisit } from '../utils/visitFrequency.js';
import { recordTargetVisit } from './campaignTargets.js';

export type RouteStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type StartType = 'home' | 'current' | 'custom';

const APPROVED_STATUSES = ['approved', 'assigned'];
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

async function getDistributorHome(userId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT TOP 1 HomeAddress, HomeLatitude, HomeLongitude
      FROM dbo.PharmacyFlyer_UserProfile
      WHERE UserId = @UserId
    `);
  return result.recordset[0] as { HomeAddress?: string; HomeLatitude?: number; HomeLongitude?: number } | undefined;
}

async function resolveStartLocation(input: {
  startType: StartType;
  distributorUserId?: number | null;
  startAddress?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
}) {
  if (input.startType === 'custom') {
    return {
      startAddress: input.startAddress ?? null,
      startLatitude: input.startLatitude ?? null,
      startLongitude: input.startLongitude ?? null,
    };
  }

  if (input.startType === 'current') {
    return {
      startAddress: input.startAddress ?? 'Current location',
      startLatitude: input.startLatitude ?? null,
      startLongitude: input.startLongitude ?? null,
    };
  }

  if (input.distributorUserId) {
    const home = await getDistributorHome(input.distributorUserId);
    if (home) {
      return {
        startAddress: home.HomeAddress ?? null,
        startLatitude: home.HomeLatitude != null ? Number(home.HomeLatitude) : null,
        startLongitude: home.HomeLongitude != null ? Number(home.HomeLongitude) : null,
      };
    }
  }

  return { startAddress: null, startLatitude: null, startLongitude: null };
}

async function loadApprovedTarget(targetId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignTargetId', sql.Int, targetId)
    .query(`
      SELECT
        t.CampaignTargetId,
        t.CampaignId,
        t.CampaignConfigId,
        t.TargetType,
        t.DoctorId,
        t.NPI,
        t.PharmacyId,
        t.AssignedFlyerName,
        t.ApprovalStatus,
        t.CheckInRequired,
        t.ProofUploadRequired,
        t.VisitFrequencyType,
        t.VisitFrequencyDays,
        t.LastVisitedAt,
        t.NextDueDate,
        CASE
          WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(CONCAT(
            COALESCE(nrc.FirstName, d.Doctor_FirstName, ''), ' ',
            COALESCE(nrc.LastName, d.Doctor_LastName, '')
          )))
          ELSE p.PharmacyName
        END AS StopLabel,
        CASE
          WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(CONCAT(
            COALESCE(NULLIF(LTRIM(RTRIM(nrc.Address1)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressStreet)), '')),
            CASE WHEN COALESCE(nrc.City, d.Doctor_AddressCity) IS NOT NULL
              THEN CONCAT(', ', COALESCE(nrc.City, d.Doctor_AddressCity), ' ', COALESCE(nrc.State, d.Doctor_AddressState), ' ', COALESCE(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))
              ELSE '' END
          )))
          ELSE LTRIM(RTRIM(CONCAT(p.Address1, CASE WHEN p.City IS NOT NULL THEN CONCAT(', ', p.City, ' ', p.State, ' ', p.Zip) ELSE '' END)))
        END AS StopAddress,
        CASE
          WHEN t.TargetType = 'doctor' THEN
            CASE
              WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
                OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781', '33782')
                THEN CAST(27.8428 AS DECIMAL(10,7))
              ELSE NULL
            END
          ELSE p.Latitude
        END AS StopLatitude,
        CASE
          WHEN t.TargetType = 'doctor' THEN
            CASE
              WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
                OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781', '33782')
                THEN CAST(-82.6995 AS DECIMAL(10,7))
              ELSE NULL
            END
          ELSE p.Longitude
        END AS StopLongitude
      FROM dbo.PharmacyFlyer_CampaignTarget t
      LEFT JOIN dbo.Master_Doctor d ON d.ID = t.DoctorId
      LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = t.NPI
      LEFT JOIN dbo.PharmacyFlyer_Pharmacy p ON p.PharmacyId = t.PharmacyId
      WHERE t.CampaignTargetId = @CampaignTargetId
    `);

  const target = result.recordset[0];
  if (!target) return null;
  if (!APPROVED_STATUSES.includes(String(target.ApprovalStatus))) {
    throw new Error(`Campaign target ${targetId} is not approved`);
  }
  return target;
}

async function getNextStopOrder(routeId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteId', sql.Int, routeId)
    .query(`SELECT ISNULL(MAX(StopOrder), 0) AS MaxOrder FROM dbo.PharmacyFlyer_RouteStop WHERE RouteId = @RouteId`);
  return Number(result.recordset[0]?.MaxOrder ?? 0) + 1;
}

const ROUTE_SELECT = `
  r.RouteId,
  r.RouteName,
  r.RouteDate,
  r.DistributorUserId,
  r.MarketId,
  r.StartType,
  r.StartAddress,
  r.StartLatitude,
  r.StartLongitude,
  r.Status,
  r.CreatedAt,
  r.UpdatedAt,
  m.MarketName,
  LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
  (SELECT COUNT(*) FROM dbo.PharmacyFlyer_RouteStop s WHERE s.RouteId = r.RouteId) AS StopCount,
  (SELECT COUNT(*) FROM dbo.PharmacyFlyer_RouteStop s WHERE s.RouteId = r.RouteId AND s.Status = 'completed') AS CompletedStopCount
`;

export async function createRoute(input: {
  routeName: string;
  routeDate?: string | null;
  distributorUserId?: number | null;
  marketId?: number | null;
  startType?: StartType;
  startAddress?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
}) {
  const startType = input.startType || 'home';
  const start = await resolveStartLocation({
    startType,
    distributorUserId: input.distributorUserId,
    startAddress: input.startAddress,
    startLatitude: input.startLatitude,
    startLongitude: input.startLongitude,
  });

  const pool = await getPool();
  const result = await pool.request()
    .input('RouteName', sql.NVarChar, input.routeName)
    .input('RouteDate', sql.Date, input.routeDate || toFloridaDateString())
    .input('DistributorUserId', sql.Int, input.distributorUserId ?? null)
    .input('MarketId', sql.Int, input.marketId ?? null)
    .input('StartType', sql.VarChar, startType)
    .input('StartAddress', sql.NVarChar, start.startAddress)
    .input('StartLatitude', sql.Decimal(10, 7), start.startLatitude)
    .input('StartLongitude', sql.Decimal(10, 7), start.startLongitude)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_Route (
        RouteName, RouteDate, DistributorUserId, MarketId, StartType,
        StartAddress, StartLatitude, StartLongitude, Status
      )
      OUTPUT INSERTED.RouteId
      VALUES (
        @RouteName, @RouteDate, @DistributorUserId, @MarketId, @StartType,
        @StartAddress, @StartLatitude, @StartLongitude, 'draft'
      )
    `);

  const routeId = result.recordset[0].RouteId;
  return getRouteById(routeId);
}

export async function listRoutes(filters: {
  distributorUserId?: number | null;
  routeDate?: string | null;
  status?: string | null;
  todayOnly?: boolean;
}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, Number.isFinite(filters.distributorUserId) ? filters.distributorUserId : null)
    .input('RouteDate', sql.Date, filters.routeDate || null)
    .input('Status', sql.VarChar, filters.status || null)
    .input('TodayOnly', sql.Bit, filters.todayOnly ? 1 : 0)
    .query(`
      SELECT ${ROUTE_SELECT}
      FROM dbo.PharmacyFlyer_Route r
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = r.MarketId
      LEFT JOIN dbo.Master_User u ON u.ID = r.DistributorUserId
      WHERE (@DistributorUserId IS NULL OR r.DistributorUserId = @DistributorUserId)
        AND (@RouteDate IS NULL OR r.RouteDate = @RouteDate)
        AND (@Status IS NULL OR r.Status = @Status)
        AND (@TodayOnly = 0 OR r.RouteDate = ${FLORIDA_SQL_TODAY})
      ORDER BY r.RouteDate DESC, r.RouteName
    `);

  return result.recordset;
}

export async function getRouteStops(routeId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteId', sql.Int, routeId)
    .query(`
      SELECT
        s.*,
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
        END AS VisitDueStatus
      FROM dbo.PharmacyFlyer_RouteStop s
      LEFT JOIN dbo.PharmacyFlyer_CampaignTarget t ON t.CampaignTargetId = s.CampaignTargetId
      WHERE s.RouteId = @RouteId
      ORDER BY s.StopOrder
    `);
  return result.recordset;
}

export async function getRouteById(routeId: number, distributorUserId?: number | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteId', sql.Int, routeId)
    .input('DistributorUserId', sql.Int, Number.isFinite(distributorUserId) ? distributorUserId : null)
    .query(`
      SELECT ${ROUTE_SELECT}
      FROM dbo.PharmacyFlyer_Route r
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = r.MarketId
      LEFT JOIN dbo.Master_User u ON u.ID = r.DistributorUserId
      WHERE r.RouteId = @RouteId
        AND (@DistributorUserId IS NULL OR r.DistributorUserId = @DistributorUserId)
    `);

  const route = result.recordset[0];
  if (!route) return null;

  const stops = await getRouteStops(routeId);
  const mapData = buildMapData(route, stops);
  return { ...route, stops, mapData };
}

function buildMapData(route: Record<string, unknown>, stops: Array<Record<string, unknown>>) {
  return {
    start: {
      label: route.StartType === 'home' ? 'Home' : route.StartType === 'current' ? 'Current location' : 'Start',
      address: route.StartAddress,
      latitude: route.StartLatitude != null ? Number(route.StartLatitude) : null,
      longitude: route.StartLongitude != null ? Number(route.StartLongitude) : null,
    },
    stops: stops.map((stop) => ({
      routeStopId: stop.RouteStopId,
      stopOrder: stop.StopOrder,
      label: stop.StopLabel,
      address: stop.StopAddress,
      latitude: stop.StopLatitude != null ? Number(stop.StopLatitude) : null,
      longitude: stop.StopLongitude != null ? Number(stop.StopLongitude) : null,
      assignedFlyerName: stop.AssignedFlyerName,
      targetType: stop.TargetType,
      status: stop.Status,
    })),
  };
}

export async function updateRoute(routeId: number, input: {
  routeName?: string;
  routeDate?: string | null;
  distributorUserId?: number | null;
  marketId?: number | null;
  startType?: StartType;
  startAddress?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
}) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('RouteId', sql.Int, routeId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
  const route = existing.recordset[0];
  if (!route) return null;
  if (route.Status === 'cancelled' || route.Status === 'completed') {
    throw new Error('Cannot update a completed or cancelled route');
  }

  const startType = (input.startType || route.StartType) as StartType;
  const distributorUserId = input.distributorUserId ?? route.DistributorUserId;
  const start = await resolveStartLocation({
    startType,
    distributorUserId,
    startAddress: input.startAddress ?? route.StartAddress,
    startLatitude: input.startLatitude ?? route.StartLatitude,
    startLongitude: input.startLongitude ?? route.StartLongitude,
  });

  await pool.request()
    .input('RouteId', sql.Int, routeId)
    .input('RouteName', sql.NVarChar, input.routeName ?? route.RouteName)
    .input('RouteDate', sql.Date, input.routeDate ?? route.RouteDate)
    .input('DistributorUserId', sql.Int, distributorUserId)
    .input('MarketId', sql.Int, input.marketId ?? route.MarketId)
    .input('StartType', sql.VarChar, startType)
    .input('StartAddress', sql.NVarChar, start.startAddress)
    .input('StartLatitude', sql.Decimal(10, 7), start.startLatitude)
    .input('StartLongitude', sql.Decimal(10, 7), start.startLongitude)
    .query(`
      UPDATE dbo.PharmacyFlyer_Route
      SET
        RouteName = @RouteName,
        RouteDate = @RouteDate,
        DistributorUserId = @DistributorUserId,
        MarketId = @MarketId,
        StartType = @StartType,
        StartAddress = @StartAddress,
        StartLatitude = @StartLatitude,
        StartLongitude = @StartLongitude,
        UpdatedAt = SYSDATETIME()
      WHERE RouteId = @RouteId
    `);

  return getRouteById(routeId);
}

export async function addStopsToRoute(
  routeId: number,
  campaignTargetIds: number[],
  options?: { allowEarlyAssignment?: boolean },
) {
  const pool = await getPool();
  const route = await pool.request()
    .input('RouteId', sql.Int, routeId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
  if (!route.recordset[0]) throw new Error('Route not found');
  if (['cancelled', 'completed'].includes(String(route.recordset[0].Status))) {
    throw new Error('Cannot add stops to a completed or cancelled route');
  }

  const allowEarly = Boolean(options?.allowEarlyAssignment);
  const added: Array<Record<string, unknown>> = [];
  const skippedEarly: Array<{ campaignTargetId: number; nextDueDate?: string | null; targetName?: string }> = [];
  let stopOrder = await getNextStopOrder(routeId);

  for (const targetId of campaignTargetIds) {
    const exists = await pool.request()
      .input('RouteId', sql.Int, routeId)
      .input('CampaignTargetId', sql.Int, targetId)
      .query(`
        SELECT TOP 1 RouteStopId FROM dbo.PharmacyFlyer_RouteStop
        WHERE RouteId = @RouteId AND CampaignTargetId = @CampaignTargetId
      `);
    if (exists.recordset[0]) continue;

    const target = await loadApprovedTarget(targetId);
    if (!target) continue;

    const due = isTargetDueForVisit({
      visitFrequencyType: target.VisitFrequencyType,
      nextDueDate: target.NextDueDate,
      lastVisitedAt: target.LastVisitedAt,
    });
    if (!due && !allowEarly) {
      skippedEarly.push({
        campaignTargetId: targetId,
        nextDueDate: target.NextDueDate ?? null,
        targetName: target.StopLabel ? String(target.StopLabel) : undefined,
      });
      continue;
    }

    const insert = await pool.request()
      .input('RouteId', sql.Int, routeId)
      .input('StopOrder', sql.Int, stopOrder++)
      .input('CampaignTargetId', sql.Int, target.CampaignTargetId)
      .input('CampaignId', sql.Int, target.CampaignId)
      .input('CampaignConfigId', sql.Int, target.CampaignConfigId)
      .input('TargetType', sql.VarChar, target.TargetType)
      .input('DoctorId', sql.Int, target.DoctorId)
      .input('NPI', sql.VarChar, target.NPI)
      .input('PharmacyId', sql.Int, target.PharmacyId)
      .input('AssignedFlyerName', sql.NVarChar, target.AssignedFlyerName)
      .input('StopLabel', sql.NVarChar, target.StopLabel)
      .input('StopAddress', sql.NVarChar, target.StopAddress)
      .input('StopLatitude', sql.Decimal(10, 7), target.StopLatitude)
      .input('StopLongitude', sql.Decimal(10, 7), target.StopLongitude)
      .input('CheckInRequired', sql.Bit, target.CheckInRequired ?? true)
      .input('ProofUploadRequired', sql.Bit, target.ProofUploadRequired ?? true)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_RouteStop (
          RouteId, StopOrder, CampaignTargetId, CampaignId, CampaignConfigId, TargetType,
          DoctorId, NPI, PharmacyId, AssignedFlyerName, StopLabel, StopAddress,
          StopLatitude, StopLongitude, CheckInRequired, ProofUploadRequired, Status
        )
        OUTPUT INSERTED.*
        VALUES (
          @RouteId, @StopOrder, @CampaignTargetId, @CampaignId, @CampaignConfigId, @TargetType,
          @DoctorId, @NPI, @PharmacyId, @AssignedFlyerName, @StopLabel, @StopAddress,
          @StopLatitude, @StopLongitude, @CheckInRequired, @ProofUploadRequired, 'pending'
        )
      `);
    if (insert.recordset[0]) added.push(insert.recordset[0]);
  }

  if (!added.length && skippedEarly.length) {
    const names = skippedEarly.map((s) => s.targetName || `#${s.campaignTargetId}`).join(', ');
    throw new Error(
      `No stops added. These targets are not due yet (next due date in the future): ${names}. Use allowEarlyAssignment to override.`,
    );
  }

  return {
    addedCount: added.length,
    skippedEarly,
    stops: added,
    route: await getRouteById(routeId),
  };
}

export async function reorderRouteStops(routeId: number, stopIdsInOrder: number[]) {
  const pool = await getPool();
  for (let i = 0; i < stopIdsInOrder.length; i++) {
    await pool.request()
      .input('RouteStopId', sql.Int, stopIdsInOrder[i])
      .input('RouteId', sql.Int, routeId)
      .input('StopOrder', sql.Int, i + 1)
      .query(`
        UPDATE dbo.PharmacyFlyer_RouteStop
        SET StopOrder = @StopOrder, UpdatedAt = SYSDATETIME()
        WHERE RouteStopId = @RouteStopId AND RouteId = @RouteId
      `);
  }
  return getRouteById(routeId);
}

export async function sortRouteStopsByNearest(routeId: number) {
  const route = await getRouteById(routeId);
  if (!route) throw new Error('Route not found');

  const startLat = route.StartLatitude != null ? Number(route.StartLatitude) : null;
  const startLng = route.StartLongitude != null ? Number(route.StartLongitude) : null;
  if (startLat == null || startLng == null) {
    throw new Error('Route start location must have coordinates for nearest sorting');
  }

  const stops = [...route.stops].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aLat = a.StopLatitude != null ? Number(a.StopLatitude) : null;
    const aLng = a.StopLongitude != null ? Number(a.StopLongitude) : null;
    const bLat = b.StopLatitude != null ? Number(b.StopLatitude) : null;
    const bLng = b.StopLongitude != null ? Number(b.StopLongitude) : null;
    const aDist = aLat != null && aLng != null ? milesBetween(startLat, startLng, aLat, aLng) : Number.MAX_VALUE;
    const bDist = bLat != null && bLng != null ? milesBetween(startLat, startLng, bLat, bLng) : Number.MAX_VALUE;
    return aDist - bDist;
  });

  return reorderRouteStops(routeId, stops.map((s: Record<string, unknown>) => Number(s.RouteStopId)));
}

export async function assignRoute(routeId: number, distributorUserId?: number | null) {
  const pool = await getPool();
  const route = await getRouteById(routeId);
  if (!route) throw new Error('Route not found');
  if (!route.stops?.length) throw new Error('Route must have at least one stop before assignment');

  const userId = distributorUserId ?? route.DistributorUserId;
  if (!userId) throw new Error('Distributor is required to assign route');

  await pool.request()
    .input('RouteId', sql.Int, routeId)
    .input('DistributorUserId', sql.Int, userId)
    .input('Status', sql.VarChar, 'assigned')
    .query(`
      UPDATE dbo.PharmacyFlyer_Route
      SET DistributorUserId = @DistributorUserId, Status = @Status, UpdatedAt = SYSDATETIME()
      WHERE RouteId = @RouteId
    `);

  return getRouteById(routeId);
}

export async function cancelRoute(routeId: number) {
  const pool = await getPool();
  await pool.request()
    .input('RouteId', sql.Int, routeId)
    .query(`
      UPDATE dbo.PharmacyFlyer_Route
      SET Status = 'cancelled', UpdatedAt = SYSDATETIME()
      WHERE RouteId = @RouteId AND Status NOT IN ('completed', 'cancelled')
    `);
  return getRouteById(routeId);
}

export async function removeRouteStop(routeId: number, routeStopId: number) {
  const pool = await getPool();
  await pool.request()
    .input('RouteId', sql.Int, routeId)
    .input('RouteStopId', sql.Int, routeStopId)
    .query(`
      DELETE FROM dbo.PharmacyFlyer_RouteStop
      WHERE RouteId = @RouteId AND RouteStopId = @RouteStopId
    `);

  const stops = await getRouteStops(routeId);
  await reorderRouteStops(routeId, stops.map((s: { RouteStopId: number }) => s.RouteStopId));
  return getRouteById(routeId);
}

export async function completeRouteStop(
  routeId: number,
  routeStopId: number,
  input?: { notes?: string | null; skippedReason?: string | null; status?: 'completed' | 'skipped' | 'failed' },
  distributorUserId?: number | null,
) {
  const pool = await getPool();
  const route = await getRouteById(routeId, distributorUserId ?? null);
  if (!route) throw new Error('Route not found');

  const stop = route.stops?.find((s: Record<string, unknown>) => Number(s.RouteStopId) === routeStopId);
  if (!stop) throw new Error('Route stop not found');

  const status = input?.status || 'completed';
  const completedAt = status === 'completed' ? new Date() : null;

  await pool.request()
    .input('RouteStopId', sql.Int, routeStopId)
    .input('RouteId', sql.Int, routeId)
    .input('Status', sql.VarChar, status)
    .input('CompletedAt', sql.DateTime2, completedAt)
    .input('Notes', sql.NVarChar, input?.notes ?? null)
    .input('SkippedReason', sql.NVarChar, input?.skippedReason ?? null)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteStop
      SET
        Status = @Status,
        CompletedAt = @CompletedAt,
        Notes = COALESCE(@Notes, Notes),
        SkippedReason = @SkippedReason,
        UpdatedAt = SYSDATETIME()
      WHERE RouteStopId = @RouteStopId AND RouteId = @RouteId
    `);

  if (status === 'completed' && stop.CampaignTargetId) {
    await recordTargetVisit(Number(stop.CampaignTargetId), completedAt || new Date());
  }

  const refreshed = await getRouteById(routeId, distributorUserId ?? null);
  const pending = refreshed?.stops?.filter((s: Record<string, unknown>) => s.Status === 'pending').length ?? 0;
  if (pending === 0 && refreshed?.stops?.length) {
    await pool.request()
      .input('RouteId', sql.Int, routeId)
      .query(`
        UPDATE dbo.PharmacyFlyer_Route
        SET Status = 'completed', UpdatedAt = SYSDATETIME()
        WHERE RouteId = @RouteId AND Status IN ('assigned', 'in_progress')
      `);
  } else if (status === 'completed') {
    await pool.request()
      .input('RouteId', sql.Int, routeId)
      .query(`
        UPDATE dbo.PharmacyFlyer_Route
        SET Status = 'in_progress', UpdatedAt = SYSDATETIME()
        WHERE RouteId = @RouteId AND Status = 'assigned'
      `);
  }

  return getRouteById(routeId, distributorUserId ?? null);
}
