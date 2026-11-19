import { getPool, sql } from '../../config/db.js';
import { toFloridaDateString } from '../../utils/timezone.js';
import {
  computeLocationVisit,
  getLastVisitDateByDoctorsAllCampaigns,
  getLocationVisitFrequencies,
} from './routePlannerVisit.js';
import { DEFAULT_VISIT_FREQUENCY_DAYS } from './routePlannerConfig.js';

/** Auto check-out open sessions older than this many hours. */
export const STALE_SESSION_HOURS = 14;

export class LocationVisitBlockedError extends Error {
  readonly code: 'already_visited' | 'held_by_other' | 'not_due';

  constructor(message: string, code: LocationVisitBlockedError['code']) {
    super(message);
    this.name = 'LocationVisitBlockedError';
    this.code = code;
  }
}

function parsePlanDate(value?: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0, 10))) {
    return String(value).slice(0, 10);
  }
  return toFloridaDateString();
}

/** Close any open check-in sessions for this user and release their holds. */
export async function autoCloseOpenSessionsForUser(userId: number) {
  const pool = await getPool();

  const openSessions = await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      SELECT RouteCheckInId
      FROM dbo.PharmacyFlyer_RouteCheckInV2
      WHERE UserId = @UserId AND CheckOutAt IS NULL
    `);

  if (!openSessions.recordset.length) return;

  await pool.request()
    .input('UserId', sql.Int, userId)
    .query(`
      UPDATE dbo.PharmacyFlyer_RouteCheckInV2
      SET CheckOutAt = SYSDATETIME()
      WHERE UserId = @UserId AND CheckOutAt IS NULL
    `);

  for (const row of openSessions.recordset as Record<string, unknown>[]) {
    await releaseHoldsForCheckIn(Number(row.RouteCheckInId));
  }
}

/** Close forgotten sessions (prior calendar day or older than STALE_SESSION_HOURS). */
export async function autoCloseStaleSessionsForUser(userId: number) {
  const pool = await getPool();
  const staleHours = STALE_SESSION_HOURS;

  const stale = await pool.request()
    .input('UserId', sql.Int, userId)
    .input('StaleHours', sql.Int, staleHours)
    .query(`
      SELECT RouteCheckInId
      FROM dbo.PharmacyFlyer_RouteCheckInV2
      WHERE UserId = @UserId
        AND CheckOutAt IS NULL
        AND (
          CheckInAt < DATEADD(hour, -@StaleHours, SYSDATETIME())
          OR CAST(CheckInAt AS DATE) < CAST(
            (SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE
          )
        )
    `);

  if (!stale.recordset.length) return;

  for (const row of stale.recordset as Record<string, unknown>[]) {
    const checkInId = Number(row.RouteCheckInId);
    await pool.request()
      .input('RouteCheckInId', sql.BigInt, checkInId)
      .input('UserId', sql.Int, userId)
      .query(`
        UPDATE dbo.PharmacyFlyer_RouteCheckInV2
        SET CheckOutAt = SYSDATETIME()
        WHERE RouteCheckInId = @RouteCheckInId
          AND UserId = @UserId
          AND CheckOutAt IS NULL
      `);
    await releaseHoldsForCheckIn(checkInId);
  }
}

export async function getActiveHeldLocationKeys(
  planDate: string,
  excludeUserId?: number | null,
): Promise<Set<string>> {
  const pool = await getPool();
  const request = pool.request().input('PlanDate', sql.Date, planDate);
  let userFilter = '';
  if (excludeUserId != null && Number.isFinite(excludeUserId)) {
    request.input('ExcludeUserId', sql.Int, excludeUserId);
    userFilter = 'AND h.HeldByUserId <> @ExcludeUserId';
  }

  const result = await request.query(`
    SELECT h.LocationKey
    FROM dbo.PharmacyFlyer_LocationHoldV2 h
    WHERE h.PlanDate = @PlanDate
      AND h.ReleasedAt IS NULL
      ${userFilter}
  `);

  return new Set(
    (result.recordset as Record<string, unknown>[])
      .map((row) => String(row.LocationKey || '').trim())
      .filter(Boolean),
  );
}

/** Atomically claim a location for today. Returns false if another rep holds it. */
export async function tryClaimLocationHold(
  userId: number,
  locationKey: string,
  planDate?: string | null,
): Promise<boolean> {
  const key = String(locationKey || '').trim();
  if (!key) return false;

  const pool = await getPool();
  const date = parsePlanDate(planDate);
  const result = await pool.request()
    .input('LocationKey', sql.NVarChar, key)
    .input('PlanDate', sql.Date, date)
    .input('HeldByUserId', sql.Int, userId)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_LocationHoldV2 (
        LocationKey, PlanDate, HeldByUserId
      )
      SELECT @LocationKey, @PlanDate, @HeldByUserId
      WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.PharmacyFlyer_LocationHoldV2 h
        WHERE h.LocationKey = @LocationKey
          AND h.PlanDate = @PlanDate
          AND h.ReleasedAt IS NULL
      );
      SELECT @@ROWCOUNT AS Inserted;
    `);

  return Number(result.recordset[0]?.Inserted ?? 0) > 0;
}

export async function attachHoldsToSession(input: {
  userId: number;
  planDate: string;
  checkInId: number;
  routePlanId: number;
  stops: { locationKey: string; routePlanStopId: number }[];
}) {
  const pool = await getPool();
  for (const stop of input.stops) {
    const key = String(stop.locationKey || '').trim();
    if (!key) continue;
    await pool.request()
      .input('LocationKey', sql.NVarChar, key)
      .input('PlanDate', sql.Date, input.planDate)
      .input('HeldByUserId', sql.Int, input.userId)
      .input('RouteCheckInId', sql.BigInt, input.checkInId)
      .input('RoutePlanId', sql.BigInt, input.routePlanId)
      .input('RoutePlanStopId', sql.BigInt, stop.routePlanStopId)
      .query(`
        UPDATE dbo.PharmacyFlyer_LocationHoldV2
        SET RouteCheckInId = @RouteCheckInId,
            RoutePlanId = @RoutePlanId,
            RoutePlanStopId = @RoutePlanStopId
        WHERE LocationKey = @LocationKey
          AND PlanDate = @PlanDate
          AND HeldByUserId = @HeldByUserId
          AND ReleasedAt IS NULL
      `);
  }
}

export async function releaseHoldsForCheckIn(checkInId: number) {
  const pool = await getPool();
  await pool.request()
    .input('RouteCheckInId', sql.BigInt, checkInId)
    .query(`
      UPDATE dbo.PharmacyFlyer_LocationHoldV2
      SET ReleasedAt = SYSDATETIME()
      WHERE RouteCheckInId = @RouteCheckInId
        AND ReleasedAt IS NULL
    `);
}

export async function releaseHoldsForUserOnDate(userId: number, planDate?: string | null) {
  const pool = await getPool();
  await pool.request()
    .input('HeldByUserId', sql.Int, userId)
    .input('PlanDate', sql.Date, parsePlanDate(planDate))
    .query(`
      UPDATE dbo.PharmacyFlyer_LocationHoldV2
      SET ReleasedAt = SYSDATETIME()
      WHERE HeldByUserId = @HeldByUserId
        AND PlanDate = @PlanDate
        AND ReleasedAt IS NULL
    `);
}

export async function releaseHoldForLocation(
  locationKey: string,
  planDate: string,
  userId?: number | null,
) {
  const key = String(locationKey || '').trim();
  if (!key) return;

  const pool = await getPool();
  const request = pool.request()
    .input('LocationKey', sql.NVarChar, key)
    .input('PlanDate', sql.Date, parsePlanDate(planDate));

  let userFilter = '';
  if (userId != null && Number.isFinite(userId)) {
    request.input('HeldByUserId', sql.Int, userId);
    userFilter = 'AND HeldByUserId = @HeldByUserId';
  }

  await request.query(`
    UPDATE dbo.PharmacyFlyer_LocationHoldV2
    SET ReleasedAt = SYSDATETIME()
    WHERE LocationKey = @LocationKey
      AND PlanDate = @PlanDate
      AND ReleasedAt IS NULL
      ${userFilter}
  `);
}

async function getActiveHolder(
  locationKey: string,
  planDate: string,
  excludeUserId?: number | null,
): Promise<{ userId: number; fullName: string | null } | null> {
  const pool = await getPool();
  const request = pool.request()
    .input('LocationKey', sql.NVarChar, locationKey)
    .input('PlanDate', sql.Date, planDate);

  let userFilter = '';
  if (excludeUserId != null && Number.isFinite(excludeUserId)) {
    request.input('ExcludeUserId', sql.Int, excludeUserId);
    userFilter = 'AND h.HeldByUserId <> @ExcludeUserId';
  }

  const result = await request.query(`
    SELECT TOP 1
      h.HeldByUserId,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS FullName
    FROM dbo.PharmacyFlyer_LocationHoldV2 h
    LEFT JOIN dbo.Master_User u ON u.ID = h.HeldByUserId
    WHERE h.LocationKey = @LocationKey
      AND h.PlanDate = @PlanDate
      AND h.ReleasedAt IS NULL
      ${userFilter}
    ORDER BY h.HeldAt DESC
  `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    userId: Number(row.HeldByUserId),
    fullName: row.FullName != null ? String(row.FullName).trim() || null : null,
  };
}

async function getRecentCompleterAtLocation(
  locationKey: string,
): Promise<{ userId: number | null; fullName: string | null; completedAt: string | null } | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('LocationKey', sql.NVarChar, locationKey)
    .query(`
      SELECT TOP 1
        p.AssignedUserId,
        LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS FullName,
        s.CompletedAt
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
      LEFT JOIN dbo.Master_User u ON u.ID = p.AssignedUserId
      WHERE s.LocationKey = @LocationKey
        AND s.Status = 'completed'
        AND s.CompletedAt IS NOT NULL
      ORDER BY s.CompletedAt DESC
    `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const completedAt = row.CompletedAt instanceof Date
    ? row.CompletedAt.toISOString()
    : row.CompletedAt != null
      ? String(row.CompletedAt)
      : null;

  return {
    userId: row.AssignedUserId != null ? Number(row.AssignedUserId) : null,
    fullName: row.FullName != null ? String(row.FullName).trim() || null : null,
    completedAt,
  };
}

/** Returns a user-facing block reason, or null if the visit may proceed. */
export async function getLocationVisitBlockReason(input: {
  locationKey: string;
  doctorIds: number[];
  actingUserId: number;
  planDate?: string | null;
  /** When true, skip visit-frequency / already-visited checks (e.g. loading a check-in route). */
  ignoreVisitSchedule?: boolean;
}): Promise<string | null> {
  const locationKey = String(input.locationKey || '').trim();
  if (!locationKey) return 'Invalid location.';

  const planDate = parsePlanDate(input.planDate);
  const today = toFloridaDateString();
  const doctorIds = [...new Set(input.doctorIds.filter((id) => Number.isFinite(id) && id > 0))];

  if (!input.ignoreVisitSchedule) {
    const frequencies = await getLocationVisitFrequencies([locationKey]);
    const freq = frequencies.get(locationKey) ?? DEFAULT_VISIT_FREQUENCY_DAYS;
    const lastVisitByDoctor = doctorIds.length
      ? await getLastVisitDateByDoctorsAllCampaigns(doctorIds)
      : new Map<number, string>();
    const doctorDates = doctorIds.map((id) => lastVisitByDoctor.get(id) ?? null);
    const visit = computeLocationVisit(freq, doctorDates, today);

    if (!visit.isDue) {
      const recent = await getRecentCompleterAtLocation(locationKey);
      const nextDue = visit.nextVisitDate ? ` Next visit due ${visit.nextVisitDate}.` : '';
      if (recent?.userId != null && recent.userId === input.actingUserId) {
        return `You already completed this location.${nextDue}`;
      }
      const who = recent?.fullName ? recent.fullName : 'another rep';
      return `This location was already visited by ${who}.${nextDue}`;
    }
  }

  const holder = await getActiveHolder(locationKey, planDate, input.actingUserId);
  if (holder) {
    const who = holder.fullName || 'another rep';
    return `This location is being worked by ${who} right now. Check out and back in later if they finish.`;
  }

  return null;
}

export async function assertCanCompleteLocationVisit(input: {
  locationKey: string;
  doctorIds: number[];
  actingUserId: number;
  planDate?: string | null;
  /** Another flyer at a stop this rep is already dropping on this visit. */
  sameVisit?: boolean;
  /** This drop is on the route already assigned to this rep today. */
  onAssignedRoute?: boolean;
}) {
  const reason = await getLocationVisitBlockReason(input);
  if (!reason) return;
  if (input.onAssignedRoute && !reason.includes('being worked')) return;
  if (input.sameVisit && (reason.startsWith('You already completed this location') || reason.startsWith('This location was already visited'))) return;

  const code: LocationVisitBlockedError['code'] = reason.includes('being worked')
    ? 'held_by_other'
    : 'already_visited';
  throw new LocationVisitBlockedError(reason, code);
}

/** Mark pending stops unavailable to this rep and release their holds. */
export async function pruneUnavailableStopsOnPlan(routePlanId: number, userId: number) {
  const pool = await getPool();

  const planResult = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT RoutePlanId, PlanDate, AssignedUserId
      FROM dbo.PharmacyFlyer_RoutePlanV2
      WHERE RoutePlanId = @RoutePlanId
    `);
  const plan = planResult.recordset[0] as Record<string, unknown> | undefined;
  if (!plan || Number(plan.AssignedUserId) !== Number(userId)) return 0;

  const planDate = parsePlanDate(
    plan.PlanDate instanceof Date
      ? plan.PlanDate.toISOString().slice(0, 10)
      : String(plan.PlanDate ?? '').slice(0, 10),
  );

  const stopsResult = await pool.request()
    .input('RoutePlanId', sql.BigInt, routePlanId)
    .query(`
      SELECT s.RoutePlanStopId, s.LocationKey, s.Status
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      WHERE s.RoutePlanId = @RoutePlanId
        AND s.Status = 'pending'
        AND s.LocationKey IS NOT NULL
    `);

  let pruned = 0;
  for (const stop of stopsResult.recordset as Record<string, unknown>[]) {
    const locationKey = String(stop.LocationKey || '').trim();
    if (!locationKey) continue;

    const dropsResult = await pool.request()
      .input('RoutePlanStopId', sql.BigInt, Number(stop.RoutePlanStopId))
      .query(`
        SELECT DoctorId
        FROM dbo.PharmacyFlyer_RoutePlanDropV2
        WHERE RoutePlanStopId = @RoutePlanStopId AND DoctorId IS NOT NULL
      `);
    const doctorIds = (dropsResult.recordset as Record<string, unknown>[])
      .map((row) => Number(row.DoctorId))
      .filter((id) => Number.isFinite(id) && id > 0);

    const reason = await getLocationVisitBlockReason({
      locationKey,
      doctorIds,
      actingUserId: userId,
      planDate,
      ignoreVisitSchedule: true,
    });
    if (!reason) continue;

    await pool.request()
      .input('RoutePlanStopId', sql.BigInt, Number(stop.RoutePlanStopId))
      .query(`
        UPDATE dbo.PharmacyFlyer_RoutePlanStopV2
        SET Status = 'skipped', CompletedAt = SYSDATETIME()
        WHERE RoutePlanStopId = @RoutePlanStopId AND Status = 'pending';

        UPDATE dbo.PharmacyFlyer_RoutePlanDropV2
        SET Status = 'skipped', CompletedAt = SYSDATETIME()
        WHERE RoutePlanStopId = @RoutePlanStopId AND Status = 'pending';
      `);

    await releaseHoldForLocation(locationKey, planDate, userId);
    pruned += 1;
  }

  return pruned;
}
