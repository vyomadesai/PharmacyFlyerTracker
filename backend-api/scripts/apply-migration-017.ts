import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../src/config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../../database/017_route_planner_campaign_specialty.sql');

async function main() {
  const pool = await getPool();
  const sqlText = fs.readFileSync(migrationPath, 'utf8');
  const batches = sqlText.split(/\r?\nGO\r?\n/i).filter((b) => b.trim());
  for (const batch of batches) {
    await pool.request().query(batch);
  }
  console.log('Applied', migrationPath);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
