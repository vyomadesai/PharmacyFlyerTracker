import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { upload } from '../../middleware/upload.middleware.js';
import { env } from '../../config/env.js';

export const workflowRoutes = Router();
workflowRoutes.use(requireAuth);

// Configurable via CHECK_IN_RADIUS_MILES env var (see config/env.ts).
const STRICT_RADIUS_MILES = env.checkInRadiusMiles;

function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

async function hasDoctorInfoColumn(columnName: string) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ColumnName', sql.NVarChar, columnName)
    .query(`
      SELECT 1 AS HasColumn
      FROM sys.columns c
      INNER JOIN sys.objects o ON c.object_id = o.object_id
      INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
      WHERE s.name = 'dbo' AND o.name = 'PharmacyFlyer_DoctorInfo' AND c.name = @ColumnName
    `);
  return Boolean(result.recordset[0]);
}

async function doctorInfoPriSpecExpression() {
  if (await hasDoctorInfoColumn('pri-spec')) return "[pri-spec]";
  if (await hasDoctorInfoColumn('pri_spec')) return "pri_spec";
  if (await hasDoctorInfoColumn('PriSpec')) return "PriSpec";
  return null;
}

async function getDoctorPriSpec(doctorId: number | null, fallbackPriSpec?: unknown) {
  const provided = normalize(fallbackPriSpec);
  if (provided) return provided;
  if (!doctorId) return '';

  const pool = await getPool();
  const priSpecExpr = await doctorInfoPriSpecExpression();
  if (!priSpecExpr) return '';

  // PharmacyFlyer_DoctorInfo is user-created and may differ slightly by import.
  // Try common link columns first, while reading the available PriSpec-style column.
  const candidates = ['DoctorId', 'DoctorID', 'MasterDoctorId', 'Master_DoctorId', 'ID'];
  for (const column of candidates) {
    if (!(await hasDoctorInfoColumn(column))) continue;

    const result = await pool.request()
      .input('DoctorId', sql.Int, doctorId)
      .query(`
        SELECT TOP 1 LTRIM(RTRIM(ISNULL(${priSpecExpr}, ''))) AS PriSpec
        FROM dbo.PharmacyFlyer_DoctorInfo
        WHERE TRY_CONVERT(INT, [${column}]) = @DoctorId
          AND LTRIM(RTRIM(ISNULL(${priSpecExpr}, ''))) <> ''
      `);

    const priSpec = normalize(result.recordset[0]?.PriSpec);
    if (priSpec) return priSpec;
  }

  if (await hasDoctorInfoColumn('NPI')) {
    const result = await pool.request()
      .input('DoctorId', sql.Int, doctorId)
      .query(`
        SELECT TOP 1 LTRIM(RTRIM(ISNULL(info.${priSpecExpr}, ''))) AS PriSpec
        FROM dbo.Master_Doctor d
        INNER JOIN dbo.PharmacyFlyer_DoctorInfo info
          ON NULLIF(LTRIM(RTRIM(CAST(info.NPI AS VARCHAR(20)))), '') = NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '')
        WHERE d.ID = @DoctorId
          AND LTRIM(RTRIM(ISNULL(info.${priSpecExpr}, ''))) <> ''
      `);
    const priSpec = normalize(result.recordset[0]?.PriSpec);
    if (priSpec) return priSpec;
  }

  // Fallback only to avoid a hard crash in older data; mapping still requires PriSpec.
  const doctorTypeResult = await pool.request()
    .input('DoctorId', sql.Int, doctorId)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(Doctor_Type, ''))) AS Doctor_Type
      FROM dbo.Master_Doctor
      WHERE ID = @DoctorId
    `);

  return normalize(doctorTypeResult.recordset[0]?.Doctor_Type);
}

async function assignCampaignForPriSpec(priSpec: string, preferredCampaignIds: number[] = []) {
  const pool = await getPool();
  const preferredCampaignIdValues = preferredCampaignIds
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
  const preferredCampaignIdSet = preferredCampaignIdValues.length
    ? preferredCampaignIdValues.join(',')
    : null;
  const preferenceRankExpression = preferredCampaignIdSet
    ? `CASE WHEN c.CampaignId IN (${preferredCampaignIdSet}) THEN 1 ELSE 0 END`
    : '0';

  const result = await pool.request()
    .input('PriSpec', sql.NVarChar, priSpec)
    .query(`
      SELECT TOP 1
        c.CampaignId,
        c.CampaignName,
        c.Description,
        c.FlyerIdentifier,
        c.FlyerCategory,
        c.MatchTitle,
        c.MatchIdentifier,
        m.PriSpec,
        m.RelevanceScore,
        ${preferenceRankExpression} AS PreferenceRank,
        CASE WHEN c.IsDefaultFallback = 1 THEN 1 ELSE 0 END AS FallbackRank
      FROM dbo.PharmacyFlyer_CampaignSpecialtyMapping m
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = m.CampaignId
      WHERE m.IsActive = 1
        AND c.IsActive = 1
        AND UPPER(LTRIM(RTRIM(m.PriSpec))) = UPPER(LTRIM(RTRIM(@PriSpec)))
      ORDER BY
        PreferenceRank DESC,
        m.RelevanceScore DESC,
        FallbackRank DESC,
        c.CampaignName
    `);

  if (result.recordset[0]) return result.recordset[0];

  const fallback = await pool.request().query(`
    SELECT TOP 1
      CampaignId,
      CampaignName,
      Description,
      FlyerIdentifier,
      FlyerCategory,
      MatchTitle,
      MatchIdentifier,
      NULL AS PriSpec,
      0 AS RelevanceScore,
      0 AS PreferenceRank,
      1 AS FallbackRank
    FROM dbo.PharmacyFlyer_Campaign
    WHERE IsActive = 1 AND IsDefaultFallback = 1
    ORDER BY CampaignName
  `);

  return fallback.recordset[0];
}

workflowRoutes.get('/doctor-specialties', async (_req, res) => {
  const pool = await getPool();
  const priSpecExpr = await doctorInfoPriSpecExpression();
  if (!priSpecExpr) return res.json([]);
  const result = await pool.request().query(`
    SELECT DISTINCT TOP 500 LTRIM(RTRIM(${priSpecExpr})) AS priSpec
    FROM dbo.PharmacyFlyer_DoctorInfo
    WHERE LTRIM(RTRIM(ISNULL(${priSpecExpr}, ''))) <> ''
    ORDER BY LTRIM(RTRIM(${priSpecExpr}))
  `);
  res.json(result.recordset);
});

workflowRoutes.post('/assign-flyer', async (req, res) => {
  const doctorId = req.body?.doctorId ? Number(req.body.doctorId) : null;
  const priSpec = await getDoctorPriSpec(doctorId, req.body?.priSpec);
  if (!priSpec) return res.status(400).json({ message: 'Doctor specialty is required. Provide priSpec or link PharmacyFlyer_DoctorInfo to the doctor.' });

  const preferredCampaignIds = Array.isArray(req.body?.preferredCampaignIds)
    ? req.body.preferredCampaignIds.map(Number)
    : [];

  const campaign = await assignCampaignForPriSpec(priSpec, preferredCampaignIds);
  if (!campaign) return res.status(404).json({ message: 'No mapped flyer/campaign found for this specialty and no default fallback is configured.', priSpec });

  res.json({ priSpec, assignedCampaign: campaign });
});

workflowRoutes.post('/checkin', async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const userLatitude = Number(req.body?.userLatitude ?? req.body?.latitude);
  const userLongitude = Number(req.body?.userLongitude ?? req.body?.longitude);
  const locationLatitude = Number(req.body?.locationLatitude ?? req.body?.doctorLatitude);
  const locationLongitude = Number(req.body?.locationLongitude ?? req.body?.doctorLongitude);

  if (![userLatitude, userLongitude, locationLatitude, locationLongitude].every(Number.isFinite)) {
    return res.status(400).json({ message: 'userLatitude, userLongitude, locationLatitude, and locationLongitude are required.' });
  }

  const distanceMiles = milesBetween(userLatitude, userLongitude, locationLatitude, locationLongitude);
  if (distanceMiles > STRICT_RADIUS_MILES) {
    return res.status(403).json({ message: `Outside ${STRICT_RADIUS_MILES}-mile check-in radius.`, distanceMiles: Number(distanceMiles.toFixed(2)), radiusMiles: STRICT_RADIUS_MILES });
  }

  const doctorId = req.body?.doctorId ? Number(req.body.doctorId) : null;
  const priSpec = await getDoctorPriSpec(doctorId, req.body?.priSpec);
  if (!priSpec) return res.status(400).json({ message: 'Doctor specialty is required before check-in can assign a flyer.' });

  const campaign = await assignCampaignForPriSpec(priSpec, Array.isArray(req.body?.preferredCampaignIds) ? req.body.preferredCampaignIds.map(Number) : []);
  if (!campaign) return res.status(404).json({ message: 'No flyer/campaign mapping found for this specialty.', priSpec });

  const status = req.body?.autoConfirm === true ? 'confirmed' : 'pending';
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaign.CampaignId)
    .input('DoctorId', sql.Int, doctorId)
    .input('StaffUserId', sql.Int, staffUserId)
    .input('DoctorName', sql.NVarChar, req.body?.doctorName || null)
    .input('ClinicName', sql.NVarChar, req.body?.clinicName || null)
    .input('Latitude', sql.Decimal(10, 7), userLatitude)
    .input('Longitude', sql.Decimal(10, 7), userLongitude)
    .input('GpsAccuracyMeters', sql.Decimal(10, 2), req.body?.gpsAccuracyMeters ? Number(req.body.gpsAccuracyMeters) : null)
    .input('CheckInStatus', sql.NVarChar, status)
    .input('AssignedCampaignId', sql.Int, campaign.CampaignId)
    .input('AssignmentPriSpec', sql.NVarChar, priSpec)
    .input('DistanceMiles', sql.Decimal(8, 2), Number(distanceMiles.toFixed(2)))
    .query(`
      INSERT INTO dbo.PharmacyFlyer_Delivery (
        CampaignId, DoctorId, StaffUserId, DoctorName, ClinicName,
        FlyerDelivered, Latitude, Longitude, GpsAccuracyMeters,
        CheckInStatus, CheckInConfirmedAt, AssignedCampaignId, AssignedAt,
        AssignmentPriSpec, DistanceMiles, MatchStatus
      )
      OUTPUT INSERTED.DeliveryId
      VALUES (
        @CampaignId, @DoctorId, @StaffUserId, @DoctorName, @ClinicName,
        0, @Latitude, @Longitude, @GpsAccuracyMeters,
        @CheckInStatus, CASE WHEN @CheckInStatus = 'confirmed' THEN SYSDATETIME() ELSE NULL END,
        @AssignedCampaignId, SYSDATETIME(), @AssignmentPriSpec, @DistanceMiles, 'not_uploaded'
      )
    `);

  res.status(201).json({
    deliveryId: result.recordset[0].DeliveryId,
    checkInStatus: status,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    priSpec,
    assignedCampaign: campaign
  });
});

workflowRoutes.post('/checkin/:deliveryId/confirm', async (req, res) => {
  const pool = await getPool();
  await pool.request()
    .input('DeliveryId', sql.BigInt, Number(req.params.deliveryId))
    .input('StaffUserId', sql.Int, req.user?.userId)
    .query(`
      UPDATE dbo.PharmacyFlyer_Delivery
      SET CheckInStatus = 'confirmed', CheckInConfirmedAt = SYSDATETIME()
      WHERE DeliveryId = @DeliveryId AND StaffUserId = @StaffUserId
    `);
  res.json({ deliveryId: Number(req.params.deliveryId), checkInStatus: 'confirmed' });
});

workflowRoutes.post('/upload-photo', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'photo is required.' });
  const deliveryId = Number(req.body?.deliveryId);
  if (!Number.isFinite(deliveryId)) return res.status(400).json({ message: 'deliveryId is required.' });

  const pool = await getPool();
  const owner = await pool.request()
    .input('DeliveryId', sql.BigInt, deliveryId)
    .input('StaffUserId', sql.Int, req.user?.userId)
    .query(`SELECT DeliveryId FROM dbo.PharmacyFlyer_Delivery WHERE DeliveryId = @DeliveryId AND StaffUserId = @StaffUserId`);
  if (!owner.recordset[0]) return res.status(404).json({ message: 'Delivery/check-in not found.' });

  const result = await pool.request()
    .input('DeliveryId', sql.BigInt, deliveryId)
    .input('FileName', sql.NVarChar, req.file.originalname)
    .input('ContentType', sql.NVarChar, req.file.mimetype)
    .input('FileSizeBytes', sql.BigInt, req.file.size)
    .input('PhotoData', sql.VarBinary(sql.MAX), req.file.buffer)
    .input('ExtractedTitle', sql.NVarChar, req.body?.extractedTitle || null)
    .input('ExtractedCategory', sql.NVarChar, req.body?.extractedCategory || null)
    .input('ExtractedIdentifier', sql.NVarChar, req.body?.extractedIdentifier || null)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_DeliveryPhoto
      (DeliveryId, FileName, ContentType, FileSizeBytes, PhotoData, ExtractedTitle, ExtractedCategory, ExtractedIdentifier, MatchStatus)
      OUTPUT INSERTED.PhotoId
      VALUES (@DeliveryId, @FileName, @ContentType, @FileSizeBytes, @PhotoData, @ExtractedTitle, @ExtractedCategory, @ExtractedIdentifier, 'pending')
    `);

  await pool.request()
    .input('DeliveryId', sql.BigInt, deliveryId)
    .query(`UPDATE dbo.PharmacyFlyer_Delivery SET MatchStatus = 'pending' WHERE DeliveryId = @DeliveryId`);

  res.status(201).json({ photoId: result.recordset[0].PhotoId, deliveryId, matchStatus: 'pending' });
});

workflowRoutes.post('/validate-flyer-match', async (req, res) => {
  const deliveryId = Number(req.body?.deliveryId);
  if (!Number.isFinite(deliveryId)) return res.status(400).json({ message: 'deliveryId is required.' });

  const pool = await getPool();
  const result = await pool.request()
    .input('DeliveryId', sql.BigInt, deliveryId)
    .input('StaffUserId', sql.Int, req.user?.userId)
    .query(`
      SELECT TOP 1
        d.DeliveryId,
        d.AssignedCampaignId,
        c.CampaignName,
        c.FlyerCategory,
        c.FlyerIdentifier,
        c.MatchTitle,
        c.MatchIdentifier,
        p.PhotoId,
        p.ExtractedTitle,
        p.ExtractedCategory,
        p.ExtractedIdentifier
      FROM dbo.PharmacyFlyer_Delivery d
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = ISNULL(d.AssignedCampaignId, d.CampaignId)
      INNER JOIN dbo.PharmacyFlyer_DeliveryPhoto p ON p.DeliveryId = d.DeliveryId
      WHERE d.DeliveryId = @DeliveryId AND d.StaffUserId = @StaffUserId
      ORDER BY p.PhotoId DESC
    `);

  const row = result.recordset[0];
  if (!row) return res.status(404).json({ message: 'No uploaded photo found for this delivery/check-in.' });

  const expectedTitle = normalize(row.MatchTitle || row.CampaignName);
  const expectedIdentifier = normalize(row.MatchIdentifier || row.FlyerIdentifier);
  const expectedCategory = normalize(row.FlyerCategory);
  const actualTitle = normalize(req.body?.extractedTitle || row.ExtractedTitle);
  const actualIdentifier = normalize(req.body?.extractedIdentifier || row.ExtractedIdentifier);
  const actualCategory = normalize(req.body?.extractedCategory || row.ExtractedCategory);

  const titleMatches = expectedTitle && actualTitle && expectedTitle === actualTitle;
  const identifierMatches = expectedIdentifier && actualIdentifier && expectedIdentifier === actualIdentifier;
  const categoryMatches = expectedCategory && actualCategory && expectedCategory === actualCategory;

  // Exact match means the strongest available configured identifier matches.
  const matched = Boolean(identifierMatches || (!expectedIdentifier && titleMatches) || (!expectedIdentifier && !expectedTitle && categoryMatches));
  const matchStatus = matched ? 'matched' : 'rejected';
  const notes = matched ? 'Exact assigned flyer match.' : 'Uploaded flyer did not exactly match the assigned campaign/flyer.';

  await pool.request()
    .input('DeliveryId', sql.BigInt, deliveryId)
    .input('PhotoId', sql.BigInt, row.PhotoId)
    .input('MatchStatus', sql.NVarChar, matchStatus)
    .input('MatchNotes', sql.NVarChar, notes)
    .query(`
      UPDATE dbo.PharmacyFlyer_Delivery
      SET MatchStatus = @MatchStatus, MatchCheckedAt = SYSDATETIME(), FlyerDelivered = CASE WHEN @MatchStatus = 'matched' THEN 1 ELSE FlyerDelivered END
      WHERE DeliveryId = @DeliveryId;

      UPDATE dbo.PharmacyFlyer_DeliveryPhoto
      SET MatchStatus = @MatchStatus, MatchCheckedAt = SYSDATETIME(), MatchNotes = @MatchNotes
      WHERE PhotoId = @PhotoId;
    `);

  res.json({
    deliveryId,
    photoId: row.PhotoId,
    matchStatus,
    canProceed: matched,
    expected: { title: expectedTitle, identifier: expectedIdentifier, category: expectedCategory },
    actual: { title: actualTitle, identifier: actualIdentifier, category: actualCategory },
    message: matched ? 'Match passed. Proceed to next workflow step.' : 'Match failed. User must retry with the correct assigned flyer.'
  });
});
