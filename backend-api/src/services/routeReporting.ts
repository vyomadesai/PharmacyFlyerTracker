import { getPool, sql } from '../config/db.js';

const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

const DOCTOR_INFO_CTE = `
  WITH DoctorInfoByNpi AS (
    SELECT
      LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) AS NPI,
      LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) AS PriSpec,
      ROW_NUMBER() OVER (
        PARTITION BY LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10))))
        ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) <> '' THEN 0 ELSE 1 END, pdi.adrs_id
      ) AS NpiRank
    FROM dbo.PharmacyFlyer_DoctorInfo pdi WITH (NOLOCK)
    WHERE LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) <> ''
  )
`;

const STOP_DETAIL_FROM = `
  FROM dbo.PharmacyFlyer_RouteStop s
  INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
  LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = s.CampaignId
  LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = r.MarketId
  LEFT JOIN dbo.Master_User u ON u.ID = r.DistributorUserId
  LEFT JOIN dbo.PharmacyFlyer_CampaignTarget t ON t.CampaignTargetId = s.CampaignTargetId
  LEFT JOIN dbo.Master_Doctor d ON d.ID = s.DoctorId
  LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = s.NPI
  LEFT JOIN DoctorInfoByNpi pdi ON pdi.NPI = s.NPI AND pdi.NpiRank = 1
  LEFT JOIN dbo.PharmacyFlyer_Pharmacy p ON p.PharmacyId = s.PharmacyId
  LEFT JOIN dbo.PharmacyFlyer_RouteStopCheckIn ci ON ci.RouteStopId = s.RouteStopId
  OUTER APPLY (
    SELECT TOP 1 RouteStopProofId, UploadedAt
    FROM dbo.PharmacyFlyer_RouteStopProof rp
    WHERE rp.RouteStopId = s.RouteStopId
    ORDER BY rp.UploadedAt DESC
  ) proof
`;

function buildStopFilters(filters: {
  campaignId?: number | null;
  distributorUserId?: number | null;
  routeDate?: string | null;
  marketId?: number | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  return {
    campaignClause: filters.campaignId ? 'AND s.CampaignId = @CampaignId' : '',
    distributorClause: filters.distributorUserId ? 'AND r.DistributorUserId = @DistributorUserId' : '',
    routeDateClause: filters.routeDate ? 'AND r.RouteDate = @RouteDate' : '',
    marketClause: filters.marketId ? 'AND r.MarketId = @MarketId' : '',
    statusClause: filters.status ? 'AND s.Status = @StopStatus' : '',
    dateFromClause: filters.dateFrom ? 'AND r.RouteDate >= @DateFrom' : '',
    dateToClause: filters.dateTo ? 'AND r.RouteDate <= @DateTo' : '',
  };
}

function bindStopFilters(
  request: Awaited<ReturnType<typeof getPool>> extends infer _T ? ReturnType<Awaited<ReturnType<typeof getPool>>['request']> : never,
  filters: {
    campaignId?: number | null;
    distributorUserId?: number | null;
    routeDate?: string | null;
    marketId?: number | null;
    status?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  },
) {
  return request
    .input('CampaignId', sql.Int, Number.isFinite(filters.campaignId) ? filters.campaignId : null)
    .input('DistributorUserId', sql.Int, Number.isFinite(filters.distributorUserId) ? filters.distributorUserId : null)
    .input('RouteDate', sql.Date, filters.routeDate || null)
    .input('MarketId', sql.Int, Number.isFinite(filters.marketId) ? filters.marketId : null)
    .input('StopStatus', sql.VarChar, filters.status || null)
    .input('DateFrom', sql.Date, filters.dateFrom || null)
    .input('DateTo', sql.Date, filters.dateTo || null);
}

export async function getLegacyDashboardStats() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      COUNT(*) AS TotalDeliveries,
      SUM(CASE WHEN CAST(SubmittedAt AS DATE) = ${FLORIDA_SQL_TODAY} THEN 1 ELSE 0 END) AS DeliveriesToday,
      SUM(CASE WHEN FlyerDelivered = 1 THEN 1 ELSE 0 END) AS FlyersDelivered,
      SUM(CASE WHEN ResponseStatus LIKE '%interested%' THEN 1 ELSE 0 END) AS InterestedCount,
      COUNT(DISTINCT StaffUserId) AS ActiveStaffCount
    FROM dbo.PharmacyFlyer_Delivery
  `);
  return result.recordset[0];
}

export async function getRouteDashboardStats() {
  const pool = await getPool();

  const targets = await pool.request().query(`
    SELECT
      SUM(CASE WHEN ApprovalStatus = 'suggested' THEN 1 ELSE 0 END) AS SuggestedTargets,
      SUM(CASE WHEN ApprovalStatus = 'approved' THEN 1 ELSE 0 END) AS ApprovedTargets,
      SUM(CASE WHEN ApprovalStatus = 'rejected' THEN 1 ELSE 0 END) AS RejectedTargets,
      SUM(CASE WHEN ApprovalStatus = 'assigned' THEN 1 ELSE 0 END) AS AssignedTargets,
      SUM(CASE WHEN ApprovalStatus = 'completed' THEN 1 ELSE 0 END) AS CompletedTargets
    FROM dbo.PharmacyFlyer_CampaignTarget
  `);

  const stops = await pool.request().query(`
    SELECT
      SUM(CASE WHEN s.Status = 'completed' THEN 1 ELSE 0 END) AS CompletedDrops,
      SUM(CASE WHEN s.Status IN ('pending', 'arrived') THEN 1 ELSE 0 END) AS PendingDrops,
      SUM(CASE WHEN s.Status IN ('skipped', 'failed') THEN 1 ELSE 0 END) AS SkippedFailedDrops,
      COUNT(*) AS TotalRouteStops
    FROM dbo.PharmacyFlyer_RouteStop s
    INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
    WHERE r.Status NOT IN ('cancelled', 'draft')
  `);

  const inventory = await pool.request().query(`
    SELECT
      ISNULL(SUM(AssignedQuantity), 0) AS AssignedFlyers,
      ISNULL(SUM(DeliveredQuantity), 0) AS DeliveredFlyers,
      ISNULL(SUM(RemainingQuantity), 0) AS RemainingFlyers
    FROM dbo.PharmacyFlyer_DistributorInventory
    WHERE AssignmentDate = ${FLORIDA_SQL_TODAY}
      AND Status <> 'cancelled'
  `);

  const routes = await pool.request().query(`
    SELECT
      COUNT(*) AS TotalRoutes,
      SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) AS RoutesCompleted,
      SUM(CASE WHEN Status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS RoutesActive
    FROM dbo.PharmacyFlyer_Route
    WHERE Status NOT IN ('cancelled', 'draft')
  `);

  const stopRow = stops.recordset[0] || {};
  const totalStops = Number(stopRow.TotalRouteStops ?? 0);
  const completedDrops = Number(stopRow.CompletedDrops ?? 0);

  return {
    targets: targets.recordset[0],
    stops: stopRow,
    inventory: inventory.recordset[0],
    routes: routes.recordset[0],
    completionPercentage: totalStops > 0 ? Math.round((completedDrops / totalStops) * 1000) / 10 : 0,
  };
}

export async function getFullDashboard() {
  const [deliveries, routeStats] = await Promise.all([
    getLegacyDashboardStats(),
    getRouteDashboardStats(),
  ]);

  return {
    ...deliveries,
    routeWorkflow: routeStats,
  };
}

export async function getCampaignPerformance(campaignId?: number | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, Number.isFinite(campaignId) ? campaignId : null)
    .query(`
      SELECT
        t.CampaignId,
        c.CampaignName,
        SUM(CASE WHEN t.ApprovalStatus = 'suggested' THEN 1 ELSE 0 END) AS SuggestedTargets,
        SUM(CASE WHEN t.ApprovalStatus = 'approved' THEN 1 ELSE 0 END) AS ApprovedTargets,
        SUM(CASE WHEN t.ApprovalStatus = 'rejected' THEN 1 ELSE 0 END) AS RejectedTargets,
        SUM(CASE WHEN t.ApprovalStatus = 'assigned' THEN 1 ELSE 0 END) AS AssignedTargets,
        SUM(CASE WHEN t.ApprovalStatus = 'completed' THEN 1 ELSE 0 END) AS CompletedTargets,
        SUM(CASE WHEN rs.Status = 'completed' THEN 1 ELSE 0 END) AS CompletedDrops,
        SUM(CASE WHEN rs.Status IN ('pending', 'arrived') THEN 1 ELSE 0 END) AS PendingDrops,
        SUM(CASE WHEN rs.Status IN ('skipped', 'failed') THEN 1 ELSE 0 END) AS SkippedFailedDrops
      FROM dbo.PharmacyFlyer_CampaignTarget t
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = t.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_RouteStop rs ON rs.CampaignTargetId = t.CampaignTargetId
      WHERE (@CampaignId IS NULL OR t.CampaignId = @CampaignId)
      GROUP BY t.CampaignId, c.CampaignName
      ORDER BY c.CampaignName
    `);

  return result.recordset.map((row: Record<string, unknown>) => {
    const completed = Number(row.CompletedDrops ?? 0);
    const pending = Number(row.PendingDrops ?? 0);
    const skipped = Number(row.SkippedFailedDrops ?? 0);
    const total = completed + pending + skipped;
    return {
      ...row,
      CompletionPercentage: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
    };
  });
}

export async function getDistributorPerformance(filters: { routeDate?: string | null; distributorUserId?: number | null } = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteDate', sql.Date, filters.routeDate || null)
    .input('DistributorUserId', sql.Int, Number.isFinite(filters.distributorUserId) ? filters.distributorUserId : null)
    .query(`
      SELECT
        u.ID AS DistributorUserId,
        LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
        ISNULL(inv.AssignedFlyers, 0) AS AssignedFlyers,
        ISNULL(inv.DeliveredFlyers, 0) AS DeliveredFlyers,
        ISNULL(inv.RemainingFlyers, 0) AS RemainingFlyers,
        ISNULL(rt.RoutesCompleted, 0) AS RoutesCompleted,
        ISNULL(rt.RoutesActive, 0) AS RoutesActive,
        ISNULL(st.StopsCompleted, 0) AS StopsCompleted,
        ISNULL(st.StopsPending, 0) AS StopsPending,
        ISNULL(st.StopsSkippedFailed, 0) AS StopsSkippedFailed
      FROM dbo.Master_User u
      INNER JOIN dbo.PharmacyFlyer_UserProfile prof ON prof.UserId = u.ID AND prof.Role = 'distributor'
      LEFT JOIN (
        SELECT
          DistributorUserId,
          SUM(AssignedQuantity) AS AssignedFlyers,
          SUM(DeliveredQuantity) AS DeliveredFlyers,
          SUM(RemainingQuantity) AS RemainingFlyers
        FROM dbo.PharmacyFlyer_DistributorInventory
        WHERE Status <> 'cancelled'
          AND (@RouteDate IS NULL OR AssignmentDate = @RouteDate)
        GROUP BY DistributorUserId
      ) inv ON inv.DistributorUserId = u.ID
      LEFT JOIN (
        SELECT
          DistributorUserId,
          SUM(CASE WHEN Status = 'completed' THEN 1 ELSE 0 END) AS RoutesCompleted,
          SUM(CASE WHEN Status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS RoutesActive
        FROM dbo.PharmacyFlyer_Route
        WHERE Status NOT IN ('cancelled', 'draft')
          AND (@RouteDate IS NULL OR RouteDate = @RouteDate)
        GROUP BY DistributorUserId
      ) rt ON rt.DistributorUserId = u.ID
      LEFT JOIN (
        SELECT
          r.DistributorUserId,
          SUM(CASE WHEN s.Status = 'completed' THEN 1 ELSE 0 END) AS StopsCompleted,
          SUM(CASE WHEN s.Status IN ('pending', 'arrived') THEN 1 ELSE 0 END) AS StopsPending,
          SUM(CASE WHEN s.Status IN ('skipped', 'failed') THEN 1 ELSE 0 END) AS StopsSkippedFailed
        FROM dbo.PharmacyFlyer_RouteStop s
        INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
        WHERE r.Status NOT IN ('cancelled', 'draft')
          AND (@RouteDate IS NULL OR r.RouteDate = @RouteDate)
        GROUP BY r.DistributorUserId
      ) st ON st.DistributorUserId = u.ID
      WHERE (@DistributorUserId IS NULL OR u.ID = @DistributorUserId)
      ORDER BY DistributorName
    `);

  return result.recordset;
}

export async function getRoutePerformance(filters: {
  routeDate?: string | null;
  distributorUserId?: number | null;
  marketId?: number | null;
  status?: string | null;
} = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RouteDate', sql.Date, filters.routeDate || null)
    .input('DistributorUserId', sql.Int, Number.isFinite(filters.distributorUserId) ? filters.distributorUserId : null)
    .input('MarketId', sql.Int, Number.isFinite(filters.marketId) ? filters.marketId : null)
    .input('RouteStatus', sql.VarChar, filters.status || null)
    .query(`
      SELECT
        r.RouteId,
        r.RouteName,
        r.RouteDate,
        r.Status AS RouteStatus,
        r.DistributorUserId,
        LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
        m.MarketName,
        COUNT(s.RouteStopId) AS TotalStops,
        SUM(CASE WHEN s.Status = 'completed' THEN 1 ELSE 0 END) AS CompletedStops,
        SUM(CASE WHEN s.Status IN ('pending', 'arrived') THEN 1 ELSE 0 END) AS PendingStops,
        SUM(CASE WHEN s.Status IN ('skipped', 'failed') THEN 1 ELSE 0 END) AS SkippedFailedStops
      FROM dbo.PharmacyFlyer_Route r
      LEFT JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteId = r.RouteId
      LEFT JOIN dbo.Master_User u ON u.ID = r.DistributorUserId
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = r.MarketId
      WHERE r.Status NOT IN ('draft')
        AND (@RouteDate IS NULL OR r.RouteDate = @RouteDate)
        AND (@DistributorUserId IS NULL OR r.DistributorUserId = @DistributorUserId)
        AND (@MarketId IS NULL OR r.MarketId = @MarketId)
        AND (@RouteStatus IS NULL OR r.Status = @RouteStatus)
      GROUP BY r.RouteId, r.RouteName, r.RouteDate, r.Status, r.DistributorUserId, u.User_FirstName, u.User_LastName, m.MarketName
      ORDER BY r.RouteDate DESC, r.RouteName
    `);

  return result.recordset;
}

const PROOF_SELECT = `
  s.RouteStopId,
  s.RouteId,
  r.RouteName,
  r.RouteDate,
  s.StopOrder,
  s.TargetType,
  s.StopLabel,
  s.NPI,
  s.StopAddress,
  s.AssignedFlyerName,
  s.Status AS StopStatus,
  s.Notes,
  s.SkippedReason,
  s.CompletedAt,
  c.CampaignId,
  c.CampaignName,
  LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
  m.MarketName,
  COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) AS Specialty,
  NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') AS TaxonomyCode,
  ci.CheckedInAt,
  ci.CheckInLatitude,
  ci.CheckInLongitude,
  ci.DistanceMiles AS CheckInDistanceMiles,
  ci.LocationVerified,
  ci.VerificationNote,
  proof.RouteStopProofId,
  proof.UploadedAt AS ProofUploadedAt,
  CASE WHEN proof.RouteStopProofId IS NULL THEN 0 ELSE 1 END AS HasProof
`;

export async function getProofReview(filters: {
  campaignId?: number | null;
  distributorUserId?: number | null;
  routeDate?: string | null;
  marketId?: number | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
} = {}) {
  const pool = await getPool();
  const clauses = buildStopFilters(filters);
  const request = bindStopFilters(pool.request(), filters);

  const result = await request.query(`
    ${DOCTOR_INFO_CTE}
    SELECT TOP 1000 ${PROOF_SELECT}
    ${STOP_DETAIL_FROM}
    WHERE r.Status NOT IN ('draft', 'cancelled')
      ${clauses.campaignClause}
      ${clauses.distributorClause}
      ${clauses.routeDateClause}
      ${clauses.marketClause}
      ${clauses.statusClause}
      ${clauses.dateFromClause}
      ${clauses.dateToClause}
    ORDER BY r.RouteDate DESC, s.StopOrder ASC
  `);

  return result.recordset;
}

export async function getRouteStopsForMap(filters: {
  campaignId?: number | null;
  distributorUserId?: number | null;
  routeDate?: string | null;
  marketId?: number | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
} = {}) {
  const pool = await getPool();
  const clauses = buildStopFilters(filters);
  const request = bindStopFilters(pool.request(), filters);

  const result = await request.query(`
    ${DOCTOR_INFO_CTE}
    SELECT TOP 1000
      s.RouteStopId,
      s.RouteId,
      s.StopOrder,
      s.StopLabel,
      s.StopAddress,
      s.StopLatitude AS Latitude,
      s.StopLongitude AS Longitude,
      s.TargetType,
      s.NPI,
      s.AssignedFlyerName,
      s.Status AS StopStatus,
      r.RouteName,
      r.RouteDate,
      r.DistributorUserId,
      c.CampaignId,
      c.CampaignName,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
      m.MarketName,
      CASE WHEN proof.RouteStopProofId IS NULL THEN 0 ELSE 1 END AS HasProof,
      ci.LocationVerified
    ${STOP_DETAIL_FROM}
    WHERE r.Status NOT IN ('draft', 'cancelled')
      AND s.StopLatitude IS NOT NULL
      AND s.StopLongitude IS NOT NULL
      ${clauses.campaignClause}
      ${clauses.distributorClause}
      ${clauses.routeDateClause}
      ${clauses.marketClause}
      ${clauses.statusClause}
      ${clauses.dateFromClause}
      ${clauses.dateToClause}
    ORDER BY r.RouteDate ASC, s.StopOrder ASC
  `);

  return result.recordset;
}

export async function getRouteStopProofPhoto(routeStopId: number) {
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

export async function exportLegacyDeliveries() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 5000
      d.DeliveryId,
      c.CampaignName,
      CONCAT(u.User_FirstName, ' ', u.User_LastName) AS StaffName,
      u.User_Email,
      d.DoctorName,
      d.ClinicName,
      d.DoctorAddressStreet,
      d.DoctorAddressCity,
      d.DoctorAddressState,
      d.DoctorAddressZip,
      d.PersonMet,
      d.FlyerDelivered,
      d.ResponseStatus,
      d.Latitude,
      d.Longitude,
      d.GpsAccuracyMeters,
      d.Notes,
      d.FollowUpRequired,
      d.FollowUpDate,
      d.SubmittedAt
    FROM dbo.PharmacyFlyer_Delivery d
    INNER JOIN dbo.PharmacyFlyer_Campaign c ON d.CampaignId = c.CampaignId
    INNER JOIN dbo.Master_User u ON d.StaffUserId = u.ID
    ORDER BY d.SubmittedAt DESC
  `);
  return result.recordset;
}

export async function exportRouteStops(filters: {
  campaignId?: number | null;
  distributorUserId?: number | null;
  routeDate?: string | null;
  marketId?: number | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
} = {}) {
  const pool = await getPool();
  const clauses = buildStopFilters(filters);
  const request = bindStopFilters(pool.request(), filters);

  const result = await request.query(`
    ${DOCTOR_INFO_CTE}
    SELECT TOP 5000
      s.RouteStopId,
      r.RouteId,
      r.RouteName,
      r.RouteDate,
      s.StopOrder,
      s.TargetType,
      s.StopLabel,
      s.NPI,
      s.StopAddress,
      s.StopLatitude,
      s.StopLongitude,
      s.AssignedFlyerName,
      s.Status AS StopStatus,
      s.CompletedAt,
      s.SkippedReason,
      s.Notes,
      c.CampaignName,
      LTRIM(RTRIM(CONCAT(u.User_FirstName, ' ', u.User_LastName))) AS DistributorName,
      m.MarketName,
      COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) AS Specialty,
      NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') AS TaxonomyCode,
      ci.CheckedInAt,
      ci.CheckInLatitude,
      ci.CheckInLongitude,
      ci.DistanceMiles AS CheckInDistanceMiles,
      ci.LocationVerified,
      ci.VerificationNote,
      CASE WHEN proof.RouteStopProofId IS NULL THEN 'no' ELSE 'yes' END AS HasProof,
      proof.UploadedAt AS ProofUploadedAt
    ${STOP_DETAIL_FROM}
    WHERE r.Status NOT IN ('draft')
      ${clauses.campaignClause}
      ${clauses.distributorClause}
      ${clauses.routeDateClause}
      ${clauses.marketClause}
      ${clauses.statusClause}
      ${clauses.dateFromClause}
      ${clauses.dateToClause}
    ORDER BY r.RouteDate DESC, s.StopOrder ASC
  `);

  return result.recordset;
}

export async function exportCampaignTargets(filters: { campaignId?: number | null } = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, Number.isFinite(filters.campaignId) ? filters.campaignId : null)
    .query(`
      ${DOCTOR_INFO_CTE}
      SELECT TOP 5000
        t.CampaignTargetId,
        t.CampaignId,
        c.CampaignName,
        t.TargetType,
        t.ApprovalStatus,
        t.AssignedFlyerName,
        t.NPI,
        t.VisitFrequencyType,
        t.NextDueDate,
        t.LastVisitedAt,
        CASE
          WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(CONCAT(
            COALESCE(nrc.FirstName, d.Doctor_FirstName, ''), ' ',
            COALESCE(nrc.LastName, d.Doctor_LastName, '')
          )))
          ELSE ph.PharmacyName
        END AS TargetName,
        COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) AS Specialty,
        NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') AS TaxonomyCode,
        CASE
          WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.Address1)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressStreet)), ''))
          ELSE ph.Address1
        END AS AddressLine,
        CASE
          WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.City)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressCity)), ''))
          ELSE ph.City
        END AS City,
        CASE
          WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.State)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressState)), ''))
          ELSE ph.State
        END AS State
      FROM dbo.PharmacyFlyer_CampaignTarget t
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = t.CampaignId
      LEFT JOIN dbo.Master_Doctor d ON d.ID = t.DoctorId
      LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = t.NPI
      LEFT JOIN DoctorInfoByNpi pdi ON pdi.NPI = t.NPI AND pdi.NpiRank = 1
      LEFT JOIN dbo.PharmacyFlyer_Pharmacy ph ON ph.PharmacyId = t.PharmacyId
      WHERE (@CampaignId IS NULL OR t.CampaignId = @CampaignId)
      ORDER BY c.CampaignName, t.ApprovalStatus, t.CampaignTargetId
    `);

  return result.recordset;
}

export async function exportDistributorPerformance(filters: { routeDate?: string | null } = {}) {
  return getDistributorPerformance(filters);
}

function parseReportFilters(query: Record<string, unknown>) {
  return {
    campaignId: query.campaignId ? Number(query.campaignId) : null,
    distributorUserId: query.distributorUserId ? Number(query.distributorUserId) : null,
    routeDate: query.routeDate ? String(query.routeDate) : null,
    marketId: query.marketId ? Number(query.marketId) : null,
    status: query.status ? String(query.status) : null,
    dateFrom: query.dateFrom ? String(query.dateFrom) : null,
    dateTo: query.dateTo ? String(query.dateTo) : null,
  };
}

export { parseReportFilters };
