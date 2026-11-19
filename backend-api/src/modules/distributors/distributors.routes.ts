import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager, requireDistributor } from '../../middleware/role.middleware.js';
import {
  listDistributors,
  searchUsersForDistributor,
  upsertUserProfile,
  getUserProfile,
  profileToResponse,
} from '../../services/userProfile.js';
import { getPool, sql } from '../../config/db.js';

export const distributorsRoutes = Router();
distributorsRoutes.use(requireAuth);

distributorsRoutes.get('/me/profile', requireDistributor, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user!.userId);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });
    res.json(profileToResponse(profile));
  } catch (error) {
    console.error('Distributor profile error:', error);
    res.status(500).json({ message: 'Could not load profile' });
  }
});

distributorsRoutes.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const distributors = await listDistributors(includeInactive);
    res.json(distributors);
  } catch (error) {
    console.error('List distributors error:', error);
    res.status(500).json({ message: 'Could not load distributors' });
  }
});

distributorsRoutes.get('/search-users', requireAdminOrManager, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const users = await searchUsersForDistributor(q);
    res.json(users);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Could not search users' });
  }
});

distributorsRoutes.get('/:userId', requireAdminOrManager, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('UserId', sql.Int, userId)
      .query(`
        SELECT TOP 1 u.ID, u.User_Id, u.User_FirstName, u.User_LastName, u.User_Email, u.User_Phone,
          p.UserProfileId, p.Role, p.EmploymentType, p.HomeAddress, p.HomeLatitude, p.HomeLongitude,
          p.DefaultDailyFlyerCapacity, p.IsActive
        FROM dbo.Master_User u
        LEFT JOIN dbo.PharmacyFlyer_UserProfile p ON p.UserId = u.ID
        WHERE u.ID = @UserId
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'User not found' });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Get distributor error:', error);
    res.status(500).json({ message: 'Could not load distributor' });
  }
});

distributorsRoutes.put('/:userId', requireAdminOrManager, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' });

    const profile = await upsertUserProfile({
      userId,
      role: req.body?.role || 'distributor',
      employmentType: req.body?.employmentType ?? req.body?.employment_type ?? null,
      homeAddress: req.body?.homeAddress ?? req.body?.home_address ?? null,
      homeLatitude: req.body?.homeLatitude != null ? Number(req.body.homeLatitude) : null,
      homeLongitude: req.body?.homeLongitude != null ? Number(req.body.homeLongitude) : null,
      defaultDailyFlyerCapacity: req.body?.defaultDailyFlyerCapacity != null
        ? Number(req.body.defaultDailyFlyerCapacity)
        : undefined,
      isActive: req.body?.isActive != null ? Boolean(req.body.isActive) : undefined,
    });

    if (!profile) return res.status(500).json({ message: 'Could not save profile' });
    res.json(profileToResponse(profile));
  } catch (error) {
    console.error('Update distributor error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not update distributor' });
  }
});

distributorsRoutes.post('/:userId/mark-distributor', requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' });

    const profile = await upsertUserProfile({
      userId,
      role: 'distributor',
      employmentType: req.body?.employmentType || 'full_time',
      defaultDailyFlyerCapacity: req.body?.defaultDailyFlyerCapacity != null
        ? Number(req.body.defaultDailyFlyerCapacity)
        : 25,
      isActive: true,
    });

    res.json(profileToResponse(profile!));
  } catch (error) {
    console.error('Mark distributor error:', error);
    res.status(400).json({ message: error instanceof Error ? error.message : 'Could not mark user as distributor' });
  }
});
