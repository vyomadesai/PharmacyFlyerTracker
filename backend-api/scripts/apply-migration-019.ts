import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../src/config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function applyMigration(fileName: string) {
  const migrationPath = path.resolve(here, '../../database', fileName);
  const pool = await getPool();
  const sqlText = fs.readFileSync(migrationPath, 'utf8');
  const batches = sqlText.split(/\r?\nGO\r?\n/i).filter((b) => b.trim());
  for (const batch of batches) {
    await pool.request().query(batch);
  }
  console.log('Applied', migrationPath);
}

async function main() {
  await applyMigration('019_campaign_frequency_in_days.sql');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
