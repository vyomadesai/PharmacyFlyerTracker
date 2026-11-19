import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager } from '../../middleware/role.middleware.js';
import {
  APPROVAL_STATUSES,
  approveCampaignTarget,
  bulkApproveCampaignTargets,
  bulkRejectCampaignTargets,
  generateSuggestedTargets,
  listAssignableTargets,
  listCampaignTargets,
  rejectCampaignTarget,
  resetTargetVisitSchedule,
  saveDoctorTargets,
  updateCampaignTargetNotes,
} from '../../services/campaignTargets.js';
import { VISIT_DUE_FILTERS } from '../../utils/visitFrequency.js';

export const campaignTargetsRoutes = Router();
campaignTargetsRoutes.use(requireAuth);

function parseTargetIds(body: Record<string, unknown>) {
  const ids = Array.isArray(body.targetIds)
    ? body.targetIds.map(Number).filter(Number.isFinite)
    : body.campaignTargetId
      ? [Number(body.campaignTargetId)].filter(Number.isFinite)
      : [];
  return ids as number[];
}

campaignTargetsRoutes.get('/meta/statuses', requireAdminOrManager, (_req, res) => {
  res.json({ approvalStatuses: APPROVAL_STATUSES, visitDueFilters: VISIT_DUE_FILTERS });
});

campaignTargetsRoutes.get('/assignable', requireAdminOrManager, async (req, res) => {
  try {
    const targets = await listAssignableTargets({
      campaignId: req.query.campaignId ? Number(req.query.campaignId) : null,
      campaignConfigId: req.query.campaignConfigId ? Number(req.query.campaignConfigId) : null,
      targetType: req.query.targetType ? String(req.query.targetType) : null,
      visitDueFilter: req.query.visitDueFilter ? String(req.query.visitDueFilter) : null,
      prioritizeDue: String(req.query.prioritizeDue || 'true').toLowerCase() !== 'false',
    });
    res.json({ count: targets.length, targets });
  } catch (error) {
    console.error('Assignable campaign targets error:', error);
    res.status(500).json({ message: 'Could not load assignable campaign targets' });
  }
});

campaignTargetsRoutes.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const assignableOnly = String(req.query.assignableOnly || '').toLowerCase() === 'true';
    const targets = assignableOnly
      ? await listAssignableTargets({
          campaignId: req.query.campaignId ? Number(req.query.campaignId) : null,
          campaignConfigId: req.query.campaignConfigId ? Number(req.query.campaignConfigId) : null,
          targetType: req.query.targetType ? String(req.query.targetType) : null,
          visitDueFilter: req.query.visitDueFilter ? String(req.query.visitDueFilter) : null,
        })
      : await listCampaignTargets({
          campaignId: req.query.campaignId ? Number(req.query.campaignId) : null,
          campaignConfigId: req.query.campaignConfigId ? Number(req.query.campaignConfigId) : null,
          approvalStatus: req.query.approvalStatus ? String(req.query.approvalStatus) : null,
          targetType: req.query.targetType ? String(req.query.targetType) : null,
          visitDueFilter: req.query.visitDueFilter ? String(req.query.visitDueFilter) : null,
        });

    res.json({ count: targets.length, targets });
  } catch (error) {
    console.error('Campaign targets list error:', error);
    res.status(500).json({ message: 'Could not load campaign targets' });
  }
});

campaignTargetsRoutes.post('/generate', requireAdminOrManager, async (req, res) => {
  try {
    const campaignConfigId = Number(req.body?.campaignConfigId);
    if (!Number.isFinite(campaignConfigId)) {
      return res.status(400).json({ message: 'campaignConfigId is required' });
    }

    const limit = req.body?.limit ? Number(req.body.limit) : 500;
    const result = await generateSuggestedTargets(
      campaignConfigId,
      req.user?.userId || null,
      Number.isFinite(limit) ? limit : 500,
    );

    res.status(201).json(result);
  } catch (error) {
    console.error('Generate campaign targets error:', error);
    const message = error instanceof Error ? error.message : 'Could not generate suggested targets';
    res.status(error instanceof Error && error.message === 'Campaign config not found' ? 404 : 500).json({ message });
  }
});

campaignTargetsRoutes.post('/doctors', requireAdminOrManager, async (req, res) => {
  try {
    const campaignId = Number(req.body?.campaignId);
    const campaignConfigId = Number(req.body?.campaignConfigId);
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
    console.error('Save doctor campaign targets error:', error);
    const message = error instanceof Error ? error.message : 'Could not save doctor targets';
    res.status(error instanceof Error && error.message === 'Campaign config not found' ? 404 : 500).json({ message });
  }
});

campaignTargetsRoutes.post('/bulk-approve', requireAdminOrManager, async (req, res) => {
  try {
    const targetIds = parseTargetIds(req.body || {});
    if (!targetIds.length) return res.status(400).json({ message: 'targetIds array is required' });

    const targets = await bulkApproveCampaignTargets(
      targetIds,
      req.user?.userId || null,
      req.body?.notes ?? req.body?.approvalNotes ?? null,
    );
    res.json({ updatedCount: targets.length, targets });
  } catch (error) {
    console.error('Bulk approve campaign targets error:', error);
    res.status(500).json({ message: 'Could not bulk approve targets' });
  }
});

campaignTargetsRoutes.post('/bulk-reject', requireAdminOrManager, async (req, res) => {
  try {
    const targetIds = parseTargetIds(req.body || {});
    if (!targetIds.length) return res.status(400).json({ message: 'targetIds array is required' });

    const targets = await bulkRejectCampaignTargets(
      targetIds,
      req.user?.userId || null,
      req.body?.notes ?? req.body?.approvalNotes ?? null,
    );
    res.json({ updatedCount: targets.length, targets });
  } catch (error) {
    console.error('Bulk reject campaign targets error:', error);
    res.status(500).json({ message: 'Could not bulk reject targets' });
  }
});

campaignTargetsRoutes.post('/:id/approve', requireAdminOrManager, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'Invalid target id' });

    const target = await approveCampaignTarget(
      targetId,
      req.user?.userId || null,
      req.body?.notes ?? req.body?.approvalNotes ?? null,
    );
    if (!target) return res.status(404).json({ message: 'Target not found or cannot be approved' });
    res.json(target);
  } catch (error) {
    console.error('Approve campaign target error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not approve target' });
  }
});

campaignTargetsRoutes.post('/:id/reject', requireAdminOrManager, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'Invalid target id' });

    const target = await rejectCampaignTarget(
      targetId,
      req.user?.userId || null,
      req.body?.notes ?? req.body?.approvalNotes ?? null,
    );
    if (!target) return res.status(404).json({ message: 'Target not found or cannot be rejected' });
    res.json(target);
  } catch (error) {
    console.error('Reject campaign target error:', error);
    res.status(500).json({ message: 'Could not reject target' });
  }
});

campaignTargetsRoutes.patch('/:id/notes', requireAdminOrManager, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'Invalid target id' });

    const target = await updateCampaignTargetNotes(
      targetId,
      req.body?.notes ?? req.body?.approvalNotes ?? null,
    );
    if (!target) return res.status(404).json({ message: 'Target not found' });
    res.json(target);
  } catch (error) {
    console.error('Update campaign target notes error:', error);
    res.status(500).json({ message: 'Could not update target notes' });
  }
});

campaignTargetsRoutes.post('/:id/reset-visit', requireAdminOrManager, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: 'Invalid target id' });
    const target = await resetTargetVisitSchedule(targetId);
    if (!target) return res.status(404).json({ message: 'Target not found' });
    res.json(target);
  } catch (error) {
    console.error('Reset target visit schedule error:', error);
    res.status(500).json({ message: 'Could not reset visit schedule' });
  }
});

campaignTargetsRoutes.delete('/:id', requireAdmin, async (req, res) => {
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

    if (!result.recordset[0]) {
      return res.status(404).json({ message: 'Target not found or cannot be deleted once approved/assigned' });
    }
    res.json({ campaignTargetId: result.recordset[0].CampaignTargetId, message: 'Target removed' });
  } catch (error) {
    console.error('Delete campaign target error:', error);
    res.status(500).json({ message: 'Could not delete campaign target' });
  }
});
