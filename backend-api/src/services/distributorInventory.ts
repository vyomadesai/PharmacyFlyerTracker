import { getPool, sql } from '../config/db.js';
import { toFloridaDateString } from '../utils/timezone.js';
import { getUserProfile } from './userProfile.js';

const DEFAULT_CAPACITY = 25;
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;


type WorkflowAssignmentRow = {
  AssignmentId: number;
  CampaignId: number;
  CampaignName: string;
  FlyerTitle?: string | null;
  FlyerIdentifier?: string | null;
  AssignmentStatus?: string | null;
  ApprovalStatus?: string | null;
  RouteId?: number | null;
  RouteName?: string | null;
  RouteDate?: string | null;
  ScheduledDate?: string | null;
  RouteStopOrder?: number | null;
  TargetName?: string | null;
  AddressStreet?: string | null;
  AddressCity?: string | null;
  AddressState?: string | null;
  AddressZip?: string | null;
  IsBacklog?: boolean | number;
};

function normalizeStatus(value: unknown, fallback = 'assigned') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function flyerNameForAssignment(row: WorkflowAssignmentRow) {
  return row.FlyerTitle || row.FlyerIdentifier || row.CampaignName || 'Assigned flyer';
}

function addressLineForAssignment(row: WorkflowAssignmentRow) {
  const cityState = [row.AddressCity, row.AddressState].filter(Boolean).join(', ');
  return [row.AddressStreet, cityState || undefined, row.AddressZip || undefined]
    .filter(Boolean)
    .join(', ');
}

async function hasTable(tableName: string) {
  const pool = await getPool();
  const result = await pool.request()
    .input('TableName', sql.NVarChar, tableName)
    .query(`SELECT OBJECT_ID(CONCAT('dbo.', @TableName), 'U') AS ObjectId`);
  return Boolean(result.recordset[0]?.ObjectId);
}

export async function getTodayWorkflowAssignmentSummary(distributorUserId: number) {
  const hasAssignments = await hasTable('PharmacyFlyer_Assignment');
  const hasCampaigns = await hasTable('PharmacyFlyer_Campaign');
  if (!hasAssignments || !hasCampaigns) return null;

  const hasRoutes = await hasTable('PharmacyFlyer_Route');
  const routeJoin = hasRoutes
    ? 'LEFT JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = a.RouteId'
    : `OUTER APPLY (
        SELECT
          CAST(NULL AS BIGINT) AS RouteId,
          CAST(NULL AS NVARCHAR(200)) AS RouteName,
          CAST(NULL AS DATE) AS RouteDate
      ) r`;

  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .query(`
      ;WITH AssignmentRows AS (
        SELECT
          a.AssignmentId,
          a.CampaignId,
          c.CampaignName,
          c.FlyerTitle,
          c.FlyerIdentifier,
          a.ApprovalStatus,
          a.AssignmentStatus,
          a.ScheduledDate,
          a.RouteId,
          r.RouteName,
          r.RouteDate,
          a.RouteStopOrder,
          a.TargetName,
          a.AddressStreet,
          a.AddressCity,
          a.AddressState,
          a.AddressZip,
          CASE
            WHEN a.RouteId IS NOT NULL
              OR a.RouteStopOrder IS NOT NULL
              OR ISNULL(a.AssignmentStatus, 'approved') IN ('routed', 'checked_in', 'completed')
            THEN COALESCE(r.RouteDate, a.ScheduledDate)
            ELSE COALESCE(a.ScheduledDate, r.RouteDate)
          END AS EffectiveDate,
          CASE WHEN a.RouteId IS NULL THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsBacklog
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
        ${routeJoin}
        WHERE a.StaffUserId = @DistributorUserId
          AND (
            a.ApprovalStatus = 'approved'
            OR ISNULL(a.AssignmentStatus, '') IN ('approved', 'assigned', 'routed', 'checked_in', 'completed')
            OR a.RouteId IS NOT NULL
            OR a.RouteStopOrder IS NOT NULL
          )
          AND ISNULL(a.ApprovalStatus, '') NOT IN ('suggested', 'rejected')
          AND ISNULL(a.AssignmentStatus, 'approved') NOT IN ('skipped', 'rejected', 'failed')
      )
      SELECT *
      FROM AssignmentRows
      WHERE EffectiveDate = ${FLORIDA_SQL_TODAY}
      ORDER BY IsBacklog, RouteDate DESC, RouteId DESC, ISNULL(RouteStopOrder, 2147483647), TargetName
    `);

  const rows = result.recordset as WorkflowAssignmentRow[];
  if (!rows.length) return null;

  const flyersByCampaign = rows.reduce((acc: Record<string, unknown>[], row) => {
    const campaignKey = String(row.CampaignId);
    let group = acc.find((g) => String((g as { campaignId: number }).campaignId) === campaignKey);
    if (!group) {
      group = {
        campaignId: row.CampaignId,
        campaignName: row.CampaignName,
        flyers: [] as unknown[],
      };
      acc.push(group);
    }

    const flyerName = flyerNameForAssignment(row);
    const flyers = (group as { flyers: Array<Record<string, unknown>> }).flyers;
    let flyer = flyers.find((item) => item.flyerName === flyerName);
    if (!flyer) {
      flyer = {
        distributorInventoryId: Number(row.AssignmentId),
        flyerName,
        assignedQuantity: 0,
        deliveredQuantity: 0,
        remainingQuantity: 0,
        status: 'assigned',
        assignmentBatchId: row.RouteId ?? null,
      };
      flyers.push(flyer);
    }

    const status = normalizeStatus(row.AssignmentStatus, 'assigned');
    flyer.assignedQuantity = Number(flyer.assignedQuantity || 0) + 1;
    if (status === 'completed') {
      flyer.deliveredQuantity = Number(flyer.deliveredQuantity || 0) + 1;
    } else {
      flyer.remainingQuantity = Number(flyer.remainingQuantity || 0) + 1;
    }
    flyer.status = Number(flyer.remainingQuantity || 0) <= 0
      ? 'completed'
      : Number(flyer.deliveredQuantity || 0) > 0
        ? 'in_progress'
        : 'assigned';

    return acc;
  }, []);

  const routeGroups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const routeKey = row.RouteId ? `route:${row.RouteId}` : 'backlog';
    if (!routeGroups.has(routeKey)) {
      routeGroups.set(routeKey, {
        AssignmentBatchId: row.RouteId ? Number(row.RouteId) : 0,
        BatchName: row.RouteId ? (row.RouteName || `Route ${row.RouteId}`) : 'Assigned backlog',
        AssignmentDate: row.RouteDate || row.ScheduledDate || null,
        TotalStops: 0,
        TotalFlyers: 0,
        Status: row.RouteId ? 'routed' : 'assigned',
        MarketName: null,
        stops: [] as unknown[],
      });
    }

    const group = routeGroups.get(routeKey)!;
    group.TotalStops = Number(group.TotalStops || 0) + 1;
    group.TotalFlyers = Number(group.TotalFlyers || 0) + 1;
    (group.stops as unknown[]).push({
      BatchStopId: row.AssignmentId,
      AssignmentBatchId: group.AssignmentBatchId,
      CampaignTargetId: null,
      StopLabel: row.TargetName || 'Stop',
      AddressLine: addressLineForAssignment(row),
      SortOrder: row.RouteStopOrder || Number(group.TotalStops),
      FlyersForStop: 1,
    });
  }

  const assignedToday = rows.length;
  const deliveredToday = rows.filter((row) => normalizeStatus(row.AssignmentStatus) === 'completed').length;
  const remainingToday = Math.max(assignedToday - deliveredToday, 0);

  return {
    totals: { assignedToday, deliveredToday, remainingToday },
    flyersByCampaign,
    batches: Array.from(routeGroups.values()),
    source: 'workflow' as const,
  };
}

export type CapacityCheck = {
  distributorUserId: number;
  capacity: number;
  assignedToday: number;
  requestedQuantity: number;
  projectedTotal: number;
  exceedsCapacity: boolean;
  exceedsDefault25: boolean;
  warnings: string[];
};

export async function getTodayInventoryTotals(distributorUserId: number) {
  const workflowSummary = await getTodayWorkflowAssignmentSummary(distributorUserId);
  if (workflowSummary) return workflowSummary.totals;

  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .query(`
      SELECT
        ISNULL(SUM(AssignedQuantity), 0) AS AssignedToday,
        ISNULL(SUM(DeliveredQuantity), 0) AS DeliveredToday,
        ISNULL(SUM(RemainingQuantity), 0) AS RemainingToday
      FROM dbo.PharmacyFlyer_DistributorInventory
      WHERE DistributorUserId = @DistributorUserId
        AND AssignmentDate = ${FLORIDA_SQL_TODAY}
        AND Status <> 'cancelled'
    `);
  const row = result.recordset[0] || {};
  return {
    assignedToday: Number(row.AssignedToday ?? 0),
    deliveredToday: Number(row.DeliveredToday ?? 0),
    remainingToday: Number(row.RemainingToday ?? 0),
  };
}

export async function checkAssignmentCapacity(
  distributorUserId: number,
  requestedQuantity: number,
): Promise<CapacityCheck> {
  const profile = await getUserProfile(distributorUserId);
  const capacity = profile?.defaultDailyFlyerCapacity ?? DEFAULT_CAPACITY;
  const totals = await getTodayInventoryTotals(distributorUserId);
  const projectedTotal = totals.assignedToday + requestedQuantity;
  const exceedsCapacity = projectedTotal > capacity;
  const exceedsDefault25 = projectedTotal > DEFAULT_CAPACITY;

  const warnings: string[] = [];
  if (exceedsDefault25) {
    warnings.push(`Assignment exceeds default ${DEFAULT_CAPACITY} flyers (${projectedTotal} total today).`);
  }
  if (exceedsCapacity) {
    warnings.push(`Assignment exceeds distributor capacity of ${capacity} (${projectedTotal} total today).`);
  }

  return {
    distributorUserId,
    capacity,
    assignedToday: totals.assignedToday,
    requestedQuantity,
    projectedTotal,
    exceedsCapacity,
    exceedsDefault25,
    warnings,
  };
}

async function loadCampaignTargetStops(campaignTargetIds: number[]) {
  if (!campaignTargetIds.length) return [];

  const pool = await getPool();
  const request = pool.request();
  const params = campaignTargetIds.map((id, index) => {
    request.input(`TargetId${index}`, sql.Int, id);
    return `@TargetId${index}`;
  });

  const result = await request.query(`
    SELECT
      t.CampaignTargetId,
      t.TargetType,
      t.AssignedFlyerName,
      CASE
        WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(CONCAT(
          COALESCE(nrc.FirstName, d.Doctor_FirstName, ''), ' ',
          COALESCE(nrc.LastName, d.Doctor_LastName, '')
        )))
        ELSE p.PharmacyName
      END AS StopLabel,
      CASE
        WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.Address1)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressStreet)), ''))
        ELSE p.Address1
      END AS AddressLine
    FROM dbo.PharmacyFlyer_CampaignTarget t
    LEFT JOIN dbo.Master_Doctor d ON d.ID = t.DoctorId
    LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = t.NPI
    LEFT JOIN dbo.PharmacyFlyer_Pharmacy p ON p.PharmacyId = t.PharmacyId
    WHERE t.CampaignTargetId IN (${params.join(', ')})
      AND t.ApprovalStatus IN ('approved', 'assigned')
  `);

  return result.recordset as Array<{
    CampaignTargetId: number;
    TargetType: string;
    AssignedFlyerName: string | null;
    StopLabel: string | null;
    AddressLine: string | null;
  }>;
}

export async function assignDistributorInventory(input: {
  distributorUserId: number;
  campaignId: number;
  flyerName?: string | null;
  assignedQuantity: number;
  marketId?: number | null;
  campaignTargetIds?: number[];
  batchName?: string | null;
  createdBy?: number | null;
  force?: boolean;
}) {
  if (!Number.isFinite(input.assignedQuantity) || input.assignedQuantity <= 0) {
    throw new Error('assignedQuantity must be greater than zero');
  }

  const capacityCheck = await checkAssignmentCapacity(input.distributorUserId, input.assignedQuantity);
  if ((capacityCheck.exceedsCapacity || capacityCheck.exceedsDefault25) && !input.force) {
    const error = new Error('Assignment exceeds capacity. Pass force=true to proceed anyway.');
    (error as Error & { capacityCheck: CapacityCheck }).capacityCheck = capacityCheck;
    throw error;
  }

  const pool = await getPool();
  const campaign = await pool.request()
    .input('CampaignId', sql.Int, input.campaignId)
    .query(`SELECT TOP 1 CampaignId, CampaignName FROM dbo.PharmacyFlyer_Campaign WHERE CampaignId = @CampaignId`);
  if (!campaign.recordset[0]) throw new Error('Campaign not found');

  const stops = await loadCampaignTargetStops(input.campaignTargetIds || []);
  const stopCount = stops.length;
  let assignmentBatchId: number | null = null;

  if (stopCount > 0 || input.batchName) {
    const batchName = input.batchName
      || `${campaign.recordset[0].CampaignName} · ${toFloridaDateString()}`;
    const batchResult = await pool.request()
      .input('BatchName', sql.NVarChar, batchName)
      .input('DistributorUserId', sql.Int, input.distributorUserId)
      .input('MarketId', sql.Int, input.marketId ?? null)
      .input('TotalStops', sql.Int, stopCount)
      .input('TotalFlyers', sql.Int, input.assignedQuantity)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_DistributorAssignmentBatch (
          BatchName, DistributorUserId, MarketId, TotalStops, TotalFlyers, Status
        )
        OUTPUT INSERTED.*
        VALUES (@BatchName, @DistributorUserId, @MarketId, @TotalStops, @TotalFlyers, 'assigned')
      `);
    assignmentBatchId = batchResult.recordset[0].AssignmentBatchId;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      await pool.request()
        .input('AssignmentBatchId', sql.Int, assignmentBatchId)
        .input('CampaignTargetId', sql.Int, stop.CampaignTargetId)
        .input('StopLabel', sql.NVarChar, stop.StopLabel || `Stop ${i + 1}`)
        .input('AddressLine', sql.NVarChar, stop.AddressLine || null)
        .input('SortOrder', sql.Int, i + 1)
        .input('FlyersForStop', sql.Int, 1)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_DistributorBatchStop (
            AssignmentBatchId, CampaignTargetId, StopLabel, AddressLine, SortOrder, FlyersForStop
          )
          VALUES (@AssignmentBatchId, @CampaignTargetId, @StopLabel, @AddressLine, @SortOrder, @FlyersForStop)
        `);
    }
  }

  const flyerName = input.flyerName
    || stops[0]?.AssignedFlyerName
    || campaign.recordset[0].CampaignName;

  const inventoryResult = await pool.request()
    .input('DistributorUserId', sql.Int, input.distributorUserId)
    .input('CampaignId', sql.Int, input.campaignId)
    .input('AssignmentBatchId', sql.Int, assignmentBatchId)
    .input('FlyerName', sql.NVarChar, flyerName)
    .input('AssignedQuantity', sql.Int, input.assignedQuantity)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_DistributorInventory (
        DistributorUserId, CampaignId, AssignmentBatchId, FlyerName, AssignedQuantity, Status
      )
      OUTPUT INSERTED.*
      VALUES (@DistributorUserId, @CampaignId, @AssignmentBatchId, @FlyerName, @AssignedQuantity, 'assigned')
    `);

  return {
    inventory: inventoryResult.recordset[0],
    assignmentBatchId,
    stopCount,
    capacityCheck,
    warnings: capacityCheck.warnings,
  };
}

export async function listDistributorInventory(filters: {
  distributorUserId?: number | null;
  assignmentDate?: string | null;
  status?: string | null;
}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('DistributorUserId', sql.Int, Number.isFinite(filters.distributorUserId) ? filters.distributorUserId : null)
    .input('AssignmentDate', sql.Date, filters.assignmentDate || null)
    .input('Status', sql.VarChar, filters.status || null)
    .query(`
      SELECT
        i.*,
        c.CampaignName,
        b.BatchName,
        b.TotalStops,
        b.Status AS BatchStatus
      FROM dbo.PharmacyFlyer_DistributorInventory i
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = i.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_DistributorAssignmentBatch b ON b.AssignmentBatchId = i.AssignmentBatchId
      WHERE (@DistributorUserId IS NULL OR i.DistributorUserId = @DistributorUserId)
        AND (@AssignmentDate IS NULL OR i.AssignmentDate = @AssignmentDate)
        AND (@Status IS NULL OR i.Status = @Status)
      ORDER BY i.AssignmentDate DESC, i.DistributorInventoryId DESC
    `);

  return result.recordset;
}

export async function getMyFlyersSummary(distributorUserId: number) {
  const profile = await getUserProfile(distributorUserId);
  const capacity = profile?.defaultDailyFlyerCapacity ?? DEFAULT_CAPACITY;
  const workflowSummary = await getTodayWorkflowAssignmentSummary(distributorUserId);

  if (workflowSummary) {
    return {
      capacity,
      employmentType: profile?.employmentType ?? null,
      totalAssignedToday: workflowSummary.totals.assignedToday,
      totalDeliveredToday: workflowSummary.totals.deliveredToday,
      totalRemainingToday: workflowSummary.totals.remainingToday,
      flyersByCampaign: workflowSummary.flyersByCampaign,
      batches: workflowSummary.batches,
      source: workflowSummary.source,
    };
  }

  const totals = await getTodayInventoryTotals(distributorUserId);
  const pool = await getPool();

  const inventory = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .query(`
      SELECT
        i.DistributorInventoryId,
        i.CampaignId,
        i.AssignmentBatchId,
        i.FlyerName,
        i.AssignedQuantity,
        i.DeliveredQuantity,
        i.RemainingQuantity,
        i.AssignmentDate,
        i.Status,
        c.CampaignName
      FROM dbo.PharmacyFlyer_DistributorInventory i
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = i.CampaignId
      WHERE i.DistributorUserId = @DistributorUserId
        AND i.AssignmentDate = ${FLORIDA_SQL_TODAY}
        AND i.Status <> 'cancelled'
      ORDER BY c.CampaignName, i.FlyerName
    `);

  const batches = await pool.request()
    .input('DistributorUserId', sql.Int, distributorUserId)
    .query(`
      SELECT
        b.AssignmentBatchId,
        b.BatchName,
        b.AssignmentDate,
        b.TotalStops,
        b.TotalFlyers,
        b.Status,
        m.MarketName
      FROM dbo.PharmacyFlyer_DistributorAssignmentBatch b
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = b.MarketId
      WHERE b.DistributorUserId = @DistributorUserId
        AND b.AssignmentDate = ${FLORIDA_SQL_TODAY}
        AND b.Status <> 'cancelled'
      ORDER BY b.AssignmentBatchId DESC
    `);

  const batchIds = batches.recordset.map((b: { AssignmentBatchId: number }) => b.AssignmentBatchId);
  let stops: Array<Record<string, unknown>> = [];

  if (batchIds.length) {
    const request = pool.request();
    const params = batchIds.map((id: number, index: number) => {
      request.input(`BatchId${index}`, sql.Int, id);
      return `@BatchId${index}`;
    });
    const stopResult = await request.query(`
      SELECT
        s.BatchStopId,
        s.AssignmentBatchId,
        s.CampaignTargetId,
        s.StopLabel,
        s.AddressLine,
        s.SortOrder,
        s.FlyersForStop
      FROM dbo.PharmacyFlyer_DistributorBatchStop s
      WHERE s.AssignmentBatchId IN (${params.join(', ')})
      ORDER BY s.AssignmentBatchId, s.SortOrder
    `);
    stops = stopResult.recordset;
  }

  const flyersByCampaign = inventory.recordset.reduce((acc: Record<string, unknown>[], row: Record<string, unknown>) => {
    const key = String(row.CampaignId);
    let group = acc.find((g) => String((g as { campaignId: number }).campaignId) === key);
    if (!group) {
      group = {
        campaignId: row.CampaignId,
        campaignName: row.CampaignName,
        flyers: [] as unknown[],
      };
      acc.push(group);
    }
    (group as { flyers: unknown[] }).flyers.push({
      distributorInventoryId: row.DistributorInventoryId,
      flyerName: row.FlyerName,
      assignedQuantity: row.AssignedQuantity,
      deliveredQuantity: row.DeliveredQuantity,
      remainingQuantity: row.RemainingQuantity,
      status: row.Status,
      assignmentBatchId: row.AssignmentBatchId,
    });
    return acc;
  }, []);

  const batchesWithStops = batches.recordset.map((batch: Record<string, unknown>) => ({
    ...batch,
    stops: stops.filter((s) => s.AssignmentBatchId === batch.AssignmentBatchId),
  }));

  return {
    capacity,
    employmentType: profile?.employmentType ?? null,
    totalAssignedToday: totals.assignedToday,
    totalDeliveredToday: totals.deliveredToday,
    totalRemainingToday: totals.remainingToday,
    flyersByCampaign,
    batches: batchesWithStops,
  };
}

export async function updateDeliveredQuantity(
  inventoryId: number,
  deliveredQuantity: number,
  distributorUserId?: number | null,
) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('DistributorInventoryId', sql.Int, inventoryId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_DistributorInventory WHERE DistributorInventoryId = @DistributorInventoryId`);

  const row = existing.recordset[0];
  if (!row) return null;
  if (distributorUserId && row.DistributorUserId !== distributorUserId) return null;
  if (deliveredQuantity < 0 || deliveredQuantity > row.AssignedQuantity) {
    throw new Error('deliveredQuantity must be between 0 and assigned quantity');
  }

  const status = deliveredQuantity >= row.AssignedQuantity
    ? 'completed'
    : deliveredQuantity > 0
      ? 'in_progress'
      : row.Status;

  const result = await pool.request()
    .input('DistributorInventoryId', sql.Int, inventoryId)
    .input('DeliveredQuantity', sql.Int, deliveredQuantity)
    .input('Status', sql.VarChar, status)
    .query(`
      UPDATE dbo.PharmacyFlyer_DistributorInventory
      SET DeliveredQuantity = @DeliveredQuantity, Status = @Status, UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE DistributorInventoryId = @DistributorInventoryId
    `);

  return result.recordset[0];
}
