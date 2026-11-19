import sql from 'mssql';
import { env } from './env.js';

let pool: any | null = null;

export async function getPool() {
  if (pool?.connected) return pool;

  pool = await sql.connect({
    user: env.db.user,
    password: env.db.password,
    server: env.db.server,
    database: env.db.database,
    port: env.db.port,
    options: {
      encrypt: env.db.encrypt,
      trustServerCertificate: env.db.trustServerCertificate
    },
    requestTimeout: 120000,
    connectionTimeout: 15000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  });

  return pool;
}

export { sql };
