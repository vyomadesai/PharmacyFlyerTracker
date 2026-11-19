export type AppRole = 'admin' | 'manager' | 'distributor';

export type AuthUser = {
  userId: number;
  userCode?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  role: AppRole;
  employmentType?: 'part_time' | 'full_time' | null;
  defaultDailyFlyerCapacity?: number;
};

export function isDistributor(role?: string | null) {
  return role === 'distributor';
}

export function isAdminOrManager(role?: string | null) {
  return role === 'admin' || role === 'manager';
}

export function getUserDisplayName(user?: Partial<AuthUser> | null) {
  if (!user) return 'User';

  const fullName = String(user.fullName || '').trim();
  if (fullName) return fullName;

  const firstLast = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (firstLast) return firstLast;

  return String(user.userCode || user.email || user.phone || 'User');
}
