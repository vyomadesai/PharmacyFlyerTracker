import { Router } from 'express';
import { getPool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

export const reportsRoutes = Router();
reportsRoutes.use(requireAuth);
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

reportsRoutes.get('/dashboard', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Delivery) AS TotalDeliveries,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Delivery WHERE CAST(SubmittedAt AS DATE) = ${FLORIDA_SQL_TODAY}) AS DeliveriesToday,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Delivery WHERE FlyerDelivered = 1) AS FlyersDelivered,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Delivery WHERE ResponseStatus LIKE '%interested%') AS InterestedCount,
      (SELECT COUNT(DISTINCT StaffUserId) FROM dbo.PharmacyFlyer_Delivery) AS ActiveStaffCount,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Assignment WHERE ApprovalStatus = 'suggested') AS PendingApprovalCount,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Assignment WHERE ApprovalStatus = 'approved' AND ISNULL(AssignmentStatus, '') NOT IN ('completed', 'skipped')) AS OpenAssignmentCount,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Route WHERE RouteDate = ${FLORIDA_SQL_TODAY}) AS RoutesToday,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Assignment WHERE NextVisitDueDate <= ${FLORIDA_SQL_TODAY} AND ISNULL(AssignmentStatus, '') <> 'completed') AS DueVisitCount
  `);
  res.json(result.recordset[0]);
});

reportsRoutes.get('/export', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 5000
      d.DeliveryId,
      d.AssignmentId,
      d.RouteId,
      c.CampaignName,
      c.FlyerTitle,
      c.FlyerIdentifier,
      c.FlyerCategory,
      a.TargetType,
      a.Specialty,
      a.NpiNumber,
      a.ApprovalStatus,
      a.AssignmentStatus,
      a.ScheduledDate,
      a.RouteStopOrder,
      a.LastVisitDate,
      a.NextVisitDueDate,
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
      d.CompletionStatus,
      d.Latitude,
      d.Longitude,
      d.GpsAccuracyMeters,
      d.Notes,
      d.FollowUpRequired,
      d.FollowUpDate,
      d.SubmittedAt,
      CASE WHEN p.PhotoId IS NULL THEN 0 ELSE 1 END AS HasPhoto
    FROM dbo.PharmacyFlyer_Delivery d
    INNER JOIN dbo.PharmacyFlyer_Campaign c ON d.CampaignId = c.CampaignId
    INNER JOIN dbo.Master_User u ON d.StaffUserId = u.ID
    LEFT JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = d.AssignmentId
    OUTER APPLY (
      SELECT TOP 1 PhotoId FROM dbo.PharmacyFlyer_DeliveryPhoto p WHERE p.DeliveryId = d.DeliveryId
    ) p
    ORDER BY d.SubmittedAt DESC
  `);
  res.json(result.recordset);
});
