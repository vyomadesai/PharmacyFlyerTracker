import dotenv from 'dotenv';
dotenv.config();

// How close (in miles) a rep's GPS must be to a stop for the server to accept a
// check-in. Override with CHECK_IN_RADIUS_MILES; falls back to 25 when unset or
// invalid. Keep this in sync with the mobile app's EXPO_PUBLIC_CHECK_IN_RADIUS_MILES.
const parsedCheckInRadius = Number(process.env.CHECK_IN_RADIUS_MILES);
const checkInRadiusMiles =
  Number.isFinite(parsedCheckInRadius) && parsedCheckInRadius > 0 ? parsedCheckInRadius : 0.1;

export const env = {
  port: Number(process.env.PORT || 4001),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  loginLegacyAesKey: process.env.LOGIN_LEGACY_AES_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  checkInRadiusMiles,
  db: {
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || '',
    port: Number(process.env.DB_PORT || 1433),
    encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() === 'true'
  }
};
