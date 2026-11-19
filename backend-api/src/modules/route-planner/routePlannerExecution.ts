import { getPool, sql } from '../../config/db.js';
import { getRoutePlanById } from './routePlannerPlans.js';
import {
  assertCanCompleteLocationVisit,
  LocationVisitBlockedError,
  pruneUnavailableStopsOnPlan,
  releaseHoldForLocation,
} from './routePlannerLocationHold.js';

function parseDate(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const trimmed = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : new Date().toISOString().slice(0, 10);
}

export async function listAssignableReps() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      u.ID AS userId,
      u.User_Id AS userCode,
      LTRIM(RTRIM(u.User_FirstName)) AS firstName,
      LTRIM(RTRIM(u.User_LastName)) AS lastName,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS fullName,
      LTRIM(RTRIM(u.User_Email)) AS email,
      LTRIM(RTRIM(u.User_Phone)) AS phone
    FROM dbo.Master_User u
    WHERE ISNULL(u.User_IsActive, 0) = 1
    ORDER BY u.User_FirstName, u.User_LastName, u.User_Id
  `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    userId: row.userId,
    userCode: row.userCode,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
  }));
}

async function refreshRoutePlanStatus(pool: Awaited<ReturnType<typeof getPool>>, routePlanId: number) {
  const summary = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT
        COUNT(*) AS TotalStops,
        SUM(CASE WHEN s.Status IN ('completed', 'skipped') THEN 1 ELSE 0 END) AS CompletedStops
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      WHERE s.RoutePlanId = @RoutePlanId
    `);

  const totalStops = Number(summary.recordset[0]?.TotalStops ?? 0);
  const completedStops = Number(summary.recordset[0]?.CompletedStops ?? 0);

  let status = 'assigned';
  if (totalStops > 0 && completedStops >= totalStops) {
    status = 'completed';
  } else if (completedStops > 0) {
    status = 'in_progress';
  } else {
    const plan = await pool.request()
      .input('RoutePlanId', sql.BigInt, routePlanId)
      .query(`SELECT Status, AssignedUserId FROM dbo.PharmacyFlyer_RoutePlanV2 WHERE RoutePlanId = @RoutePlanId`);
    const current = plan.recordset[0];
    if (current?.AssignedUserId) status = 'assigned';
    else status = String(current?.Status || 'draft');
  }

  await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .input('Status', sql.VarChar, status)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanV2
      SET Status = @Status
      WHERE RoutePlanId = @RoutePlanId
    `);

  return status;
}

export async function assignRoutePlan(routePlanId: number, assignedUserId: number) {
  const pool = await getPool();

  const userCheck = await pool.request()
    .input('UserId', sql.Int, assignedUserId)
    .query(`
      SELECT TOP 1 ID
      FROM dbo.Master_User
      WHERE ID = @UserId AND ISNULL(User_IsActive, 0) = 1
    `);
  if (!userCheck.recordset[0]) {
    throw new Error('Assigned user not found or inactive.');
  }

  await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .input('AssignedUserId', sql.Int, assignedUserId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanV2
      SET AssignedUserId = @AssignedUserId,
          Status = CASE WHEN Status = 'completed' THEN Status ELSE 'assigned' END
      WHERE RoutePlanId = @RoutePlanId
    `);

  return getRoutePlanById(routePlanId);
}

export async function clearAssignedRoutePlansForUserDate(userId: number, planDate?: string | null) {
  const pool = await getPool();
  const date = parseDate(planDate);
  await pool.request()
    .input('AssignedUserId', sql.Int, userId)
    .input('PlanDate', sql.Date, date)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanV2
      SET AssignedUserId = NULL, Status = 'draft'
      WHERE AssignedUserId = @AssignedUserId
        AND PlanDate = @PlanDate
        AND Status IN ('assigned', 'in_progress')
    `);
}

export async function listMyRoutePlans(userId: number, routeDate?: string | null) {
  const pool = await getPool();
  const date = parseDate(routeDate);

  const activeCheckIn = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT TOP 1 RoutePlanId
      FROM dbo.PharmacyFlyer_RouteCheckInV2
      WHERE UserId = @UserId AND CheckOutAt IS NULL
      ORDER BY CheckInAt DESC
    `);

  const activeRow = activeCheckIn.recordset[0];
  if (activeRow) {
    const routePlanId = activeRow.RoutePlanId != null ? Number(activeRow.RoutePlanId) : null;
    if (!routePlanId) {
      return { date, plans: [] };
    }
    await pruneUnavailableStopsOnPlan(routePlanId, userId);
    const plan = await getRoutePlanById(routePlanId);
    return { date, plans: plan ? [plan] : [] };
  }

  const plansResult = await pool.request()
    .input('AssignedUserId', sql.Int, userId)
    .input('PlanDate', sql.Date, date)
    .query(`
      SELECT RoutePlanId
      FROM dbo.PharmacyFlyer_RoutePlanV2
      WHERE AssignedUserId = @AssignedUserId
        AND PlanDate = @PlanDate
        AND Status IN ('assigned', 'in_progress', 'completed')
      ORDER BY RoutePlanId DESC
    `);

  const plans = [];
  for (const row of plansResult.recordset) {
    const plan = await getRoutePlanById(Number(row.RoutePlanId));
    if (plan) plans.push(plan);
  }

  return { date, plans };
}

export { LocationVisitBlockedError } from './routePlannerLocationHold.js';

async function loadStopVisitContext(routePlanStopId: number) {
  const pool = await getPool();
  const stopResult = await pool.request()
    .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
    .query(`
      SELECT
        s.RoutePlanStopId,
        s.RoutePlanId,
        s.LocationKey,
        s.Status AS StopStatus,
        p.AssignedUserId,
        p.PlanDate
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
      WHERE s.RoutePlanStopId = @RoutePlanStopId
    `);

  const stop = stopResult.recordset[0] as Record<string, unknown> | undefined;
  if (!stop) return null;

  const dropsResult = await pool.request()
    .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
    .query(`
      SELECT DoctorId
      FROM dbo.PharmacyFlyer_RoutePlanDropV2
      WHERE RoutePlanStopId = @RoutePlanStopId AND DoctorId IS NOT NULL
    `);

  const doctorIds = (dropsResult.recordset as Record<string, unknown>[])
    .map((row) => Number(row.DoctorId))
    .filter((id) => Number.isFinite(id) && id > 0);

  const planDate = stop.PlanDate instanceof Date
    ? stop.PlanDate.toISOString().slice(0, 10)
    : String(stop.PlanDate ?? '').slice(0, 10);

  return {
    routePlanStopId: Number(stop.RoutePlanStopId),
    routePlanId: Number(stop.RoutePlanId),
    locationKey: stop.LocationKey != null ? String(stop.LocationKey).trim() : '',
    stopStatus: String(stop.StopStatus || ''),
    assignedUserId: stop.AssignedUserId != null ? Number(stop.AssignedUserId) : null,
    planDate,
    doctorIds,
  };
}


export async function completeRoutePlanStop(routePlanStopId: number, userId?: number | null) {
  const pool = await getPool();

  const context = await loadStopVisitContext(routePlanStopId);
  if (!context) return null;
  if (userId && context.assignedUserId != null && context.assignedUserId !== Number(userId)) {
    throw new Error('This route is assigned to another user.');
  }
  if (!context.locationKey) {
    throw new Error('This stop has no location key.');
  }

  await assertCanCompleteLocationVisit({
    locationKey: context.locationKey,
    doctorIds: context.doctorIds,
    actingUserId: userId ?? context.assignedUserId ?? 0,
    planDate: context.planDate,
    onAssignedRoute: true,
  });

  await pool.request()
    .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanDropV2
      SET Status = 'completed', CompletedAt = SYSDATETIME()
      WHERE RoutePlanStopId = @RoutePlanStopId AND Status NOT IN ('completed', 'skipped')
    `);

  await pool.request()
    .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanStopV2
      SET Status = 'completed', CompletedAt = SYSDATETIME()
      WHERE RoutePlanStopId = @RoutePlanStopId
    `);

  await releaseHoldForLocation(
    context.locationKey,
    context.planDate,
    userId ?? context.assignedUserId ?? null,
  );

  const routePlanId = context.routePlanId;
  await refreshRoutePlanStatus(pool, routePlanId);
  return getRoutePlanById(routePlanId);
}

export async function completeRoutePlanDrop(
  routePlanDropId: number,
  userId?: number | null,
  options?: { sameVisit?: boolean },
) {
  const pool = await getPool();

  const dropResult = await pool.request()
    .input('RoutePlanDropId', sql.BigInt, routePlanDropId)
    .query(`
      SELECT
        d.RoutePlanDropId,
        d.RoutePlanStopId,
        d.DoctorId,
        d.Status AS DropStatus,
        s.RoutePlanId,
        s.LocationKey,
        s.Status AS StopStatus,
        p.AssignedUserId,
        p.PlanDate
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 d
      INNER JOIN dbo.PharmacyFlyer_RoutePlanStopV2 s ON s.RoutePlanStopId = d.RoutePlanStopId
      INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
      WHERE d.RoutePlanDropId = @RoutePlanDropId
    `);

  const drop = dropResult.recordset[0] as Record<string, unknown> | undefined;
  if (!drop) return null;
  if (userId && drop.AssignedUserId != null && Number(drop.AssignedUserId) !== Number(userId)) {
    throw new Error('This route is assigned to another user.');
  }

  const routePlanStopId = Number(drop.RoutePlanStopId);
  const locationKey = drop.LocationKey != null ? String(drop.LocationKey).trim() : '';
  if (!locationKey) {
    throw new Error('This stop has no location key.');
  }

  const planDate = drop.PlanDate instanceof Date
    ? drop.PlanDate.toISOString().slice(0, 10)
    : String(drop.PlanDate ?? '').slice(0, 10);

  const context = await loadStopVisitContext(routePlanStopId);
  const doctorIds = context?.doctorIds.length
    ? context.doctorIds
    : (drop.DoctorId != null ? [Number(drop.DoctorId)] : []);

  await assertCanCompleteLocationVisit({
    locationKey,
    doctorIds,
    actingUserId: userId ?? Number(drop.AssignedUserId) ?? 0,
    planDate,
    sameVisit: options?.sameVisit,
    onAssignedRoute: true,
  });

  if (String(drop.DropStatus) === 'completed') {
    return getRoutePlanById(Number(drop.RoutePlanId));
  }

  await pool.request()
    .input('RoutePlanDropId', sql.BigInt, routePlanDropId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanDropV2
      SET Status = 'completed', CompletedAt = SYSDATETIME()
      WHERE RoutePlanDropId = @RoutePlanDropId
    `);

  const pending = await pool.request()
    .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
    .query(`
      SELECT COUNT(*) AS PendingCount
      FROM dbo.PharmacyFlyer_RoutePlanDropV2
      WHERE RoutePlanStopId = @RoutePlanStopId AND Status NOT IN ('completed', 'skipped')
    `);

  if (Number(pending.recordset[0]?.PendingCount ?? 0) === 0) {
    await pool.request()
      .input('RoutePlanStopId', sql.BigInt, routePlanStopId)
      .query(`
        UPDATE dbo.PharmacyFlyer_RoutePlanStopV2
        SET Status = 'completed', CompletedAt = SYSDATETIME()
        WHERE RoutePlanStopId = @RoutePlanStopId
      `);
    await releaseHoldForLocation(
      locationKey,
      planDate,
      userId ?? (drop.AssignedUserId != null ? Number(drop.AssignedUserId) : null),
    );
  }

  const routePlanId = Number(drop.RoutePlanId);
  await refreshRoutePlanStatus(pool, routePlanId);
  return getRoutePlanById(routePlanId);
}
