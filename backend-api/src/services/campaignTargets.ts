import { getPool, sql } from '../config/db.js';
import { haversineSql } from '../utils/geography.js';
import {
  computeNextDueDate,
  initialDueDateOnApproval,
  visitDueSqlFilterClause,
  VISIT_DUE_PRIORITY_ORDER_SQL,
  VISIT_DUE_STATUS_SQL,
} from '../utils/visitFrequency.js';
import { applyConfigFilters, searchTargetedDoctors } from './doctorTargeting.js';

export const APPROVAL_STATUSES = [
  'suggested',
  'approved',
  'rejected',
  'assigned',
  'completed',
  'skipped',
] as const;

export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export type CampaignTargetRow = {
  CampaignTargetId: number;
  CampaignId: number;
  CampaignConfigId: number | null;
  TargetType: 'doctor' | 'pharmacy';
  DoctorId: number | null;
  NPI: string | null;
  PharmacyId: number | null;
  AssignedFlyerName: string | null;
  ApprovalStatus: ApprovalStatus;
  ApprovedByUserId: number | null;
  ApprovedAt: string | null;
  RejectedByUserId: number | null;
  RejectedAt: string | null;
  ApprovalNotes: string | null;
  VisitFrequencyType: string;
  VisitFrequencyDays: number | null;
  NextDueDate: string | null;
  LastVisitedAt: string | null;
  CheckInRequired: boolean;
  ProofUploadRequired: boolean;
  CreatedBy: number | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  CampaignName?: string;
  ConfigName?: string | null;
  ConfigFlyerName?: string | null;
  MarketId?: number | null;
  MarketName?: string | null;
  TargetName?: string | null;
  Specialty?: string | null;
  DoctorType?: string | null;
  TaxonomyCode?: string | null;
  TaxonomyDescription?: string | null;
  PrimaryAddress?: string | null;
  SecondaryAddress?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Phone?: string | null;
  Fax?: string | null;
  LicenseNumber?: string | null;
  PracticeName?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  DistanceMiles?: number | null;
  LocalRecordCount?: number | null;
  VisitDueStatus?: string | null;
};

export { computeNextDueDate, initialDueDateOnApproval } from '../utils/visitFrequency.js';

async function loadConfig(campaignConfigId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignConfigId', sql.Int, campaignConfigId)
    .query(`
      SELECT TOP 1 cfg.*, c.CampaignName
      FROM dbo.PharmacyFlyer_CampaignConfig cfg
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = cfg.CampaignId
      WHERE cfg.CampaignConfigId = @CampaignConfigId AND cfg.IsActive = 1
    `);
  return result.recordset[0] as Record<string, unknown> | undefined;
}

async function doctorTargetExists(campaignConfigId: number, doctorId: number, npi: string | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignConfigId', sql.Int, campaignConfigId)
    .input('DoctorId', sql.Int, doctorId)
    .input('NPI', sql.VarChar, npi || null)
    .query(`
      SELECT TOP 1 CampaignTargetId
      FROM dbo.PharmacyFlyer_CampaignTarget
      WHERE CampaignConfigId = @CampaignConfigId
        AND TargetType = 'doctor'
        AND (
          (@NPI IS NOT NULL AND @NPI <> '' AND NPI = @NPI)
          OR ((@NPI IS NULL OR @NPI = '') AND DoctorId = @DoctorId)
        )
    `);
  return Boolean(result.recordset[0]);
}

async function pharmacyTargetExists(campaignConfigId: number, pharmacyId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignConfigId', sql.Int, campaignConfigId)
    .input('PharmacyId', sql.Int, pharmacyId)
    .query(`
      SELECT TOP 1 CampaignTargetId
      FROM dbo.PharmacyFlyer_CampaignTarget
      WHERE CampaignConfigId = @CampaignConfigId
        AND TargetType = 'pharmacy'
        AND PharmacyId = @PharmacyId
    `);
  return Boolean(result.recordset[0]);
}

async function insertSuggestedTarget(input: {
  campaignId: number;
  campaignConfigId: number;
  targetType: 'doctor' | 'pharmacy';
  doctorId?: number | null;
  npi?: string | null;
  pharmacyId?: number | null;
  assignedFlyerName: string | null;
  visitFrequencyType: string;
  visitFrequencyDays: number | null;
  checkInRequired: boolean;
  proofUploadRequired: boolean;
  createdBy: number | null;
}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, input.campaignId)
    .input('CampaignConfigId', sql.Int, input.campaignConfigId)
    .input('TargetType', sql.VarChar, input.targetType)
    .input('DoctorId', sql.Int, input.doctorId ?? null)
    .input('NPI', sql.VarChar, input.npi ?? null)
    .input('PharmacyId', sql.Int, input.pharmacyId ?? null)
    .input('AssignedFlyerName', sql.NVarChar, input.assignedFlyerName)
    .input('VisitFrequencyType', sql.VarChar, input.visitFrequencyType)
    .input('VisitFrequencyDays', sql.Int, input.visitFrequencyDays)
    .input('CheckInRequired', sql.Bit, input.checkInRequired)
    .input('ProofUploadRequired', sql.Bit, input.proofUploadRequired)
    .input('CreatedBy', sql.Int, input.createdBy)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_CampaignTarget (
        CampaignId, CampaignConfigId, TargetType, DoctorId, NPI, PharmacyId,
        AssignedFlyerName, ApprovalStatus, VisitFrequencyType, VisitFrequencyDays,
        CheckInRequired, ProofUploadRequired, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        @CampaignId, @CampaignConfigId, @TargetType, @DoctorId, @NPI, @PharmacyId,
        @AssignedFlyerName, 'suggested', @VisitFrequencyType, @VisitFrequencyDays,
        @CheckInRequired, @ProofUploadRequired, @CreatedBy
      )
    `);
  return result.recordset[0];
}

async function searchPharmaciesForConfig(config: Record<string, unknown>) {
  const pool = await getPool();
  const marketId = config.MarketId != null ? Number(config.MarketId) : null;
  const latitude = config.CenterLatitude != null ? Number(config.CenterLatitude) : null;
  const longitude = config.CenterLongitude != null ? Number(config.CenterLongitude) : null;
  const radiusMiles = config.RadiusMiles != null ? Number(config.RadiusMiles) : null;

  const distanceExpr = latitude != null && longitude != null
    ? haversineSql('p', '@Latitude', '@Longitude')
    : null;

  const result = await pool.request()
    .input('MarketId', sql.Int, Number.isFinite(marketId) ? marketId : null)
    .input('Latitude', sql.Decimal(10, 7), latitude)
    .input('Longitude', sql.Decimal(10, 7), longitude)
    .input('RadiusMiles', sql.Decimal(8, 2), Number.isFinite(radiusMiles) ? radiusMiles : null)
    .query(`
      SELECT TOP 500
        p.PharmacyId,
        p.PharmacyName,
        p.MarketId
        ${distanceExpr ? `, CAST(${distanceExpr} AS DECIMAL(10, 2)) AS DistanceMiles` : ''}
      FROM dbo.PharmacyFlyer_Pharmacy p WITH (NOLOCK)
      WHERE p.IsActive = 1
        AND (@MarketId IS NULL OR p.MarketId = @MarketId)
        AND (
          @RadiusMiles IS NULL
          OR @Latitude IS NULL
          OR @Longitude IS NULL
          OR (
            p.Latitude IS NOT NULL
            AND p.Longitude IS NOT NULL
            AND ${distanceExpr} <= @RadiusMiles
          )
        )
      ORDER BY ${distanceExpr ? 'DistanceMiles ASC,' : ''} p.PharmacyName
    `);

  return result.recordset as Array<{ PharmacyId: number; PharmacyName: string; MarketId: number | null; DistanceMiles?: number | null }>;
}

export async function generateSuggestedTargets(campaignConfigId: number, createdBy: number | null, limit = 500) {
  const config = await loadConfig(campaignConfigId);
  if (!config) throw new Error('Campaign config not found');

  const campaignId = Number(config.CampaignId);
  const targetType = String(config.TargetType || 'doctor');
  const assignedFlyerName = config.FlyerName ? String(config.FlyerName) : null;
  const visitFrequencyType = String(config.VisitFrequencyType || 'one_time');
  const visitFrequencyDays = config.VisitFrequencyDays != null ? Number(config.VisitFrequencyDays) : null;
  const checkInRequired = Boolean(config.CheckInRequired ?? true);
  const proofUploadRequired = Boolean(config.ProofUploadRequired ?? true);

  const created: Array<Record<string, unknown>> = [];
  const skipped = { doctors: 0, pharmacies: 0 };

  if (targetType === 'doctor' || targetType === 'both') {
    const filters = await applyConfigFilters(config);
    filters.limit = limit;
    const doctors = await searchTargetedDoctors(filters);

    for (const doctor of doctors) {
      const exists = await doctorTargetExists(campaignConfigId, doctor.DoctorId, doctor.NPI);
      if (exists) {
        skipped.doctors += 1;
        continue;
      }

      const row = await insertSuggestedTarget({
        campaignId,
        campaignConfigId,
        targetType: 'doctor',
        doctorId: doctor.DoctorId,
        npi: doctor.NPI,
        assignedFlyerName,
        visitFrequencyType,
        visitFrequencyDays,
        checkInRequired,
        proofUploadRequired,
        createdBy,
      });
      created.push(row);
    }
  }

  if (targetType === 'pharmacy' || targetType === 'both') {
    const pharmacies = await searchPharmaciesForConfig(config);
    for (const pharmacy of pharmacies) {
      const exists = await pharmacyTargetExists(campaignConfigId, pharmacy.PharmacyId);
      if (exists) {
        skipped.pharmacies += 1;
        continue;
      }

      const row = await insertSuggestedTarget({
        campaignId,
        campaignConfigId,
        targetType: 'pharmacy',
        pharmacyId: pharmacy.PharmacyId,
        assignedFlyerName,
        visitFrequencyType,
        visitFrequencyDays,
        checkInRequired,
        proofUploadRequired,
        createdBy,
      });
      created.push(row);
    }
  }

  return { createdCount: created.length, skipped, targets: created };
}

export async function saveDoctorTargets(input: {
  campaignId: number;
  campaignConfigId: number;
  doctorIds: number[];
  createdBy: number | null;
}) {
  const config = await loadConfig(input.campaignConfigId);
  if (!config) throw new Error('Campaign config not found');

  const assignedFlyerName = config.FlyerName ? String(config.FlyerName) : null;
  const visitFrequencyType = String(config.VisitFrequencyType || 'one_time');
  const visitFrequencyDays = config.VisitFrequencyDays != null ? Number(config.VisitFrequencyDays) : null;
  const checkInRequired = Boolean(config.CheckInRequired ?? true);
  const proofUploadRequired = Boolean(config.ProofUploadRequired ?? true);

  const pool = await getPool();
  const saved: Array<Record<string, unknown>> = [];
  const skipped: number[] = [];

  for (const doctorId of input.doctorIds) {
    const doctorResult = await pool.request()
      .input('DoctorId', sql.Int, doctorId)
      .query(`
        SELECT TOP 1 ID, LTRIM(RTRIM(CAST(Doctor_NPINo AS VARCHAR(10)))) AS NPI
        FROM dbo.Master_Doctor
        WHERE ID = @DoctorId
      `);
    const doctor = doctorResult.recordset[0];
    if (!doctor) {
      skipped.push(doctorId);
      continue;
    }

    const exists = await doctorTargetExists(input.campaignConfigId, doctorId, doctor.NPI || null);
    if (exists) {
      skipped.push(doctorId);
      continue;
    }

    const row = await insertSuggestedTarget({
      campaignId: input.campaignId,
      campaignConfigId: input.campaignConfigId,
      targetType: 'doctor',
      doctorId,
      npi: doctor.NPI || null,
      assignedFlyerName,
      visitFrequencyType,
      visitFrequencyDays,
      checkInRequired,
      proofUploadRequired,
      createdBy: input.createdBy,
    });
    saved.push(row);
  }

  return { savedCount: saved.length, skippedDoctorIds: skipped, targets: saved };
}

const TARGET_LIST_SELECT = `
  t.CampaignTargetId,
  t.CampaignId,
  t.CampaignConfigId,
  t.TargetType,
  t.DoctorId,
  t.NPI,
  t.PharmacyId,
  t.AssignedFlyerName,
  t.ApprovalStatus,
  t.ApprovedByUserId,
  t.ApprovedAt,
  t.RejectedByUserId,
  t.RejectedAt,
  t.ApprovalNotes,
  t.VisitFrequencyType,
  t.VisitFrequencyDays,
  t.NextDueDate,
  t.LastVisitedAt,
  t.CheckInRequired,
  t.ProofUploadRequired,
  t.CreatedBy,
  t.CreatedAt,
  t.UpdatedAt,
  c.CampaignName,
  cfg.ConfigName,
  cfg.FlyerName AS ConfigFlyerName,
  cfg.MarketId,
  m.MarketName,
  CASE
    WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(CONCAT(
      COALESCE(nrc.FirstName, d.Doctor_FirstName, ''), ' ',
      COALESCE(nrc.LastName, d.Doctor_LastName, '')
    )))
    ELSE p.PharmacyName
  END AS TargetName,
  COALESCE(
    NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''),
    NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''),
    NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')
  ) AS Specialty,
  CASE
    WHEN t.TargetType = 'doctor' THEN
      CASE
        WHEN NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') LIKE '207Q%'
          OR NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') LIKE '207R00000X'
          OR COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) LIKE '%PRIMARY%'
          OR COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) LIKE '%FAMILY%'
          OR COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) LIKE '%INTERNAL MED%'
          OR COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) LIKE '%GENERAL PRACT%'
          THEN 'primary_care'
        WHEN COALESCE(NULLIF(LTRIM(RTRIM(pdi.PriSpec)), ''), NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) IS NOT NULL
          OR NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') IS NOT NULL
          THEN 'specialist'
        ELSE 'any'
      END
    ELSE NULL
  END AS DoctorType,
  NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '') AS TaxonomyCode,
  COALESCE(NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) AS TaxonomyDescription,
  CASE
    WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.Address1)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressStreet)), ''))
    ELSE p.Address1
  END AS PrimaryAddress,
  CASE
    WHEN t.TargetType = 'doctor' THEN NULLIF(LTRIM(RTRIM(nrc.Address2)), '')
    ELSE p.Address2
  END AS SecondaryAddress,
  CASE
    WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.City)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressCity)), ''))
    ELSE p.City
  END AS City,
  CASE
    WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.State)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressState)), ''))
    ELSE p.State
  END AS State,
  CASE
    WHEN t.TargetType = 'doctor' THEN LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), '')))
    ELSE p.Zip
  END AS Zip,
  CASE
    WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_MobileNo)), ''))
    ELSE p.Phone
  END AS Phone,
  CASE
    WHEN t.TargetType = 'doctor' THEN NULLIF(LTRIM(RTRIM(nrc.Fax)), '')
    ELSE p.Fax
  END AS Fax,
  CASE
    WHEN t.TargetType = 'doctor' THEN COALESCE(NULLIF(LTRIM(RTRIM(nrc.LicenseNumber)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_LIC)), ''))
    ELSE NULL
  END AS LicenseNumber,
  CASE
    WHEN t.TargetType = 'doctor' THEN (
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(mp.Practice_Name, '')))
      FROM dbo.Doctor_Location_Mapping dlm WITH (NOLOCK)
      INNER JOIN dbo.Master_Practice mp WITH (NOLOCK) ON mp.ID = dlm.Practice_Id
      WHERE dlm.Doctor_No = d.Doctor_NO AND ISNULL(dlm.Mapping_IsActive, 0) = 1
      ORDER BY dlm.Practice_Id DESC
    )
    ELSE NULL
  END AS PracticeName,
  CASE
    WHEN t.TargetType = 'doctor' THEN
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
          OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781', '33782')
          THEN CAST(27.8428 AS DECIMAL(10,7))
        ELSE NULL
      END
    ELSE p.Latitude
  END AS Latitude,
  CASE
    WHEN t.TargetType = 'doctor' THEN
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
          OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781', '33782')
          THEN CAST(-82.6995 AS DECIMAL(10,7))
        ELSE NULL
      END
    ELSE p.Longitude
  END AS Longitude,
  CAST(NULL AS DECIMAL(10, 2)) AS DistanceMiles
`;

export async function listCampaignTargets(filters: {
  campaignId?: number | null;
  campaignConfigId?: number | null;
  campaignTargetId?: number | null;
  approvalStatus?: string | null;
  targetType?: string | null;
  assignableOnly?: boolean;
  visitDueFilter?: string | null;
  prioritizeDue?: boolean;
}) {
  const pool = await getPool();
  const visitDueClause = visitDueSqlFilterClause(filters.visitDueFilter);
  const orderBy = filters.prioritizeDue
    ? `${VISIT_DUE_PRIORITY_ORDER_SQL}, t.CampaignTargetId DESC`
    : 't.CreatedAt DESC, t.CampaignTargetId DESC';

  const result = await pool.request()
    .input('CampaignId', sql.Int, Number.isFinite(filters.campaignId) ? filters.campaignId : null)
    .input('CampaignConfigId', sql.Int, Number.isFinite(filters.campaignConfigId) ? filters.campaignConfigId : null)
    .input('CampaignTargetId', sql.Int, Number.isFinite(filters.campaignTargetId) ? filters.campaignTargetId : null)
    .input('ApprovalStatus', sql.VarChar, filters.approvalStatus || null)
    .input('TargetType', sql.VarChar, filters.targetType || null)
    .input('AssignableOnly', sql.Bit, filters.assignableOnly ? 1 : 0)
    .query(`
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
      SELECT TOP 1000 ${TARGET_LIST_SELECT},
        ${VISIT_DUE_STATUS_SQL}
      FROM dbo.PharmacyFlyer_CampaignTarget t
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = t.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_CampaignConfig cfg ON cfg.CampaignConfigId = t.CampaignConfigId
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = cfg.MarketId
      LEFT JOIN dbo.Master_Doctor d ON d.ID = t.DoctorId
      LEFT JOIN dbo.npiRegisteryConfig nrc ON nrc.NPI = NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(10)))), '')
      LEFT JOIN DoctorInfoByNpi pdi ON pdi.NPI = NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(10)))), '') AND pdi.NpiRank = 1
      LEFT JOIN dbo.PharmacyFlyer_Pharmacy p ON p.PharmacyId = t.PharmacyId
      WHERE (@CampaignTargetId IS NULL OR t.CampaignTargetId = @CampaignTargetId)
        AND (@CampaignId IS NULL OR t.CampaignId = @CampaignId)
        AND (@CampaignConfigId IS NULL OR t.CampaignConfigId = @CampaignConfigId)
        AND (@ApprovalStatus IS NULL OR t.ApprovalStatus = @ApprovalStatus)
        AND (@TargetType IS NULL OR t.TargetType = @TargetType)
        AND (
          @AssignableOnly = 0
          OR t.ApprovalStatus IN ('approved', 'assigned')
        )
        ${visitDueClause}
      ORDER BY ${orderBy}
    `);

  return result.recordset as CampaignTargetRow[];
}

export async function approveCampaignTarget(targetId: number, userId: number | null, notes?: string | null) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('CampaignTargetId', sql.Int, targetId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_CampaignTarget WHERE CampaignTargetId = @CampaignTargetId`);

  const target = existing.recordset[0];
  if (!target) return null;
  if (target.ApprovalStatus === 'rejected') {
    throw new Error('Rejected targets must be regenerated before approval.');
  }

  const nextDueDate = initialDueDateOnApproval(String(target.VisitFrequencyType));

  const result = await pool.request()
    .input('CampaignTargetId', sql.Int, targetId)
    .input('ApprovedByUserId', sql.Int, userId)
    .input('NextDueDate', sql.Date, nextDueDate)
    .input('ApprovalNotes', sql.NVarChar, notes ?? target.ApprovalNotes ?? null)
    .query(`
      UPDATE dbo.PharmacyFlyer_CampaignTarget
      SET
        ApprovalStatus = 'approved',
        ApprovedByUserId = @ApprovedByUserId,
        ApprovedAt = SYSDATETIME(),
        RejectedByUserId = NULL,
        RejectedAt = NULL,
        ApprovalNotes = @ApprovalNotes,
        NextDueDate = @NextDueDate,
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.CampaignTargetId
      WHERE CampaignTargetId = @CampaignTargetId
        AND ApprovalStatus IN ('suggested', 'approved')
    `);

  if (!result.recordset[0]) return null;
  const rows = await listCampaignTargets({ campaignTargetId: targetId });
  return rows[0] || null;
}

export async function rejectCampaignTarget(targetId: number, userId: number | null, notes?: string | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignTargetId', sql.Int, targetId)
    .input('RejectedByUserId', sql.Int, userId)
    .input('ApprovalNotes', sql.NVarChar, notes ?? null)
    .query(`
      UPDATE dbo.PharmacyFlyer_CampaignTarget
      SET
        ApprovalStatus = 'rejected',
        RejectedByUserId = @RejectedByUserId,
        RejectedAt = SYSDATETIME(),
        ApprovalNotes = COALESCE(@ApprovalNotes, ApprovalNotes),
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.CampaignTargetId
      WHERE CampaignTargetId = @CampaignTargetId
        AND ApprovalStatus IN ('suggested', 'approved')
    `);

  if (!result.recordset[0]) return null;
  const rows = await listCampaignTargets({ campaignTargetId: targetId });
  return rows[0] || null;
}

export async function bulkApproveCampaignTargets(targetIds: number[], userId: number | null, notes?: string | null) {
  const updated: CampaignTargetRow[] = [];
  for (const targetId of targetIds) {
    try {
      const row = await approveCampaignTarget(targetId, userId, notes);
      if (row) updated.push(row);
    } catch {
      // skip rejected/regenerate cases
    }
  }
  return updated;
}

export async function bulkRejectCampaignTargets(targetIds: number[], userId: number | null, notes?: string | null) {
  const updated: CampaignTargetRow[] = [];
  for (const targetId of targetIds) {
    const row = await rejectCampaignTarget(targetId, userId, notes);
    if (row) updated.push(row);
  }
  return updated;
}

export async function updateCampaignTargetNotes(targetId: number, notes: string | null) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignTargetId', sql.Int, targetId)
    .input('ApprovalNotes', sql.NVarChar, notes)
    .query(`
      UPDATE dbo.PharmacyFlyer_CampaignTarget
      SET ApprovalNotes = @ApprovalNotes, UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.CampaignTargetId
      WHERE CampaignTargetId = @CampaignTargetId
    `);

  if (!result.recordset[0]) return null;
  const rows = await listCampaignTargets({ campaignTargetId: targetId });
  return rows[0] || null;
}

export function isAssignableTarget(status: string) {
  return status === 'approved' || status === 'assigned';
}

export async function listAssignableTargets(filters: {
  campaignId?: number | null;
  campaignConfigId?: number | null;
  targetType?: string | null;
  visitDueFilter?: string | null;
  prioritizeDue?: boolean;
}) {
  return listCampaignTargets({
    ...filters,
    assignableOnly: true,
    prioritizeDue: filters.prioritizeDue ?? true,
  });
}

export async function recordTargetVisit(campaignTargetId: number, visitedAt: Date = new Date()) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('CampaignTargetId', sql.Int, campaignTargetId)
    .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_CampaignTarget WHERE CampaignTargetId = @CampaignTargetId`);

  const target = existing.recordset[0];
  if (!target) return null;

  const visitFrequencyType = String(target.VisitFrequencyType || 'one_time');
  const visitFrequencyDays = target.VisitFrequencyDays != null ? Number(target.VisitFrequencyDays) : null;
  const nextDueDate = computeNextDueDate(visitFrequencyType, visitFrequencyDays, visitedAt);
  const approvalStatus = visitFrequencyType === 'one_time' ? 'completed' : target.ApprovalStatus;

  await pool.request()
    .input('CampaignTargetId', sql.Int, campaignTargetId)
    .input('LastVisitedAt', sql.DateTime2, visitedAt)
    .input('NextDueDate', sql.Date, nextDueDate)
    .input('ApprovalStatus', sql.VarChar, approvalStatus)
    .query(`
      UPDATE dbo.PharmacyFlyer_CampaignTarget
      SET
        LastVisitedAt = @LastVisitedAt,
        NextDueDate = @NextDueDate,
        ApprovalStatus = @ApprovalStatus,
        UpdatedAt = SYSDATETIME()
      WHERE CampaignTargetId = @CampaignTargetId
    `);

  const rows = await listCampaignTargets({ campaignTargetId });
  return rows[0] || null;
}

export async function resetTargetVisitSchedule(campaignTargetId: number) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('CampaignTargetId', sql.Int, campaignTargetId)
    .query(`SELECT TOP 1 VisitFrequencyType FROM dbo.PharmacyFlyer_CampaignTarget WHERE CampaignTargetId = @CampaignTargetId`);
  const target = existing.recordset[0];
  if (!target) return null;

  const nextDueDate = initialDueDateOnApproval(String(target.VisitFrequencyType));
  await pool.request()
    .input('CampaignTargetId', sql.Int, campaignTargetId)
    .input('NextDueDate', sql.Date, nextDueDate)
    .query(`
      UPDATE dbo.PharmacyFlyer_CampaignTarget
      SET LastVisitedAt = NULL, NextDueDate = @NextDueDate, UpdatedAt = SYSDATETIME()
      WHERE CampaignTargetId = @CampaignTargetId
    `);

  const rows = await listCampaignTargets({ campaignTargetId });
  return rows[0] || null;
}
