import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AppRole } from '../services/userProfile.js';

export type JwtPayload = {
  userId: number;
  userCode?: string;
  fullName?: string;
  email?: string;
  role?: AppRole;
};

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
