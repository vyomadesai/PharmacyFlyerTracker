import { Router } from 'express';
import bcrypt from 'bcrypt';
import CryptoJS from 'crypto-js';
import { getPool, sql } from '../../config/db.js';
import { env } from '../../config/env.js';
import { getUserProfile, profileToResponse } from '../../services/userProfile.js';
import { signToken, verifyToken } from '../../utils/jwt.js';

export const authRoutes = Router();

function normalizeLogin(value: unknown) {
  return String(value || '').trim();
}

function normalizePassword(value: unknown) {
  return String(value || '').trim();
}

async function verifyPassword(storedPassword: string, enteredPassword: string) {
  if (!storedPassword || !enteredPassword) {
    return false;
  }

  if (String(storedPassword).startsWith('$2')) {
    return bcrypt.compare(enteredPassword, storedPassword);
  }

  try {
    const envLegacyKey = String(env.loginLegacyAesKey || '').trim();
    const keysToTry = [envLegacyKey].filter(Boolean);
    for (const key of keysToTry) {
      const bytes = CryptoJS.AES.decrypt(storedPassword, key);
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
      if (decryptedStr) {
        let expectedPassword: unknown = decryptedStr;
        try {
          expectedPassword = JSON.parse(decryptedStr);
        } catch {
          // Some legacy rows decrypt to plain text instead of JSON stringified value.
        }
        if (String(expectedPassword).trim() === String(enteredPassword).trim()) {
          return true;
        }
      }
    }
  } catch {
    // Legacy encrypted value parse failure; fallback checks below.
  }

  return String(storedPassword).trim() === String(enteredPassword).trim();
}

authRoutes.post('/login', async (req, res) => {
  try {
    const emailOrMobile = normalizeLogin(
      req.body?.emailOrMobile
        ?? req.body?.login
        ?? req.body?.username
        ?? req.body?.userId
        ?? req.body?.User_Id
        ?? req.body?.USER_ID
    );
    const password = normalizePassword(
      req.body?.password ?? req.body?.User_Password ?? req.body?.USER_PASSWORD
    );

    console.log('LOGIN ATTEMPT:', { emailOrMobile });

    if (!emailOrMobile || !password) {
      return res.status(400).json({ message: 'Email/User ID/mobile and password are required' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('login', sql.NVarChar, emailOrMobile)
      .query(`
        SELECT TOP 1
          ID,
          User_Id,
          User_FirstName,
          User_LastName,
          User_Email,
          User_Phone,
          User_Password,
          User_IsActive
        FROM dbo.Master_User
        WHERE ISNULL(User_IsActive, 0) = 1
        AND (
          LOWER(LTRIM(RTRIM(ISNULL(User_Email, '')))) = LOWER(@login)
          OR LOWER(LTRIM(RTRIM(ISNULL(User_Id, '')))) = LOWER(@login)
          OR LTRIM(RTRIM(ISNULL(User_Phone, ''))) = @login
        )
      `);

    const user = result.recordset[0];
    if (!user) {
      console.warn('LOGIN FAILED: no active Master_User found for login:', emailOrMobile);
      return res.status(401).json({ message: 'Invalid login or inactive user' });
    }

    const isValidPassword = await verifyPassword(String(user.User_Password || ''), password);

    if (!isValidPassword) {
      console.warn('LOGIN FAILED: password mismatch for user:', user.User_Id || user.User_Email || user.ID);
      return res.status(401).json({ message: 'Invalid login' });
    }

    const fullName = `${user.User_FirstName || ''} ${user.User_LastName || ''}`.trim();
    const profile = await getUserProfile(Number(user.ID));

    const responseUser = {
      userId: user.ID,
      userCode: user.User_Id,
      firstName: user.User_FirstName,
      lastName: user.User_LastName,
      fullName,
      email: user.User_Email,
      phone: user.User_Phone,
      ...(profile ? profileToResponse(profile) : {}),
    };

    const token = signToken({
      userId: user.ID,
      userCode: user.User_Id,
      fullName,
      email: user.User_Email,
      role: profile?.role,
    });

    return res.json({
      token,
      user: responseUser,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed' });
  }
});

authRoutes.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    const payload = verifyToken(token);
    return res.json({ userId: payload.userId, role: payload.role });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});
