import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager } from '../../middleware/role.middleware.js';
import { cleanString, parseCoordinate, parseOptionalBoolean } from '../../utils/geography.js';
import { listCampaignTargets, saveDoctorTargets } from '../../services/campaignTargets.js';
import { applyConfigFilters, searchTargetedDoctors, type DoctorTargetingFilters } from '../../services/doctorTargeting.js';

export const targetingRoutes = Router();
targetingRoutes.use(requireAuth);

function parseFilters(query: Record<string, unknown>) {
  const doctorType = cleanString(query.doctorType)?.toLowerCase() || 'any';
  return {
    npi: cleanString(query.npi ?? query.NPI),
    name: cleanString(query.name ?? query.q),
    specialty: cleanString(query.specialty ?? query.specialtyValue),
    customSpecialty: cleanString(query.customSpecialty ?? query.customSpecialtyText),
    doctorType,
    taxonomyCode: cleanString(query.taxonomyCode),
    requirePrimaryTaxonomy: parseOptionalBoolean(query.requirePrimaryTaxonomy ?? query.primaryTaxonomy),
    city: cleanString(query.city),
    state: cleanString(query.state),
    zip: cleanString(query.zip),
    marketId: query.marketId ? Number(query.marketId) : null,
    centerLatitude: parseCoordinate(query.centerLatitude ?? query.latitude ?? query.lat),
    centerLongitude: parseCoordinate(query.centerLongitude ?? query.longitude ?? query.lng),
    radiusMiles: query.radiusMiles ? Number(query.radiusMiles) : null,
    hasPhone: parseOptionalBoolean(query.hasPhone),
    hasFax: parseOptionalBoolean(query.hasFax),
    limit: query.limit ? Number(query.limit) : 500,
  };
}

targetingRoutes.get('/doctors', requireAdminOrManager, async (req, res) => {
  try {
    let filters = parseFilters(req.query as Record<string, unknown>) as DoctorTargetingFilters;

    const configId = req.query.campaignConfigId ? Number(req.query.campaignConfigId) : null;
    if (Number.isFinite(configId) && configId) {
      const pool = await getPool();
      const configResult = await pool.request()
        .input('CampaignConfigId', sql.Int, configId)
        .query(`
          SELECT TOP 1 *
          FROM dbo.PharmacyFlyer_CampaignConfig
          WHERE CampaignConfigId = @CampaignConfigId AND IsActive = 1
        `);
      const config = configResult.recordset[0];
      if (!config) return res.status(404).json({ message: 'Campaign config not found' });

      const configFilters = await applyConfigFilters(config);
      filters = {
        ...configFilters,
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== 'any')),
      } as DoctorTargetingFilters;
    }

    const doctors = await searchTargetedDoctors(filters);

    res.json({
      count: doctors.length,
      filters,
      doctors,
      warnings: doctors.some((d) => d.Latitude == null)
        ? ['Some doctors are missing coordinates; radius filtering may exclude them until geocoded.']
        : [],
    });
  } catch (error) {
    console.error('Doctor targeting search error:', error);
    res.status(500).json({ message: 'Doctor targeting search failed' });
  }
});

targetingRoutes.get('/doctors/targets', requireAdminOrManager, async (req, res) => {
  try {
    const targets = await listCampaignTargets({
      campaignId: req.query.campaignId ? Number(req.query.campaignId) : null,
      campaignConfigId: req.query.campaignConfigId ? Number(req.query.campaignConfigId) : null,
      targetType: 'doctor',
    });
    res.json(targets);
  } catch (error) {
    console.error('Campaign targets list error:', error);
    res.status(500).json({ message: 'Could not load campaign targets' });
  }
});

targetingRoutes.post('/doctors/targets', requireAdmin, async (req, res) => {
  try {
    const campaignId = Number(req.body?.campaignId);
    const campaignConfigId = Number(req.body.campaignConfigId);
    const doctorIds = Array.isArray(req.body?.doctorIds) ? req.body.doctorIds.map(Number).filter(Number.isFinite) : [];

    if (!Number.isFinite(campaignId)) return res.status(400).json({ message: 'campaignId is required' });
    if (!Number.isFinite(campaignConfigId)) return res.status(400).json({ message: 'campaignConfigId is required' });
    if (!doctorIds.length) return res.status(400).json({ message: 'doctorIds array is required' });

    const result = await saveDoctorTargets({
      campaignId,
      campaignConfigId,
      doctorIds,
      createdBy: req.user?.userId || null,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Save campaign targets error:', error);
    const message = error instanceof Error ? error.message : 'Could not save campaign targets';
    res.status(message === 'Campaign config not found' ? 404 : 500).json({ message });
  }
});

targetingRoutes.delete('/doctors/targets/:id', requireAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'Invalid target id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('CampaignTargetId', sql.Int, targetId)
      .query(`
        DELETE FROM dbo.PharmacyFlyer_CampaignTarget
        OUTPUT DELETED.CampaignTargetId
        WHERE CampaignTargetId = @CampaignTargetId
          AND ApprovalStatus IN ('suggested', 'rejected')
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Target not found' });
    res.json({ campaignTargetId: result.recordset[0].CampaignTargetId, message: 'Target removed' });
  } catch (error) {
    console.error('Delete campaign target error:', error);
    res.status(500).json({ message: 'Could not delete campaign target' });
  }
});
