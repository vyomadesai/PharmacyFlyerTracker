import { NextFunction, Request, Response } from 'express';
import { AppRole } from '../services/userProfile.js';

export function requireRole(roles: AppRole[]) {
  const allowed = new Set(roles);

  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) {
      return res.status(403).json({ message: 'User role not found. Contact an administrator.' });
    }
    if (!allowed.has(role)) {
      return res.status(403).json({
        message: 'You do not have permission to access this resource.',
        requiredRoles: roles,
        currentRole: role,
      });
    }
    return next();
  };
}

export const requireAdmin = requireRole(['admin']);
export const requireAdminOrManager = requireRole(['admin', 'manager']);
export const requireDistributor = requireRole(['distributor']);
export const requireFieldUser = requireRole(['distributor']);
export const requireAnyAuthenticatedRole = requireRole(['admin', 'manager', 'distributor']);
