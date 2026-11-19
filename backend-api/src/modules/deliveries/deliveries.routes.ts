import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { upload } from '../../middleware/upload.middleware.js';
import { buildPaginatedResponse, parsePaginationQuery } from '../../utils/pagination.js';
import {
  assertCanCompleteLocationVisit,
  LocationVisitBlockedError,
} from '../route-planner/routePlannerLocationHold.js';

export const deliveriesRoutes = Router();
deliveriesRoutes.use(requireAuth);
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

deliveriesRoutes.post('/', upload.single('photo'), async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const body = req.body;
  const locationKey = body.locationKey ? String(body.locationKey).trim() : '';
  const doctorId = body.doctorId ? Number(body.doctorId) : null;

  const sameStopBatch = body.sameStopBatch === 'true' || body.sameStopBatch === true;
  if (locationKey) {
    try {
      await assertCanCompleteLocationVisit({
        locationKey,
        doctorIds: doctorId && Number.isFinite(doctorId) && doctorId > 0 ? [doctorId] : [],
        actingUserId: staffUserId,
        sameVisit: sameStopBatch,
      });
    } catch (err) {
      if (err instanceof LocationVisitBlockedError) {
        return res.status(409).json({ message: err.message, code: err.code });
      }
      throw err;
    }
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const deliveryResult = await new sql.Request(transaction)
      .input('CampaignId', sql.Int, Number(body.campaignId))
      .input('AssignmentId', sql.BigInt, body.assignmentId ? Number(body.assignmentId) : null)
      .input('RouteId', sql.BigInt, body.routeId ? Number(body.routeId) : null)
      .input('TargetId', sql.BigInt, body.targetId ? Number(body.targetId) : null)
      .input('ProofRequired', sql.Bit, body.proofRequired === undefined ? null : (body.proofRequired === 'true' || body.proofRequired === true))
      .input('DoctorId', sql.Int, body.doctorId ? Number(body.doctorId) : null)
      .input('StaffUserId', sql.Int, staffUserId)
      .input('DoctorName', sql.NVarChar, body.doctorName || null)
      .input('ClinicName', sql.NVarChar, body.clinicName || null)
      .input('DoctorAddressStreet', sql.NVarChar, body.doctorAddressStreet || null)
      .input('DoctorAddressCity', sql.NVarChar, body.doctorAddressCity || null)
      .input('DoctorAddressState', sql.NVarChar, body.doctorAddressState || null)
      .input('DoctorAddressZip', sql.NVarChar, body.doctorAddressZip || null)
      .input('PersonMet', sql.NVarChar, body.personMet || null)
      .input('FlyerDelivered', sql.Bit, body.flyerDelivered === 'true' || body.flyerDelivered === true)
      .input('ResponseStatus', sql.NVarChar, body.responseStatus || null)
      .input('Latitude', sql.Decimal(10, 7), Number(body.latitude))
      .input('Longitude', sql.Decimal(10, 7), Number(body.longitude))
      .input('GpsAccuracyMeters', sql.Decimal(10, 2), body.gpsAccuracyMeters ? Number(body.gpsAccuracyMeters) : null)
      .input('Notes', sql.NVarChar, body.notes || null)
      .input('FollowUpRequired', sql.Bit, body.followUpRequired === 'true' || body.followUpRequired === true)
      .input('FollowUpDate', sql.Date, body.followUpDate || null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Delivery (
          CampaignId, DoctorId, StaffUserId, DoctorName, ClinicName,
          DoctorAddressStreet, DoctorAddressCity, DoctorAddressState, DoctorAddressZip,
          PersonMet, FlyerDelivered, ResponseStatus,
          Latitude, Longitude, GpsAccuracyMeters,
          Notes, FollowUpRequired, FollowUpDate, AssignmentId, RouteId, TargetId, ProofRequired, CompletionStatus
        )
        OUTPUT INSERTED.DeliveryId
        VALUES (
          @CampaignId, @DoctorId, @StaffUserId, @DoctorName, @ClinicName,
          @DoctorAddressStreet, @DoctorAddressCity, @DoctorAddressState, @DoctorAddressZip,
          @PersonMet, @FlyerDelivered, @ResponseStatus,
          @Latitude, @Longitude, @GpsAccuracyMeters,
          @Notes, @FollowUpRequired, @FollowUpDate, @AssignmentId, @RouteId, @TargetId, @ProofRequired, 'completed'
        )
      `);

    const deliveryId = deliveryResult.recordset[0].DeliveryId;

    // A single flyer/campaign at one physical location can cover several doctor
    // assignments (one assignment per doctor × campaign). Dropping that one flyer
    // completes all of them, so accept an optional `assignmentIds` list and finish
    // each of them with this delivery's proof.
    const idsToComplete = new Set<number>();
    if (body.assignmentId) {
      const primary = Number(body.assignmentId);
      if (Number.isFinite(primary) && primary > 0) idsToComplete.add(primary);
    }
    if (body.assignmentIds !== undefined && body.assignmentIds !== null) {
      const list = Array.isArray(body.assignmentIds)
        ? body.assignmentIds
        : String(body.assignmentIds).split(',');
      for (const v of list) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) idsToComplete.add(n);
      }
    }
    for (const assignmentId of idsToComplete) {
      await new sql.Request(transaction)
        .input('AssignmentId', sql.BigInt, assignmentId)
        .input('StaffUserId', sql.Int, staffUserId)
        .query(`
          UPDATE dbo.PharmacyFlyer_Assignment
          SET AssignmentStatus = 'completed',
              CompletedAt = SYSDATETIME(),
              LastVisitDate = ${FLORIDA_SQL_TODAY},
              NextVisitDueDate = CASE
                WHEN VisitFrequencyDays IS NOT NULL THEN DATEADD(day, VisitFrequencyDays, ${FLORIDA_SQL_TODAY})
                ELSE NextVisitDueDate
              END,
              LastModifiedDate = SYSDATETIME()
          WHERE AssignmentId = @AssignmentId AND StaffUserId = @StaffUserId;

          UPDATE s
          SET StopStatus = 'completed'
          FROM dbo.PharmacyFlyer_RouteStop s
          INNER JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = s.AssignmentId
          WHERE a.AssignmentId = @AssignmentId AND a.StaffUserId = @StaffUserId;
        `);
    }

    if (req.file) {
      await new sql.Request(transaction)
        .input('DeliveryId', sql.BigInt, deliveryId)
        .input('FileName', sql.NVarChar, req.file.originalname)
        .input('ContentType', sql.NVarChar, req.file.mimetype)
        .input('FileSizeBytes', sql.BigInt, req.file.size)
        .input('PhotoData', sql.VarBinary(sql.MAX), req.file.buffer)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_DeliveryPhoto
          (DeliveryId, FileName, ContentType, FileSizeBytes, PhotoData)
          VALUES (@DeliveryId, @FileName, @ContentType, @FileSizeBytes, @PhotoData)
        `);
    }

    await transaction.commit();
    res.status(201).json({ deliveryId, message: 'Delivery submitted successfully' });
  } catch (error) {
    await transaction.rollback();
    console.error('Delivery submit error:', error);
    res.status(500).json({ message: 'Could not submit delivery' });
  }
});

deliveriesRoutes.get('/', async (req, res) => {
  const pool = await getPool();
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  const date = req.query.date ? String(req.query.date) : null;
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);

  const whereClause = `
    WHERE (@CampaignId IS NULL OR d.CampaignId = @CampaignId)
      AND (@Date IS NULL OR CAST(d.SubmittedAt AS DATE) = @Date)
  `;

  const selectColumns = `
      d.DeliveryId,
      d.CampaignId,
      c.CampaignName,
      d.DoctorId,
      d.AssignmentId,
      d.RouteId,
      d.TargetId,
      d.DoctorName,
      d.ClinicName,
      d.DoctorAddressCity,
      d.DoctorAddressState,
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
      u.User_FirstName,
      u.User_LastName,
      u.User_Email,
      CASE WHEN p.PhotoId IS NULL THEN 0 ELSE 1 END AS HasPhoto
  `;

  const fromClause = `
    FROM dbo.PharmacyFlyer_Delivery d
    INNER JOIN dbo.PharmacyFlyer_Campaign c ON d.CampaignId = c.CampaignId
    INNER JOIN dbo.Master_User u ON d.StaffUserId = u.ID
    OUTER APPLY (
      SELECT TOP 1 PhotoId FROM dbo.PharmacyFlyer_DeliveryPhoto p WHERE p.DeliveryId = d.DeliveryId
    ) p
  `;

  const request = pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('Date', sql.Date, date);

  if (pagination) {
    const countRequest = pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('Date', sql.Date, date);
    const dataRequest = pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('Date', sql.Date, date)
      .input('Offset', sql.Int, pagination.offset)
      .input('PageSize', sql.Int, pagination.pageSize);

    const [countResult, dataResult] = await Promise.all([
      countRequest.query(`
        SELECT COUNT(*) AS total
        ${fromClause}
        ${whereClause}
      `),
      dataRequest.query(`
        SELECT ${selectColumns}
        ${fromClause}
        ${whereClause}
        ORDER BY d.SubmittedAt DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
      `),
    ]);

    const total = Number(countResult.recordset[0]?.total || 0);
    res.json(buildPaginatedResponse(dataResult.recordset, total, pagination));
    return;
  }

  const result = await request.query(`
    SELECT TOP 500 ${selectColumns}
    ${fromClause}
    ${whereClause}
    ORDER BY d.SubmittedAt DESC
  `);

  res.json(result.recordset);
});

deliveriesRoutes.get('/my/today', async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('StaffUserId', sql.Int, req.user?.userId)
    .query(`
      SELECT d.DeliveryId, d.DoctorName, d.ClinicName, d.ResponseStatus, d.SubmittedAt, c.CampaignName
      FROM dbo.PharmacyFlyer_Delivery d
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON d.CampaignId = c.CampaignId
      WHERE d.StaffUserId = @StaffUserId
        AND CAST(d.SubmittedAt AS DATE) = ${FLORIDA_SQL_TODAY}
      ORDER BY d.SubmittedAt DESC
    `);
  res.json(result.recordset);
});

deliveriesRoutes.get('/map', async (req, res) => {
  const pool = await getPool();
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
  const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;
  const responseStatus = req.query.responseStatus ? String(req.query.responseStatus).trim() : null;

  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('DateFrom', sql.Date, dateFrom)
    .input('DateTo', sql.Date, dateTo)
    .input('ResponseStatus', sql.NVarChar, responseStatus ? `%${responseStatus}%` : null)
    .query(`
      SELECT TOP 1000
        d.DeliveryId,
        d.CampaignId,
        d.DoctorId,
        d.AssignmentId,
        d.RouteId,
        d.TargetId,
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
        d.SubmittedAt,
        c.CampaignName,
        a.AssignmentStatus,
        a.ApprovalStatus,
        CONCAT(u.User_FirstName, ' ', u.User_LastName) AS StaffName,
        CASE WHEN p.PhotoId IS NULL THEN 0 ELSE 1 END AS HasPhoto
      FROM dbo.PharmacyFlyer_Delivery d
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON d.CampaignId = c.CampaignId
      INNER JOIN dbo.Master_User u ON d.StaffUserId = u.ID
      LEFT JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = d.AssignmentId
      OUTER APPLY (
        SELECT TOP 1 PhotoId FROM dbo.PharmacyFlyer_DeliveryPhoto p WHERE p.DeliveryId = d.DeliveryId
      ) p
      WHERE (@CampaignId IS NULL OR d.CampaignId = @CampaignId)
        AND (@DateFrom IS NULL OR CAST(d.SubmittedAt AS DATE) >= @DateFrom)
        AND (@DateTo IS NULL OR CAST(d.SubmittedAt AS DATE) <= @DateTo)
        AND (@ResponseStatus IS NULL OR d.ResponseStatus LIKE @ResponseStatus)
      ORDER BY d.SubmittedAt ASC
    `);
  res.json(result.recordset);
});

deliveriesRoutes.get('/:id/photo', async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('DeliveryId', sql.BigInt, Number(req.params.id))
    .query(`
      SELECT TOP 1 FileName, ContentType, PhotoData
      FROM dbo.PharmacyFlyer_DeliveryPhoto
      WHERE DeliveryId = @DeliveryId
      ORDER BY PhotoId DESC
    `);

  const photo = result.recordset[0];
  if (!photo) return res.status(404).json({ message: 'Photo not found' });

  res.setHeader('Content-Type', photo.ContentType || 'image/jpeg');
  res.setHeader('Content-Disposition', `inline; filename="${photo.FileName || 'photo.jpg'}"`);
  res.send(photo.PhotoData);
});
