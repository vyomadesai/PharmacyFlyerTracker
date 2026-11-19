import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { upload } from '../../middleware/upload.middleware.js';
import { completeRoutePlanDrop } from '../route-planner/routePlannerExecution.js';
import { savePhysicalVisitBatch } from '../new-entries/newEntriesPhysicalVisitSave.js';
import {
  enrichRoutePlanStop,
  loadStopFrontDesk,
  loadStopPracticeName,
  saveStopFrontDesk,
  saveStopPracticeName,
} from './routeThreeEnrichment.js';
import { NPI_REGISTRY_ENRICHMENT_RADIUS_MILES } from '../route-planner/routePlannerConfig.js';

export const routeThreeRoutes = Router();
routeThreeRoutes.use(requireAuth);

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

routeThreeRoutes.get('/ping', (_req, res) => {
  res.json({ ok: true, module: 'route-three' });
});

routeThreeRoutes.get('/stops/:stopId/enrichment', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  const radiusRaw = req.query.radiusMiles != null ? Number(req.query.radiusMiles) : NPI_REGISTRY_ENRICHMENT_RADIUS_MILES;
  const radiusMiles = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : NPI_REGISTRY_ENRICHMENT_RADIUS_MILES;

  try {
    const result = await enrichRoutePlanStop({ routePlanStopId, userId, radiusMiles });
    if ('error' in result) return res.status(400).json({ message: result.error });
    res.json(result);
  } catch (err) {
    console.error('[route-three] GET /stops/:stopId/enrichment failed:', err);
    res.status(500).json({ message: 'Could not load stop enrichment.' });
  }
});

routeThreeRoutes.get('/stops/:stopId/practice-name', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  try {
    const result = await loadStopPracticeName({ routePlanStopId, userId });
    if ('error' in result) return res.status(404).json({ message: result.error });
    res.json(result);
  } catch (err) {
    console.error('[route-three] GET /stops/:stopId/practice-name failed:', err);
    res.status(500).json({ message: 'Could not load practice name.' });
  }
});

routeThreeRoutes.patch('/stops/:stopId/practice-name', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  try {
    const result = await saveStopPracticeName({
      routePlanStopId,
      userId,
      practiceName: String(req.body?.practiceName ?? ''),
    });
    if ('error' in result) return res.status(400).json({ message: result.error });
    res.json({ message: 'Practice name saved.', ...result });
  } catch (err) {
    console.error('[route-three] PATCH /stops/:stopId/practice-name failed:', err);
    res.status(500).json({ message: 'Could not save practice name.' });
  }
});

routeThreeRoutes.get('/stops/:stopId/front-desk', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  try {
    const result = await loadStopFrontDesk({ routePlanStopId, userId });
    if ('error' in result) return res.status(404).json({ message: result.error });
    res.json(result);
  } catch (err) {
    console.error('[route-three] GET /stops/:stopId/front-desk failed:', err);
    res.status(500).json({ message: 'Could not load front-desk notes.' });
  }
});

routeThreeRoutes.patch('/stops/:stopId/front-desk', async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  try {
    const result = await saveStopFrontDesk({
      routePlanStopId,
      userId,
      outcome: req.body?.outcome,
      bestTime: req.body?.bestTime,
      contactName: req.body?.contactName,
      note: req.body?.note,
    });
    if ('error' in result) return res.status(404).json({ message: result.error });
    res.json(result);
  } catch (err) {
    console.error('[route-three] PATCH /stops/:stopId/front-desk failed:', err);
    res.status(500).json({ message: 'Could not save front-desk notes.' });
  }
});

routeThreeRoutes.post('/stops/:stopId/save-enrichment', upload.single('photo'), async (req, res) => {
  const staffUserId = req.user?.userId;
  if (!staffUserId) return res.status(401).json({ message: 'Unauthorized' });

  const routePlanStopId = Number(req.params.stopId);
  if (!Number.isFinite(routePlanStopId) || routePlanStopId <= 0) {
    return res.status(400).json({ message: 'Valid stop id is required.' });
  }

  const enrichment = await enrichRoutePlanStop({ routePlanStopId, userId: staffUserId });
  if ('error' in enrichment) return res.status(400).json({ message: enrichment.error });

  // Practice name typed by the distributor, or the real one on file. Never the stop label (doctor name on unmapped stops).
  const practiceName = String(req.body?.practiceName || enrichment.practiceName || enrichment.addressStreet || 'Unknown practice').trim();
  const locationAddress = String(req.body?.locationAddress || [
    enrichment.addressStreet,
    enrichment.addressCity,
    enrichment.addressState,
    enrichment.addressZip,
  ].filter(Boolean).join(', ')).trim();

  const physicalDrop = parseJsonField(req.body?.physicalDropJson, {
    dropStatus: 'dropped',
    stopType: 'unknown',
    campaignId: null,
    flyerTitle: null,
    flyerQuantity: 1,
    notes: '',
    droppedAt: new Date().toISOString(),
  });

  const orgLinks = parseJsonField(req.body?.orgLinksJson, []);
  const providers = parseJsonField(req.body?.providersJson, []);
  const routePlanDropIds = parseJsonField<number[]>(req.body?.routePlanDropIdsJson, []);

  try {
    for (let i = 0; i < routePlanDropIds.length; i += 1) {
      const dropId = Number(routePlanDropIds[i]);
      if (Number.isFinite(dropId) && dropId > 0) {
        await completeRoutePlanDrop(dropId, staffUserId, { sameVisit: i > 0 });
      }
    }

    const saved = await savePhysicalVisitBatch({
      staffUserId,
      visitBatchId: req.body?.visitBatchId || null,
      practiceName,
      locationAddress,
      street: enrichment.addressStreet,
      city: enrichment.addressCity,
      state: enrichment.addressState,
      postalCode: enrichment.addressZip,
      latitude: enrichment.latitude,
      longitude: enrichment.longitude,
      physicalDrop,
      orgLinks,
      providers,
      photo: req.file
        ? {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            buffer: req.file.buffer,
          }
        : null,
    });

    res.status(201).json({
      message: 'Stop enrichment saved.',
      routePlanStopId,
      ...saved,
    });
  } catch (err) {
    console.error('[route-three] POST /stops/:stopId/save-enrichment failed:', err);
    res.status(500).json({ message: err instanceof Error ? err.message : 'Could not save stop enrichment.' });
  }
});
