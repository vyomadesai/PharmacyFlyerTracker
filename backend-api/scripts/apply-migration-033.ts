import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../src/config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationPath = path.resolve(here, '../../database/033_npi_registry_geocode.sql');
  const pool = await getPool();
  const sqlText = fs.readFileSync(migrationPath, 'utf8');
  const batches = sqlText.split(/\r?\nGO\r?\n/i).filter((b) => b.trim());
  for (const batch of batches) {
    await pool.request().query(batch);
  }
  console.log('Applied', migrationPath);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
