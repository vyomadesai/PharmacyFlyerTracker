import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdminOrManager, requireDistributor } from '../../middleware/role.middleware.js';
import {
  assignDistributorInventory,
  checkAssignmentCapacity,
  getMyFlyersSummary,
  listDistributorInventory,
  updateDeliveredQuantity,
} from '../../services/distributorInventory.js';

export const distributorInventoryRoutes = Router();
distributorInventoryRoutes.use(requireAuth);

distributorInventoryRoutes.get('/my-flyers', requireDistributor, async (req, res) => {
  try {
    const summary = await getMyFlyersSummary(req.user!.userId);
    res.json(summary);
  } catch (error) {
    console.error('My flyers error:', error);
    res.status(500).json({ message: 'Could not load assigned flyers' });
  }
});

distributorInventoryRoutes.get('/capacity-check', requireAdminOrManager, async (req, res) => {
  try {
    const distributorUserId = Number(req.query.distributorUserId);
    const quantity = Number(req.query.quantity || req.query.assignedQuantity || 0);
    if (!Number.isFinite(distributorUserId) || !Number.isFinite(quantity)) {
      return res.status(400).json({ message: 'distributorUserId and quantity are required' });
    }
    const result = await checkAssignmentCapacity(distributorUserId, quantity);
    res.json(result);
  } catch (error) {
    console.error('Capacity check error:', error);
    res.status(500).json({ message: 'Could not check capacity' });
  }
});

distributorInventoryRoutes.get('/', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const distributorUserId = isAdmin
      ? (req.query.distributorUserId ? Number(req.query.distributorUserId) : null)
      : req.user!.userId;

    if (!isAdmin && req.user?.role !== 'distributor') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const rows = await listDistributorInventory({
      distributorUserId,
      assignmentDate: req.query.assignmentDate ? String(req.query.assignmentDate) : null,
      status: req.query.status ? String(req.query.status) : null,
    });
    res.json(rows);
  } catch (error) {
    console.error('List distributor inventory error:', error);
    res.status(500).json({ message: 'Could not load inventory' });
  }
});

distributorInventoryRoutes.post('/', requireAdminOrManager, async (req, res) => {
  try {
    const distributorUserId = Number(req.body?.distributorUserId);
    const campaignId = Number(req.body?.campaignId);
    const assignedQuantity = Number(req.body?.assignedQuantity ?? 25);

    if (!Number.isFinite(distributorUserId)) return res.status(400).json({ message: 'distributorUserId is required' });
    if (!Number.isFinite(campaignId)) return res.status(400).json({ message: 'campaignId is required' });

    const campaignTargetIds = Array.isArray(req.body?.campaignTargetIds)
      ? req.body.campaignTargetIds.map(Number).filter(Number.isFinite)
      : [];

    try {
      const result = await assignDistributorInventory({
        distributorUserId,
        campaignId,
        flyerName: req.body?.flyerName ?? null,
        assignedQuantity,
        marketId: req.body?.marketId ? Number(req.body.marketId) : null,
        campaignTargetIds,
        batchName: req.body?.batchName ?? null,
        force: Boolean(req.body?.force),
      });
      res.status(201).json(result);
    } catch (err) {
      const capacityCheck = (err as Error & { capacityCheck?: unknown }).capacityCheck;
      if (capacityCheck) {
        return res.status(409).json({
          message: err instanceof Error ? err.message : 'Capacity exceeded',
          capacityCheck,
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('Assign distributor inventory error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not assign inventory' });
  }
});

distributorInventoryRoutes.patch('/:id/delivered', async (req, res) => {
  try {
    const inventoryId = Number(req.params.id);
    const deliveredQuantity = Number(req.body?.deliveredQuantity);
    if (!Number.isFinite(inventoryId) || !Number.isFinite(deliveredQuantity)) {
      return res.status(400).json({ message: 'Invalid inventory id or deliveredQuantity' });
    }

    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'manager';
    const distributorUserId = isAdmin ? null : req.user!.userId;

    const row = await updateDeliveredQuantity(inventoryId, deliveredQuantity, distributorUserId);
    if (!row) return res.status(404).json({ message: 'Inventory not found' });
    res.json(row);
  } catch (error) {
    console.error('Update delivered quantity error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not update delivered quantity' });
  }
});
