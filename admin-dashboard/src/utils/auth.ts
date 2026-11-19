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

export function isAdminOrManager(role?: string | null) {
  return role === 'admin' || role === 'manager';
}

export function isDistributor(role?: string | null) {
  return role === 'distributor';
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function clearStoredAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
