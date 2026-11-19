import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdminOrManager, requireDistributor } from '../../middleware/role.middleware.js';
import {
  addStopsToRoute,
  assignRoute,
  cancelRoute,
  completeRouteStop,
  createRoute,
  getRouteById,
  listRoutes,
  removeRouteStop,
  reorderRouteStops,
  sortRouteStopsByNearest,
  updateRoute,
} from '../../services/routeManagement.js';
import { completeRouteStopWorkflow } from '../../services/routeStopWorkflow.js';

export const flyerRoutesRouter = Router();
flyerRoutesRouter.use(requireAuth);

flyerRoutesRouter.get('/today', requireDistributor, async (req, res) => {
  try {
    const routes = await listRoutes({
      distributorUserId: req.user!.userId,
      todayOnly: true,
    });
    res.json({ count: routes.length, routes });
  } catch (error) {
    console.error('Today routes error:', error);
    res.status(500).json({ message: 'Could not load today routes' });
  }
});

flyerRoutesRouter.get('/', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const distributorUserId = isAdmin
      ? (req.query.distributorUserId ? Number(req.query.distributorUserId) : null)
      : req.user!.userId;

    if (!isAdmin && req.user?.role !== 'distributor') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const routes = await listRoutes({
      distributorUserId: isAdmin ? distributorUserId : req.user!.userId,
      routeDate: req.query.routeDate ? String(req.query.routeDate) : null,
      status: req.query.status ? String(req.query.status) : null,
      todayOnly: String(req.query.todayOnly || '').toLowerCase() === 'true',
    });
    res.json({ count: routes.length, routes });
  } catch (error) {
    console.error('List routes error:', error);
    res.status(500).json({ message: 'Could not load routes' });
  }
});

flyerRoutesRouter.post('/', requireAdminOrManager, async (req, res) => {
  try {
    const routeName = String(req.body?.routeName || '').trim();
    if (!routeName) return res.status(400).json({ message: 'routeName is required' });

    const route = await createRoute({
      routeName,
      routeDate: req.body?.routeDate ?? null,
      distributorUserId: req.body?.distributorUserId ? Number(req.body.distributorUserId) : null,
      marketId: req.body?.marketId ? Number(req.body.marketId) : null,
      startType: req.body?.startType || 'home',
      startAddress: req.body?.startAddress ?? null,
      startLatitude: req.body?.startLatitude != null ? Number(req.body.startLatitude) : null,
      startLongitude: req.body?.startLongitude != null ? Number(req.body.startLongitude) : null,
    });
    res.status(201).json(route);
  } catch (error) {
    console.error('Create route error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not create route' });
  }
});

flyerRoutesRouter.get('/:id', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });

    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const route = await getRouteById(routeId, isAdmin ? null : req.user!.userId);
    if (!route) return res.status(404).json({ message: 'Route not found' });
    res.json(route);
  } catch (error) {
    console.error('Get route error:', error);
    res.status(500).json({ message: 'Could not load route' });
  }
});

flyerRoutesRouter.put('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });

    const route = await updateRoute(routeId, {
      routeName: req.body?.routeName,
      routeDate: req.body?.routeDate ?? null,
      distributorUserId: req.body?.distributorUserId != null ? Number(req.body.distributorUserId) : undefined,
      marketId: req.body?.marketId != null ? Number(req.body.marketId) : undefined,
      startType: req.body?.startType,
      startAddress: req.body?.startAddress ?? null,
      startLatitude: req.body?.startLatitude != null ? Number(req.body.startLatitude) : null,
      startLongitude: req.body?.startLongitude != null ? Number(req.body.startLongitude) : null,
    });
    if (!route) return res.status(404).json({ message: 'Route not found' });
    res.json(route);
  } catch (error) {
    console.error('Update route error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not update route' });
  }
});

flyerRoutesRouter.post('/:id/stops', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    const campaignTargetIds = Array.isArray(req.body?.campaignTargetIds)
      ? req.body.campaignTargetIds.map(Number).filter(Number.isFinite)
      : [];
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });
    if (!campaignTargetIds.length) return res.status(400).json({ message: 'campaignTargetIds array is required' });

    const result = await addStopsToRoute(routeId, campaignTargetIds, {
      allowEarlyAssignment: Boolean(req.body?.allowEarlyAssignment),
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Add route stops error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not add stops' });
  }
});

flyerRoutesRouter.put('/:id/stops/reorder', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    const stopIds = Array.isArray(req.body?.stopIds) ? req.body.stopIds.map(Number).filter(Number.isFinite) : [];
    if (!Number.isFinite(routeId) || !stopIds.length) {
      return res.status(400).json({ message: 'route id and stopIds array are required' });
    }
    const route = await reorderRouteStops(routeId, stopIds);
    res.json(route);
  } catch (error) {
    console.error('Reorder route stops error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not reorder stops' });
  }
});

flyerRoutesRouter.post('/:id/stops/sort-nearest', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });
    const route = await sortRouteStopsByNearest(routeId);
    res.json(route);
  } catch (error) {
    console.error('Sort nearest route stops error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not sort stops' });
  }
});

flyerRoutesRouter.delete('/:id/stops/:stopId', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    const stopId = Number(req.params.stopId);
    if (!Number.isFinite(routeId) || !Number.isFinite(stopId)) {
      return res.status(400).json({ message: 'Invalid route or stop id' });
    }
    const route = await removeRouteStop(routeId, stopId);
    res.json(route);
  } catch (error) {
    console.error('Remove route stop error:', error);
    res.status(500).json({ message: 'Could not remove stop' });
  }
});

flyerRoutesRouter.post('/:id/assign', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });
    const route = await assignRoute(routeId, req.body?.distributorUserId ? Number(req.body.distributorUserId) : null);
    res.json(route);
  } catch (error) {
    console.error('Assign route error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not assign route' });
  }
});

flyerRoutesRouter.post('/:id/cancel', requireAdminOrManager, async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });
    const route = await cancelRoute(routeId);
    if (!route) return res.status(404).json({ message: 'Route not found' });
    res.json(route);
  } catch (error) {
    console.error('Cancel route error:', error);
    res.status(500).json({ message: 'Could not cancel route' });
  }
});

flyerRoutesRouter.post('/:id/stops/:stopId/complete', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    const stopId = Number(req.params.stopId);
    if (!Number.isFinite(routeId) || !Number.isFinite(stopId)) {
      return res.status(400).json({ message: 'Invalid route or stop id' });
    }
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    if (isAdmin) {
      const route = await completeRouteStop(
        routeId,
        stopId,
        {
          notes: req.body?.notes ?? null,
          skippedReason: req.body?.skippedReason ?? null,
          status: req.body?.status || 'completed',
        },
        null,
      );
      return res.json(route);
    }
    const result = await completeRouteStopWorkflow(stopId, req.user!.userId, req.body?.notes ?? null);
    res.json(result);
  } catch (error) {
    console.error('Complete route stop error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not complete stop' });
  }
});

flyerRoutesRouter.get('/:id/map-data', async (req, res) => {
  try {
    const routeId = Number(req.params.id);
    if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid route id' });
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const route = await getRouteById(routeId, isAdmin ? null : req.user!.userId);
    if (!route) return res.status(404).json({ message: 'Route not found' });
    res.json(route.mapData);
  } catch (error) {
    console.error('Route map data error:', error);
    res.status(500).json({ message: 'Could not load map data' });
  }
});
