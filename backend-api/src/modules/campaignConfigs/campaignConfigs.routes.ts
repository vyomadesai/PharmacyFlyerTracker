import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager } from '../../middleware/role.middleware.js';
import { cleanString, parseCoordinate, parseOptionalBoolean } from '../../utils/geography.js';

export const campaignConfigsRoutes = Router();
campaignConfigsRoutes.use(requireAuth);

const TARGET_TYPES = new Set(['doctor', 'pharmacy', 'both']);
const DOCTOR_TYPES = new Set(['primary_care', 'specialist', 'any']);
const SPECIALTY_SOURCES = new Set(['backend', 'custom', 'any']);
const VISIT_FREQUENCY_TYPES = new Set(['one_time', 'weekly', 'biweekly', 'monthly', 'custom_days']);

const CONFIG_SELECT = `
  cfg.CampaignConfigId,
  cfg.CampaignId,
  cfg.ConfigName,
  cfg.TargetType,
  cfg.FlyerName,
  cfg.DoctorType,
  cfg.SpecialtySource,
  cfg.SpecialtyValue,
  cfg.CustomSpecialtyText,
  cfg.TaxonomyCode,
  cfg.RequirePrimaryTaxonomy,
  cfg.MarketId,
  cfg.CenterAddress,
  cfg.CenterLatitude,
  cfg.CenterLongitude,
  cfg.RadiusMiles,
  cfg.VisitFrequencyType,
  cfg.VisitFrequencyDays,
  cfg.CheckInRequired,
  cfg.ProofUploadRequired,
  cfg.ApprovalRequired,
  cfg.IsActive,
  cfg.CreatedAt,
  cfg.UpdatedAt,
  c.CampaignName,
  c.FlyerIdentifier,
  c.FlyerCategory,
  c.MatchTitle,
  c.MatchIdentifier,
  m.MarketName,
  m.MarketNumber
`;

type ValidatedConfig = {
  campaignId: number;
  configName: string;
  targetType: string;
  flyerName: string | null;
  doctorType: string;
  specialtySource: string;
  specialtyValue: string | null;
  customSpecialtyText: string | null;
  taxonomyCode: string | null;
  requirePrimaryTaxonomy: boolean | null;
  marketId: number | null;
  centerAddress: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  visitFrequencyType: string;
  visitFrequencyDays: number | null;
  checkInRequired: boolean;
  proofUploadRequired: boolean;
  approvalRequired: boolean;
  isActive: boolean;
};

function validateConfigPayload(body: Record<string, unknown>, isUpdate = false): { error: string } | ValidatedConfig {
  const campaignId = body.campaignId === undefined || body.campaignId === null || body.campaignId === ''
    ? null
    : Number(body.campaignId);

  if (!isUpdate && (!Number.isFinite(campaignId) || !campaignId)) {
    return { error: 'campaignId is required.' };
  }
  if (isUpdate && body.campaignId !== undefined && (!Number.isFinite(campaignId) || !campaignId)) {
    return { error: 'campaignId must be a valid number.' };
  }

  const configName = cleanString(body.configName);
  if (!isUpdate && !configName) return { error: 'configName is required.' };

  const targetType = cleanString(body.targetType)?.toLowerCase() || null;
  if (!isUpdate && !targetType) return { error: 'targetType is required.' };
  if (targetType && !TARGET_TYPES.has(targetType)) {
    return { error: 'targetType must be doctor, pharmacy, or both.' };
  }

  const doctorType = (cleanString(body.doctorType)?.toLowerCase() || 'any');
  if (!DOCTOR_TYPES.has(doctorType)) {
    return { error: 'doctorType must be primary_care, specialist, or any.' };
  }

  const specialtySource = (cleanString(body.specialtySource)?.toLowerCase() || 'any');
  if (!SPECIALTY_SOURCES.has(specialtySource)) {
    return { error: 'specialtySource must be backend, custom, or any.' };
  }

  const visitFrequencyType = (cleanString(body.visitFrequencyType)?.toLowerCase() || 'one_time');
  if (!VISIT_FREQUENCY_TYPES.has(visitFrequencyType)) {
    return { error: 'visitFrequencyType must be one_time, weekly, biweekly, monthly, or custom_days.' };
  }

  const visitFrequencyDays = body.visitFrequencyDays === undefined || body.visitFrequencyDays === null || body.visitFrequencyDays === ''
    ? null
    : Number(body.visitFrequencyDays);

  if (visitFrequencyType === 'custom_days') {
    if (!Number.isFinite(visitFrequencyDays) || !visitFrequencyDays || visitFrequencyDays <= 0) {
      return { error: 'visitFrequencyDays is required and must be positive when visitFrequencyType is custom_days.' };
    }
  } else if (body.visitFrequencyDays !== undefined && body.visitFrequencyDays !== null && body.visitFrequencyDays !== '') {
    if (!Number.isFinite(visitFrequencyDays) || (visitFrequencyDays ?? 0) <= 0) {
      return { error: 'visitFrequencyDays must be a positive number.' };
    }
  }

  const radiusMiles = body.radiusMiles === undefined || body.radiusMiles === null || body.radiusMiles === ''
    ? null
    : Number(body.radiusMiles);
  if (body.radiusMiles !== undefined && body.radiusMiles !== null && body.radiusMiles !== '') {
    if (!Number.isFinite(radiusMiles) || !radiusMiles || radiusMiles <= 0) {
      return { error: 'radiusMiles must be a positive number when provided.' };
    }
  }

  const centerLatitude = body.centerLatitude === undefined || body.centerLatitude === null || body.centerLatitude === ''
    ? null
    : parseCoordinate(body.centerLatitude);
  const centerLongitude = body.centerLongitude === undefined || body.centerLongitude === null || body.centerLongitude === ''
    ? null
    : parseCoordinate(body.centerLongitude);

  if (body.centerLatitude !== undefined && body.centerLatitude !== null && body.centerLatitude !== '' && centerLatitude === null) {
    return { error: 'centerLatitude must be a valid number.' };
  }
  if (body.centerLongitude !== undefined && body.centerLongitude !== null && body.centerLongitude !== '' && centerLongitude === null) {
    return { error: 'centerLongitude must be a valid number.' };
  }

  const marketId = body.marketId === undefined || body.marketId === null || body.marketId === ''
    ? null
    : Number(body.marketId);
  if (body.marketId !== undefined && body.marketId !== null && body.marketId !== '' && !Number.isFinite(marketId)) {
    return { error: 'marketId must be a valid number.' };
  }

  const requirePrimaryTaxonomy = parseOptionalBoolean(body.requirePrimaryTaxonomy);

  return {
    campaignId: campaignId as number,
    configName: configName as string,
    targetType: targetType as string,
    flyerName: cleanString(body.flyerName),
    doctorType,
    specialtySource,
    specialtyValue: cleanString(body.specialtyValue),
    customSpecialtyText: cleanString(body.customSpecialtyText),
    taxonomyCode: cleanString(body.taxonomyCode),
    requirePrimaryTaxonomy,
    marketId: Number.isFinite(marketId) ? marketId : null,
    centerAddress: cleanString(body.centerAddress),
    centerLatitude,
    centerLongitude,
    radiusMiles,
    visitFrequencyType,
    visitFrequencyDays: Number.isFinite(visitFrequencyDays) ? visitFrequencyDays : null,
    checkInRequired: parseOptionalBoolean(body.checkInRequired) ?? true,
    proofUploadRequired: parseOptionalBoolean(body.proofUploadRequired) ?? true,
    approvalRequired: parseOptionalBoolean(body.approvalRequired) ?? true,
    isActive: parseOptionalBoolean(body.isActive) ?? true,
  };
}

async function assertCampaignExists(campaignId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`SELECT TOP 1 CampaignId FROM dbo.PharmacyFlyer_Campaign WHERE CampaignId = @CampaignId`);
  return Boolean(result.recordset[0]);
}

async function assertMarketExists(marketId: number | null) {
  if (!marketId) return true;
  const pool = await getPool();
  const result = await pool.request()
    .input('MarketId', sql.Int, marketId)
    .query(`SELECT TOP 1 MarketId FROM dbo.PharmacyFlyer_Market WHERE MarketId = @MarketId`);
  return Boolean(result.recordset[0]);
}

function bindConfigInputs(request: ReturnType<Awaited<ReturnType<typeof getPool>>['request']>, data: ValidatedConfig) {
  return request
    .input('CampaignId', sql.Int, data.campaignId)
    .input('ConfigName', sql.NVarChar, data.configName)
    .input('TargetType', sql.VarChar, data.targetType)
    .input('FlyerName', sql.NVarChar, data.flyerName)
    .input('DoctorType', sql.VarChar, data.doctorType)
    .input('SpecialtySource', sql.VarChar, data.specialtySource)
    .input('SpecialtyValue', sql.NVarChar, data.specialtyValue)
    .input('CustomSpecialtyText', sql.NVarChar, data.customSpecialtyText)
    .input('TaxonomyCode', sql.VarChar, data.taxonomyCode)
    .input('RequirePrimaryTaxonomy', sql.Bit, data.requirePrimaryTaxonomy)
    .input('MarketId', sql.Int, data.marketId)
    .input('CenterAddress', sql.NVarChar, data.centerAddress)
    .input('CenterLatitude', sql.Decimal(10, 7), data.centerLatitude)
    .input('CenterLongitude', sql.Decimal(10, 7), data.centerLongitude)
    .input('RadiusMiles', sql.Decimal(8, 2), data.radiusMiles)
    .input('VisitFrequencyType', sql.VarChar, data.visitFrequencyType)
    .input('VisitFrequencyDays', sql.Int, data.visitFrequencyDays)
    .input('CheckInRequired', sql.Bit, data.checkInRequired)
    .input('ProofUploadRequired', sql.Bit, data.proofUploadRequired)
    .input('ApprovalRequired', sql.Bit, data.approvalRequired)
    .input('IsActive', sql.Bit, data.isActive);
}

campaignConfigsRoutes.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
    const activeOnly = parseOptionalBoolean(req.query.activeOnly) === true;

    const pool = await getPool();
    const result = await pool.request()
      .input('CampaignId', sql.Int, Number.isFinite(campaignId) ? campaignId : null)
      .query(`
        SELECT ${CONFIG_SELECT}
        FROM dbo.PharmacyFlyer_CampaignConfig cfg
        INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = cfg.CampaignId
        LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = cfg.MarketId
        WHERE (@CampaignId IS NULL OR cfg.CampaignId = @CampaignId)
          AND (${activeOnly ? 1 : 0} = 0 OR cfg.IsActive = 1)
        ORDER BY cfg.CampaignId, cfg.ConfigName
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error('Campaign configs list error:', error);
    res.status(500).json({ message: 'Could not load campaign configs' });
  }
});

campaignConfigsRoutes.get('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const configId = Number(req.params.id);
    if (!Number.isFinite(configId)) return res.status(400).json({ message: 'Invalid config id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('CampaignConfigId', sql.Int, configId)
      .query(`
        SELECT TOP 1 ${CONFIG_SELECT}
        FROM dbo.PharmacyFlyer_CampaignConfig cfg
        INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = cfg.CampaignId
        LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = cfg.MarketId
        WHERE cfg.CampaignConfigId = @CampaignConfigId
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Campaign config not found' });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Campaign config lookup error:', error);
    res.status(500).json({ message: 'Could not load campaign config' });
  }
});

campaignConfigsRoutes.post('/', requireAdmin, async (req, res) => {
  try {
    const validated = validateConfigPayload(req.body || {});
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    if (!(await assertCampaignExists(validated.campaignId))) {
      return res.status(400).json({ message: 'Campaign not found.' });
    }
    if (!(await assertMarketExists(validated.marketId))) {
      return res.status(400).json({ message: 'Market not found.' });
    }

    const pool = await getPool();
    const request = bindConfigInputs(pool.request(), validated);
    const result = await request.query(`
      INSERT INTO dbo.PharmacyFlyer_CampaignConfig (
        CampaignId, ConfigName, TargetType, FlyerName, DoctorType, SpecialtySource,
        SpecialtyValue, CustomSpecialtyText, TaxonomyCode, RequirePrimaryTaxonomy,
        MarketId, CenterAddress, CenterLatitude, CenterLongitude, RadiusMiles,
        VisitFrequencyType, VisitFrequencyDays, CheckInRequired, ProofUploadRequired,
        ApprovalRequired, IsActive
      )
      OUTPUT INSERTED.*
      VALUES (
        @CampaignId, @ConfigName, @TargetType, @FlyerName, @DoctorType, @SpecialtySource,
        @SpecialtyValue, @CustomSpecialtyText, @TaxonomyCode, @RequirePrimaryTaxonomy,
        @MarketId, @CenterAddress, @CenterLatitude, @CenterLongitude, @RadiusMiles,
        @VisitFrequencyType, @VisitFrequencyDays, @CheckInRequired, @ProofUploadRequired,
        @ApprovalRequired, @IsActive
      )
    `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error('Campaign config create error:', error);
    res.status(500).json({ message: 'Could not create campaign config' });
  }
});

campaignConfigsRoutes.put('/:id', requireAdmin, async (req, res) => {
  try {
    const configId = Number(req.params.id);
    if (!Number.isFinite(configId)) return res.status(400).json({ message: 'Invalid config id' });

    const pool = await getPool();
    const existing = await pool.request()
      .input('CampaignConfigId', sql.Int, configId)
      .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_CampaignConfig WHERE CampaignConfigId = @CampaignConfigId`);

    const current = existing.recordset[0];
    if (!current) return res.status(404).json({ message: 'Campaign config not found' });

    const merged = {
      campaignId: req.body?.campaignId ?? current.CampaignId,
      configName: req.body?.configName ?? current.ConfigName,
      targetType: req.body?.targetType ?? current.TargetType,
      flyerName: req.body?.flyerName ?? current.FlyerName,
      doctorType: req.body?.doctorType ?? current.DoctorType,
      specialtySource: req.body?.specialtySource ?? current.SpecialtySource,
      specialtyValue: req.body?.specialtyValue ?? current.SpecialtyValue,
      customSpecialtyText: req.body?.customSpecialtyText ?? current.CustomSpecialtyText,
      taxonomyCode: req.body?.taxonomyCode ?? current.TaxonomyCode,
      requirePrimaryTaxonomy: req.body?.requirePrimaryTaxonomy ?? current.RequirePrimaryTaxonomy,
      marketId: req.body?.marketId ?? current.MarketId,
      centerAddress: req.body?.centerAddress ?? current.CenterAddress,
      centerLatitude: req.body?.centerLatitude ?? current.CenterLatitude,
      centerLongitude: req.body?.centerLongitude ?? current.CenterLongitude,
      radiusMiles: req.body?.radiusMiles ?? current.RadiusMiles,
      visitFrequencyType: req.body?.visitFrequencyType ?? current.VisitFrequencyType,
      visitFrequencyDays: req.body?.visitFrequencyDays ?? current.VisitFrequencyDays,
      checkInRequired: req.body?.checkInRequired ?? current.CheckInRequired,
      proofUploadRequired: req.body?.proofUploadRequired ?? current.ProofUploadRequired,
      approvalRequired: req.body?.approvalRequired ?? current.ApprovalRequired,
      isActive: req.body?.isActive ?? current.IsActive,
    };

    const validated = validateConfigPayload(merged, true);
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    if (!(await assertCampaignExists(validated.campaignId))) {
      return res.status(400).json({ message: 'Campaign not found.' });
    }
    if (!(await assertMarketExists(validated.marketId))) {
      return res.status(400).json({ message: 'Market not found.' });
    }

    const request = bindConfigInputs(pool.request(), validated)
      .input('CampaignConfigId', sql.Int, configId);
    const result = await request.query(`
      UPDATE dbo.PharmacyFlyer_CampaignConfig
      SET
        CampaignId = @CampaignId,
        ConfigName = @ConfigName,
        TargetType = @TargetType,
        FlyerName = @FlyerName,
        DoctorType = @DoctorType,
        SpecialtySource = @SpecialtySource,
        SpecialtyValue = @SpecialtyValue,
        CustomSpecialtyText = @CustomSpecialtyText,
        TaxonomyCode = @TaxonomyCode,
        RequirePrimaryTaxonomy = @RequirePrimaryTaxonomy,
        MarketId = @MarketId,
        CenterAddress = @CenterAddress,
        CenterLatitude = @CenterLatitude,
        CenterLongitude = @CenterLongitude,
        RadiusMiles = @RadiusMiles,
        VisitFrequencyType = @VisitFrequencyType,
        VisitFrequencyDays = @VisitFrequencyDays,
        CheckInRequired = @CheckInRequired,
        ProofUploadRequired = @ProofUploadRequired,
        ApprovalRequired = @ApprovalRequired,
        IsActive = @IsActive,
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.*
      WHERE CampaignConfigId = @CampaignConfigId
    `);

    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Campaign config update error:', error);
    res.status(500).json({ message: 'Could not update campaign config' });
  }
});

campaignConfigsRoutes.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const configId = Number(req.params.id);
    if (!Number.isFinite(configId)) return res.status(400).json({ message: 'Invalid config id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('CampaignConfigId', sql.Int, configId)
      .query(`
        DELETE FROM dbo.PharmacyFlyer_CampaignConfig
        OUTPUT DELETED.CampaignConfigId
        WHERE CampaignConfigId = @CampaignConfigId
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Campaign config not found' });
    res.json({ campaignConfigId: result.recordset[0].CampaignConfigId, message: 'Campaign config deleted' });
  } catch (error) {
    console.error('Campaign config delete error:', error);
    res.status(500).json({ message: 'Could not delete campaign config' });
  }
});
