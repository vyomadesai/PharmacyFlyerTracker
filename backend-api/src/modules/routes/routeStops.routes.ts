import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdminOrManager, requireDistributor } from '../../middleware/role.middleware.js';
import { upload } from '../../middleware/upload.middleware.js';
import {
  checkInRouteStop,
  completeRouteStopWorkflow,
  getMyAssignments,
  getMyRoutes,
  getMyRoutesCalendar,
  getMyTodayRoute,
  getRouteStopById,
  getRouteStopProofPhoto,
  skipRouteStop,
  uploadRouteStopProof,
} from '../../services/routeStopWorkflow.js';

export const routeStopsRouter = Router();
routeStopsRouter.use(requireAuth);

routeStopsRouter.get('/my/today', requireDistributor, async (req, res) => {
  try {
    const data = await getMyTodayRoute(req.user!.userId);
    res.json(data);
  } catch (error) {
    console.error('My today route error:', error);
    res.status(500).json({ message: 'Could not load today route' });
  }
});

routeStopsRouter.get('/my', requireDistributor, async (req, res) => {
  try {
    const routes = await getMyRoutes(
      req.user!.userId,
      req.query.routeDate ? String(req.query.routeDate) : null,
    );
    res.json({ count: routes.length, routes });
  } catch (error) {
    console.error('My routes error:', error);
    res.status(500).json({ message: 'Could not load routes' });
  }
});

routeStopsRouter.get('/my/calendar', requireDistributor, async (req, res) => {
  try {
    const data = await getMyRoutesCalendar(req.user!.userId);
    res.json(data);
  } catch (error) {
    console.error('My routes calendar error:', error);
    res.status(500).json({ message: 'Could not load route calendar' });
  }
});

routeStopsRouter.get('/my/assignments', requireDistributor, async (req, res) => {
  try {
    const data = await getMyAssignments(req.user!.userId);
    res.json(data);
  } catch (error) {
    console.error('My assignments error:', error);
    res.status(500).json({ message: 'Could not load assignments' });
  }
});

routeStopsRouter.get('/stops/:id', async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    if (!Number.isFinite(stopId)) return res.status(400).json({ message: 'Invalid stop id' });
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const stop = await getRouteStopById(stopId, isAdmin ? null : req.user!.userId);
    if (!stop) return res.status(404).json({ message: 'Route stop not found' });
    res.json(stop);
  } catch (error) {
    console.error('Get route stop error:', error);
    res.status(500).json({ message: 'Could not load route stop' });
  }
});

routeStopsRouter.get('/stops/:id/proof', requireDistributor, async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    const photo = await getRouteStopProofPhoto(stopId, req.user!.userId);
    if (!photo) return res.status(404).json({ message: 'Proof photo not found' });
    res.setHeader('Content-Type', photo.ContentType || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${photo.FileName || 'proof.jpg'}"`);
    res.send(photo.PhotoData);
  } catch (error) {
    console.error('Route stop proof photo error:', error);
    res.status(500).json({ message: 'Could not load proof photo' });
  }
});

routeStopsRouter.post('/stops/:id/checkin', requireDistributor, async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    if (!Number.isFinite(stopId)) return res.status(400).json({ message: 'Invalid stop id' });
    const stop = await checkInRouteStop(stopId, req.user!.userId, {
      latitude: req.body?.latitude ?? req.body?.userLatitude ?? null,
      longitude: req.body?.longitude ?? req.body?.userLongitude ?? null,
      gpsAccuracyMeters: req.body?.gpsAccuracyMeters ?? req.body?.accuracy ?? null,
      verificationNote: req.body?.verificationNote ?? req.body?.note ?? null,
    });
    res.json(stop);
  } catch (error) {
    console.error('Route stop check-in error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not check in' });
  }
});

routeStopsRouter.post('/stops/:id/upload-proof', requireDistributor, upload.single('photo'), async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    if (!Number.isFinite(stopId)) return res.status(400).json({ message: 'Invalid stop id' });
    if (!req.file) return res.status(400).json({ message: 'photo is required' });
    const result = await uploadRouteStopProof(stopId, req.user!.userId, {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Route stop upload proof error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not upload proof' });
  }
});

routeStopsRouter.post('/stops/:id/complete', requireDistributor, async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    if (!Number.isFinite(stopId)) return res.status(400).json({ message: 'Invalid stop id' });
    const result = await completeRouteStopWorkflow(stopId, req.user!.userId, req.body?.notes ?? null);
    res.json(result);
  } catch (error) {
    console.error('Route stop complete error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not complete stop' });
  }
});

routeStopsRouter.post('/stops/:id/skip', requireDistributor, async (req, res) => {
  try {
    const stopId = Number(req.params.id);
    if (!Number.isFinite(stopId)) return res.status(400).json({ message: 'Invalid stop id' });
    const result = await skipRouteStop(stopId, req.user!.userId, {
      reason: req.body?.reason ?? req.body?.skippedReason ?? '',
      status: req.body?.status === 'failed' ? 'failed' : 'skipped',
    });
    res.json(result);
  } catch (error) {
    console.error('Route stop skip error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not skip stop' });
  }
});
