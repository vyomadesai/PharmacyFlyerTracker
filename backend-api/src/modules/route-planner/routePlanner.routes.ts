import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { osrmDrivingDistanceMiles } from '../../services/routeOptimizer/travel.js';
import { parseCoordinate, milesBetween } from '../../utils/geography.js';
import { buildLocationStopsForCampaign, buildLocationStopsForTerritory, findEnrichedDoctorsForCampaign } from './routePlannerStops.js';
import { getRoutePlanById, listRoutePlans, saveRoutePlan } from './routePlannerPlans.js';
import {
  assignRoutePlan,
  completeRoutePlanDrop,
  completeRoutePlanStop,
  listAssignableReps,
  listMyRoutePlans,
  LocationVisitBlockedError,
} from './routePlannerExecution.js';
import { deleteRoutePlannerCampaign, setRoutePlannerCampaignActive, updateRoutePlannerCampaign } from './routePlannerCampaigns.js';
import { setLocationVisitFrequency } from './routePlannerVisit.js';
import { getCampaignCoverage, previewDoctorsForSpecialtyInputs } from './routePlannerMatching.js';
import { loadUnifiedSpecialties } from './specialtyCatalog.js';
import {
  CHECK_IN_DISCOVERY_RADIUS_MILES,
  ROUTE_PLANNER_MAX_STOPS_PER_ROUTE,
  ROUTE_PLANNER_RADIUS_MILES,
} from './routePlannerConfig.js';
import {
  checkInRep,
  checkOutRep,
  listCheckInSessions,
  listRepCampaigns,
  listRepDeliveryHistory,
  listRepDeliveryCalendar,
} from './routePlannerCheckin.js';
import {
  getResolvedRouteTerritory,
  saveRouteTerritory,
} from './routePlannerTerritory.js';
import { searchAddressSuggestions } from '../../services/routeOptimizer/addressSearch.js';

export const routePlannerRoutes = Router();
routePlannerRoutes.use(requireAuth);

/*
 * Verified MDP specialty schema (inspect via INFORMATION_SCHEMA / SELECT TOP 1):
 *
 * dbo.Master_PrescribSpeciality
 *   PresNo                      -> prescriber key; join Master_Doctor via TRY_CONVERT(INT, Doctor_NO) = PresNo
 *   SpecialityID                -> FK to Master_PrsSpecialitiesList.RecID
 *   Level                       -> '1' Primary, '2' Secondary, '3' Tertiary (varchar, not 'Secondary')
 *   PrescribSpeciality_IsActive -> active flag
 *
 * dbo.Master_PrsSpecialitiesList
 *   RecID, SpecialityCode, Description, IsActive
 */

const MATCH_MODES = ['primary_only', 'secondary_only', 'primary_or_secondary'] as const;
const MATCH_LEVELS = ['1', '2', '3', 'any'] as const;

type MatchMode = (typeof MATCH_MODES)[number];
type MatchLevel = (typeof MATCH_LEVELS)[number];

type SpecialtyInput = {
  specialityRecId?: number;
  specialityCode?: string | null;
  description?: string | null;
  matchLevel?: MatchLevel;
};

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseMatchMode(value: unknown): MatchMode {
  const normalized = clean(value)?.toLowerCase();
  if (normalized && MATCH_MODES.includes(normalized as MatchMode)) {
    return normalized as MatchMode;
  }
  return 'secondary_only';
}

function parseMatchLevel(value: unknown): MatchLevel {
  const normalized = clean(value);
  if (normalized && MATCH_LEVELS.includes(normalized as MatchLevel)) {
    return normalized as MatchLevel;
  }
  return 'any';
}

function normalizeSpecialtyInput(raw: unknown): SpecialtyInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const specialityRecId = row.specialityRecId != null ? Number(row.specialityRecId) : null;
  const specialityCode = clean(row.specialityCode);
  const description = clean(row.description);
  const matchLevel = parseMatchLevel(row.matchLevel);

  if (specialityRecId != null && Number.isFinite(specialityRecId) && specialityRecId > 0) {
    return { specialityRecId, specialityCode, description, matchLevel };
  }
  if (specialityCode || description) {
    return { specialityCode, description, matchLevel };
  }
  return null;
}

function parseMatchOptions(query: Record<string, unknown>) {
  const radiusRaw = query.radiusMiles != null ? Number(query.radiusMiles) : 10;
  const visitRaw = query.visitFrequencyDays != null ? Number(query.visitFrequencyDays) : null;
  return {
    startLatitude: parseCoordinate(query.startLat),
    startLongitude: parseCoordinate(query.startLng),
    startZip: clean(query.startZip),
    startAddress: clean(query.startAddress),
    radiusMiles: Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 10,
    visitFrequencyDays: visitRaw != null && Number.isFinite(visitRaw) && visitRaw > 0 ? Math.floor(visitRaw) : null,
  };
}

routePlannerRoutes.get('/ping', (_req, res) => {
  res.json({ ok: true, module: 'route-planner' });
});

routePlannerRoutes.get('/territory', async (_req, res) => {
  try {
    const { territory, resolved, error } = await getResolvedRouteTerritory();
    res.json({ territory, resolved, configured: resolved != null, error });
  } catch (err) {
    console.error('[route-planner] GET /territory failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RouteTerritoryV2')) {
      return res.status(503).json({
        message: 'Territory table is missing. Run database/022_route_territory_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not load territory.' });
  }
});

routePlannerRoutes.put('/territory', async (req, res) => {
  const userId = Number((req as { user?: { id?: number } }).user?.id);
  try {
    const result = await saveRouteTerritory(
      {
        centerAddress: clean(req.body?.centerAddress),
        radiusMiles: req.body?.radiusMiles != null ? Number(req.body.radiusMiles) : null,
      },
      Number.isFinite(userId) ? userId : null,
    );
    if ('error' in result) {
      return res.status(400).json({ message: result.error });
    }
    res.json({ territory: result.territory, resolved: result.resolved });
  } catch (err) {
    console.error('[route-planner] PUT /territory failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RouteTerritoryV2')) {
      return res.status(503).json({
        message: 'Territory table is missing. Run database/022_route_territory_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not save territory.' });
  }
});

routePlannerRoutes.get('/address-suggest', async (req, res) => {
  const q = clean(req.query.q);
  if (!q || q.length < 3) {
    return res.json([]);
  }
  try {
    const results = await searchAddressSuggestions(q, 8);
    res.json(results);
  } catch (err) {
    console.error('[route-planner] GET /address-suggest failed:', err);
    res.status(500).json({ message: 'Could not search addresses.' });
  }
});

routePlannerRoutes.get('/specialties', async (req, res) => {
  const q = clean(req.query.q);

  try {
    let specialties = await loadUnifiedSpecialties();
    if (q) {
      const needle = q.toLowerCase();
      specialties = specialties.filter((item) => (
        item.SpecialityCode.toLowerCase().includes(needle)
        || item.Description.toLowerCase().includes(needle)
        || item.npiDescriptions.some((label) => label.toLowerCase().includes(needle))
        || item.taxonomyCodes.some((code) => code.toLowerCase().includes(needle))
      ));
    }
    res.json(specialties);
  } catch (err) {
    console.error('[route-planner] GET /specialties failed:', err);
    res.status(500).json({ message: 'Could not load specialties.' });
  }
});

routePlannerRoutes.post('/preview-doctors', async (req, res) => {
  const rawSpecialties = Array.isArray(req.body?.specialties) ? req.body.specialties : [];
  const specialties = rawSpecialties
    .map(normalizeSpecialtyInput)
    .filter((row: SpecialtyInput | null): row is SpecialtyInput => row != null);

  if (!specialties.length) {
    return res.status(400).json({ message: 'At least one specialty is required.' });
  }

  try {
    const result = await previewDoctorsForSpecialtyInputs(specialties);
    res.json(result);
  } catch (err) {
    console.error('[route-planner] POST /preview-doctors failed:', err);
    res.status(500).json({ message: 'Could not preview matching doctors.' });
  }
});

routePlannerRoutes.post('/campaigns', async (req, res) => {
  const campaignName = clean(req.body?.campaignName);
  if (!campaignName) {
    return res.status(400).json({ message: 'campaignName is required.' });
  }

  const description = clean(req.body?.description);
  const matchMode = parseMatchMode(req.body?.matchMode);
  const rawSpecialties = Array.isArray(req.body?.specialties) ? req.body.specialties : [];
  const specialties = rawSpecialties
    .map(normalizeSpecialtyInput)
    .filter((row: SpecialtyInput | null): row is SpecialtyInput => row != null);

  if (!specialties.length) {
    return res.status(400).json({ message: 'At least one specialty is required.' });
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const campaignResult = await new sql.Request(transaction)
      .input('CampaignName', sql.NVarChar, campaignName)
      .input('Description', sql.NVarChar, description)
      .input('FlyerTitle', sql.NVarChar, campaignName)
      .input('CreatedBy', sql.Int, req.user?.userId ?? null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Campaign (
          CampaignName, Description, FlyerTitle, CreatedBy
        )
        OUTPUT INSERTED.CampaignId, INSERTED.CampaignName, INSERTED.Description,
               INSERTED.FlyerTitle, INSERTED.IsActive, INSERTED.CreatedDate
        VALUES (@CampaignName, @Description, @FlyerTitle, @CreatedBy)
      `);

    const campaign = campaignResult.recordset[0];
    const campaignId = Number(campaign.CampaignId);
    const insertedSpecialties: Record<string, unknown>[] = [];

    for (const specialty of specialties) {
      const insertResult = await new sql.Request(transaction)
        .input('CampaignId', sql.Int, campaignId)
        .input('SpecialityRecID', sql.Int, specialty.specialityRecId ?? null)
        .input('SpecialityCode', sql.NVarChar, specialty.specialityCode ?? null)
        .input('Description', sql.NVarChar, specialty.description ?? null)
        .input('MatchLevel', sql.VarChar, specialty.matchLevel ?? 'any')
        .input('MatchMode', sql.VarChar, matchMode)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_CampaignSpecialtyV2 (
            CampaignId, SpecialityRecID, SpecialityCode, Description, MatchLevel, MatchMode
          )
          OUTPUT INSERTED.*
          VALUES (
            @CampaignId, @SpecialityRecID, @SpecialityCode, @Description, @MatchLevel, @MatchMode
          )
        `);
      insertedSpecialties.push(insertResult.recordset[0]);
    }

    await transaction.commit();

    res.status(201).json({
      ...campaign,
      matchMode,
      specialties: insertedSpecialties.map((row) => ({
        campaignSpecialtyV2Id: row.CampaignSpecialtyV2Id,
        campaignId: row.CampaignId,
        specialityRecId: row.SpecialityRecID,
        specialityCode: row.SpecialityCode,
        description: row.Description,
        matchLevel: row.MatchLevel,
        matchMode: row.MatchMode,
        isActive: row.IsActive,
        createdDate: row.CreatedDate,
      })),
    });
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore rollback errors */
    }
    console.error('[route-planner] POST /campaigns failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_CampaignSpecialtyV2')) {
      return res.status(503).json({
        message: 'Route planner tables are missing. Run database/017_route_planner_campaign_specialty.sql first.',
      });
    }
    return res.status(500).json({ message: 'Could not create campaign.' });
  }
});

routePlannerRoutes.get('/campaigns', async (req, res) => {
  const pool = await getPool();
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === '1'
    || String(req.query.includeInactive || '').toLowerCase() === 'true';

  try {
    const campaignsResult = await pool.request().query(`
      SELECT DISTINCT
        c.CampaignId,
        c.CampaignName,
        c.Description,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        COALESCE(c.FrequencyInDays, c.DefaultVisitFrequencyDays) AS FrequencyInDays,
        c.IsActive,
        c.CreatedDate
      FROM dbo.PharmacyFlyer_Campaign c
      INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
        ON cs.CampaignId = c.CampaignId
      ${includeInactive ? '' : 'AND cs.IsActive = 1'}
      ${includeInactive ? '' : 'WHERE c.IsActive = 1'}
      ORDER BY c.CampaignName
    `);

    const specialtiesResult = await pool.request().query(`
      SELECT
        cs.CampaignSpecialtyV2Id,
        cs.CampaignId,
        cs.SpecialityRecID,
        cs.SpecialityCode,
        cs.Description,
        cs.MatchLevel,
        cs.MatchMode,
        cs.IsActive,
        cs.CreatedDate
      FROM dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = cs.CampaignId
      ${includeInactive ? '' : 'AND c.IsActive = 1'}
      ${includeInactive ? '' : 'WHERE cs.IsActive = 1'}
      ORDER BY cs.CampaignId, cs.Description, cs.SpecialityCode
    `);

    const specialtiesByCampaign = new Map<number, Record<string, unknown>[]>();
    for (const row of specialtiesResult.recordset) {
      if (!row.IsActive) continue;
      const campaignId = Number(row.CampaignId);
      if (!specialtiesByCampaign.has(campaignId)) {
        specialtiesByCampaign.set(campaignId, []);
      }
      specialtiesByCampaign.get(campaignId)!.push({
        campaignSpecialtyV2Id: row.CampaignSpecialtyV2Id,
        campaignId: row.CampaignId,
        specialityRecId: row.SpecialityRecID,
        specialityCode: row.SpecialityCode,
        description: row.Description,
        matchLevel: row.MatchLevel,
        matchMode: row.MatchMode,
        isActive: row.IsActive,
        createdDate: row.CreatedDate,
      });
    }

    res.json(
      campaignsResult.recordset.map((campaign: Record<string, unknown>) => ({
        campaignId: campaign.CampaignId,
        campaignName: campaign.CampaignName,
        description: campaign.Description,
        flyerTitle: campaign.FlyerTitle,
        flyerIdentifier: campaign.FlyerIdentifier,
        flyerCategory: campaign.FlyerCategory,
        frequencyInDays: campaign.FrequencyInDays,
        isActive: campaign.IsActive,
        createdDate: campaign.CreatedDate,
        specialties: specialtiesByCampaign.get(Number(campaign.CampaignId)) ?? [],
      })),
    );
  } catch (err) {
    console.error('[route-planner] GET /campaigns failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_CampaignSpecialtyV2')) {
      return res.status(503).json({
        message: 'Route planner tables are missing. Run database/017_route_planner_campaign_specialty.sql first.',
      });
    }
    return res.status(500).json({ message: 'Could not load campaigns.' });
  }
});

function parseCampaignBody(body: Record<string, unknown>) {
  const campaignName = clean(body?.campaignName);
  if (!campaignName) {
    return { error: 'campaignName is required.' as const };
  }

  const description = clean(body?.description);
  const matchMode = parseMatchMode(body?.matchMode);
  const rawSpecialties = Array.isArray(body?.specialties) ? body.specialties : [];
  const specialties = rawSpecialties
    .map(normalizeSpecialtyInput)
    .filter((row: SpecialtyInput | null): row is SpecialtyInput => row != null);

  if (!specialties.length) {
    return { error: 'At least one specialty is required.' as const };
  }

  return {
    campaignName,
    description,
    matchMode,
    specialties,
  };
}

routePlannerRoutes.put('/campaigns/:id', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }

  const parsed = parseCampaignBody(req.body as Record<string, unknown>);
  if ('error' in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  try {
    const updated = await updateRoutePlannerCampaign(campaignId, parsed);
    if (!updated) return res.status(404).json({ message: 'Route planner campaign not found.' });
    res.json(updated);
  } catch (err) {
    console.error('[route-planner] PUT /campaigns/:id failed:', err);
    return res.status(500).json({ message: 'Could not update campaign.' });
  }
});

routePlannerRoutes.delete('/campaigns/:id', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }

  try {
    const deleted = await deleteRoutePlannerCampaign(campaignId);
    if (!deleted) return res.status(404).json({ message: 'Route planner campaign not found.' });
    res.json(deleted);
  } catch (err) {
    console.error('[route-planner] DELETE /campaigns/:id failed:', err);
    return res.status(500).json({ message: 'Could not delete campaign.' });
  }
});

routePlannerRoutes.patch('/campaigns/:id/active', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }

  const isActive = req.body?.isActive;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'isActive (boolean) is required.' });
  }

  try {
    const updated = await setRoutePlannerCampaignActive(campaignId, isActive);
    if (!updated) return res.status(404).json({ message: 'Route planner campaign not found.' });
    res.json(updated);
  } catch (err) {
    console.error('[route-planner] PATCH /campaigns/:id/active failed:', err);
    return res.status(500).json({ message: 'Could not update campaign status.' });
  }
});

routePlannerRoutes.get('/config', (_req, res) => {
  res.json({
    radiusMiles: ROUTE_PLANNER_RADIUS_MILES,
    discoveryRadiusMiles: CHECK_IN_DISCOVERY_RADIUS_MILES,
    maxStopsPerRoute: null,
    legacyMaxStopsPerManualPlan: ROUTE_PLANNER_MAX_STOPS_PER_ROUTE,
  });
});

routePlannerRoutes.get('/campaigns/:id/coverage', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }
  try {
    const coverage = await getCampaignCoverage(campaignId);
    if (!coverage) return res.status(404).json({ message: 'Campaign not found.' });
    res.json({
      campaignId,
      total: coverage.total,
      covered: coverage.covered,
      remaining: coverage.remaining,
      frequencyInDays: coverage.frequencyInDays,
    });
  } catch (err) {
    console.error('[route-planner] GET /campaigns/:id/coverage failed:', err);
    res.status(500).json({ message: 'Could not load coverage.' });
  }
});

routePlannerRoutes.get('/checkins', async (req, res) => {
  const limitRaw = req.query.limit != null ? Number(req.query.limit) : 200;
  try {
    const sessions = await listCheckInSessions(limitRaw);
    res.json({ sessions });
  } catch (err) {
    console.error('[route-planner] GET /checkins failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RouteCheckInV2')) {
      return res.status(503).json({
        message: 'Check-in table is missing. Run database/020_route_checkin_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not load check-in sessions.' });
  }
});

routePlannerRoutes.get('/my/campaigns', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const campaigns = await listRepCampaigns(userId);
    res.json({ campaigns });
  } catch (err) {
    console.error('[route-planner] GET /my/campaigns failed:', err);
    res.status(500).json({ message: 'Could not load campaigns.' });
  }
});

routePlannerRoutes.get('/my/deliveries', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const limitRaw = req.query.limit != null ? Number(req.query.limit) : 100;
  try {
    const result = await listRepDeliveryHistory(userId, limitRaw);
    res.json(result);
  } catch (err) {
    console.error('[route-planner] GET /my/deliveries failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RouteCheckInV2')) {
      return res.status(503).json({
        message: 'Check-in table is missing. Run database/020_route_checkin_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not load delivery history.' });
  }
});

routePlannerRoutes.get('/my/calendar', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const result = await listRepDeliveryCalendar(userId);
    res.json(result);
  } catch (err) {
    console.error('[route-planner] GET /my/calendar failed:', err);
    res.status(500).json({ message: 'Could not load delivery calendar.' });
  }
});

routePlannerRoutes.post('/driving-distance', async (req, res) => {
  const fromLat = parseCoordinate(req.body?.fromLat ?? req.body?.from?.lat ?? req.body?.from?.latitude);
  const fromLng = parseCoordinate(req.body?.fromLng ?? req.body?.from?.lng ?? req.body?.from?.longitude);
  const toLat = parseCoordinate(req.body?.toLat ?? req.body?.to?.lat ?? req.body?.to?.latitude);
  const toLng = parseCoordinate(req.body?.toLng ?? req.body?.to?.lng ?? req.body?.to?.longitude);

  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return res.status(400).json({ message: 'Valid from/to lat/lng are required.' });
  }

  try {
    const straightMiles = Math.round(milesBetween(fromLat, fromLng, toLat, toLng) * 100) / 100;
    const drivingMiles = await osrmDrivingDistanceMiles(
      { latitude: fromLat, longitude: fromLng },
      { latitude: toLat, longitude: toLng },
    );
    res.json({
      straightMiles,
      drivingMiles: drivingMiles ?? straightMiles,
    });
  } catch (err) {
    console.error('[route-planner] POST /driving-distance failed:', err);
    res.status(500).json({ message: 'Could not compute driving distance.' });
  }
});

routePlannerRoutes.post('/my/checkin', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const lat = parseCoordinate(req.body?.lat ?? req.body?.latitude);
  const lng = parseCoordinate(req.body?.lng ?? req.body?.longitude);

  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'Valid GPS lat/lng are required to check in.' });
  }

  try {
    const result = await checkInRep(userId, lat, lng);
    if ('error' in result) return res.status(400).json({ message: result.error });
    res.status(201).json(result);
  } catch (err) {
    console.error('[route-planner] POST /my/checkin failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RouteCheckInV2')) {
      return res.status(503).json({
        message: 'Check-in table is missing. Run database/020_route_checkin_v2.sql first.',
      });
    }
    if (message.includes('PharmacyFlyer_LocationHoldV2')) {
      return res.status(503).json({
        message: 'Location hold table is missing. Run database/024_location_hold_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not check in.' });
  }
});

routePlannerRoutes.post('/my/checkout', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const checkInId = Number(req.body?.checkInId);
  if (!Number.isFinite(checkInId) || checkInId <= 0) {
    return res.status(400).json({ message: 'Valid checkInId is required.' });
  }

  try {
    const result = await checkOutRep(userId, checkInId);
    res.json(result);
  } catch (err) {
    console.error('[route-planner] POST /my/checkout failed:', err);
    res.status(500).json({ message: 'Could not check out.' });
  }
});

routePlannerRoutes.get('/campaigns/:id/doctors', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }

  try {
    const options = {
      ...parseMatchOptions(req.query as Record<string, unknown>),
      includeUnmappedLocations: String(req.query.includeUnmapped ?? 'true').toLowerCase() !== 'false',
    };
    const result = await findEnrichedDoctorsForCampaign(campaignId, options);
    if (!result) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    if ('error' in result && result.error) {
      return res.status(400).json({ message: result.error });
    }

    const { campaign, doctors, startPoint, radiusMiles } = result;
    res.json({
      campaignId: campaign.CampaignId,
      campaignName: campaign.CampaignName,
      description: campaign.Description,
      flyerTitle: campaign.FlyerTitle,
      count: doctors.length,
      startPoint,
      radiusMiles,
      doctors,
    });
  } catch (err) {
    console.error('[route-planner] GET /campaigns/:id/doctors failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_CampaignSpecialtyV2')) {
      return res.status(503).json({
        message: 'Route planner tables are missing. Run database/017_route_planner_campaign_specialty.sql first.',
      });
    }
    return res.status(500).json({ message: 'Could not load matching doctors.' });
  }
});

routePlannerRoutes.get('/campaigns/:id/stops', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaign id is required.' });
  }

  try {
    const { resolved, error: territoryError } = await getResolvedRouteTerritory();
    if (!resolved) {
      return res.status(400).json({
        message: territoryError || 'Coverage centroid is not configured. Enter a center address and save.',
      });
    }

    const result = await buildLocationStopsForTerritory(campaignId, resolved);
    if (!result) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    if ('error' in result && result.error) {
      return res.status(400).json({ message: result.error });
    }

    const { campaign, stops, startPoint, radiusMiles, doctorCount, defaultVisitFrequencyDays, coverage } = result;
    res.json({
      campaignId: campaign.CampaignId,
      campaignName: campaign.CampaignName,
      description: campaign.Description,
      flyerTitle: campaign.FlyerTitle,
      startPoint,
      radiusMiles,
      doctorCount,
      locationCount: stops.length,
      defaultVisitFrequencyDays,
      coverage,
      territory: {
        centerLabel: resolved.centerLabel,
        centerAddress: resolved.centerAddress,
        centerLatitude: resolved.centerLatitude,
        centerLongitude: resolved.centerLongitude,
        radiusMiles: resolved.radiusMiles,
        pharmacyId: resolved.pharmacyId ?? null,
      },
      stops,
    });
  } catch (err) {
    console.error('[route-planner] GET /campaigns/:id/stops failed:', err);
    return res.status(500).json({ message: 'Could not load location stops.' });
  }
});

// Persist a single location's visit frequency (days between rep visits).
routePlannerRoutes.put('/locations/visit-frequency', async (req, res) => {
  const locationKey = clean(req.body?.locationKey);
  const visitFrequencyDays = Number(req.body?.visitFrequencyDays);
  if (!locationKey) {
    return res.status(400).json({ message: 'locationKey is required.' });
  }
  if (!Number.isFinite(visitFrequencyDays) || visitFrequencyDays <= 0) {
    return res.status(400).json({ message: 'visitFrequencyDays must be a positive number.' });
  }

  try {
    const saved = await setLocationVisitFrequency(locationKey, visitFrequencyDays);
    res.json(saved);
  } catch (err) {
    console.error('[route-planner] PUT /locations/visit-frequency failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_LocationVisitV2')) {
      return res.status(503).json({
        message: 'Visit frequency table is missing. Run database/021_location_visit_frequency_v2.sql first.',
      });
    }
    res.status(500).json({ message: 'Could not save visit frequency.' });
  }
});

routePlannerRoutes.post('/plans', async (req, res) => {
  const routeName = clean(req.body?.routeName);
  const campaignId = Number(req.body?.campaignId);
  const stops = Array.isArray(req.body?.stops) ? req.body.stops : [];

  if (!routeName) return res.status(400).json({ message: 'routeName is required.' });
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Valid campaignId is required.' });
  }
  if (!stops.length) return res.status(400).json({ message: 'stops array is required.' });

  try {
    const saved = await saveRoutePlan({
      routeName,
      campaignId,
      startType: clean(req.body?.startType) || 'custom',
      startLabel: clean(req.body?.startLabel),
      startLatitude: parseCoordinate(req.body?.startLat ?? req.body?.startLatitude),
      startLongitude: parseCoordinate(req.body?.startLng ?? req.body?.startLongitude),
      radiusMiles: req.body?.radiusMiles != null ? Number(req.body.radiusMiles) : null,
      planDate: clean(req.body?.planDate),
      stops,
      createdBy: req.user?.userId ?? null,
    });
    res.status(201).json(saved);
  } catch (err) {
    console.error('[route-planner] POST /plans failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RoutePlanV2')) {
      return res.status(503).json({
        message: 'Route plan tables are missing. Run database/018_route_plan_v2.sql first.',
      });
    }
    return res.status(500).json({ message: 'Could not save route plan.' });
  }
});

routePlannerRoutes.get('/plans', async (_req, res) => {
  try {
    const routes = await listRoutePlans();
    res.json({ routes });
  } catch (err) {
    console.error('[route-planner] GET /plans failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('PharmacyFlyer_RoutePlanV2')) {
      return res.status(503).json({
        message: 'Route plan tables are missing. Run database/018_route_plan_v2.sql first.',
      });
    }
    return res.status(500).json({ message: 'Could not load route plans.' });
  }
});

routePlannerRoutes.get('/plans/:id', async (req, res) => {
  const routePlanId = Number(req.params.id);
  if (!Number.isFinite(routePlanId) || routePlanId <= 0) {
    return res.status(400).json({ message: 'Valid route plan id is required.' });
  }

  try {
    const plan = await getRoutePlanById(routePlanId);
    if (!plan) return res.status(404).json({ message: 'Route plan not found.' });
    res.json(plan);
  } catch (err) {
    console.error('[route-planner] GET /plans/:id failed:', err);
    return res.status(500).json({ message: 'Could not load route plan.' });
  }
});

routePlannerRoutes.get('/saved', async (_req, res) => {
  try {
    const routes = await listRoutePlans();
    res.json({ routes });
  } catch (err) {
    console.error('[route-planner] GET /saved failed:', err);
    res.json({ routes: [] });
  }
});

routePlannerRoutes.get('/reps', async (_req, res) => {
  try {
    const reps = await listAssignableReps();
    res.json(reps);
  } catch (err) {
    console.error('[route-planner] GET /reps failed:', err);
    res.status(500).json({ message: 'Could not load reps.' });
  }
});

routePlannerRoutes.post('/plans/:id/assign', async (req, res) => {
  const routePlanId = Number(req.params.id);
  const assignedUserId = Number(req.body?.assignedUserId);
  if (!Number.isFinite(routePlanId) || routePlanId <= 0) {
    return res.status(400).json({ message: 'Valid route plan id is required.' });
  }
  if (!Number.isFinite(assignedUserId) || assignedUserId <= 0) {
    return res.status(400).json({ message: 'assignedUserId is required.' });
  }

  try {
    const plan = await assignRoutePlan(routePlanId, assignedUserId);
    if (!plan) return res.status(404).json({ message: 'Route plan not found.' });
    res.json(plan);
  } catch (err) {
    console.error('[route-planner] POST /plans/:id/assign failed:', err);
    res.status(500).json({ message: err instanceof Error ? err.message : 'Could not assign route plan.' });
  }
});

routePlannerRoutes.get('/my/plans', async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const result = await listMyRoutePlans(staffUserId, clean(req.query.date));
    res.json(result);
  } catch (err) {
    console.error('[route-planner] GET /my/plans failed:', err);
    res.status(500).json({ message: 'Could not load assigned route plans.' });
  }
});

routePlannerRoutes.post('/stops/:stopId/complete', async (req, res) => {
  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  try {
    const plan = await completeRoutePlanStop(routePlanStopId, req.user?.userId ?? null);
    if (!plan) return res.status(404).json({ message: 'Route stop not found.' });
    res.json(plan);
  } catch (err) {
    console.error('[route-planner] POST /stops/:stopId/complete failed:', err);
    if (err instanceof LocationVisitBlockedError) {
      return res.status(409).json({ message: err.message, code: err.code });
    }
    res.status(500).json({ message: err instanceof Error ? err.message : 'Could not complete stop.' });
  }
});

routePlannerRoutes.post('/drops/:dropId/complete', async (req, res) => {
  const routePlanDropId = Number(req.params.dropId);
  if (!Number.isFinite(routePlanDropId) || routePlanDropId <= 0) {
    return res.status(400).json({ message: 'Valid drop id is required.' });
  }

  try {
    const plan = await completeRoutePlanDrop(routePlanDropId, req.user?.userId ?? null);
    if (!plan) return res.status(404).json({ message: 'Route drop not found.' });
    res.json(plan);
  } catch (err) {
    console.error('[route-planner] POST /drops/:dropId/complete failed:', err);
    if (err instanceof LocationVisitBlockedError) {
      return res.status(409).json({ message: err.message, code: err.code });
    }
    res.status(500).json({ message: err instanceof Error ? err.message : 'Could not complete drop.' });
  }
});
