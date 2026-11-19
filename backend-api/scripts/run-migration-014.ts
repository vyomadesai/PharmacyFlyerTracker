import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../src/config/db.js';

const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../database/014_route_stop_workflow.sql'), 'utf8');
const batches = script.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
const pool = await getPool();
for (const batch of batches) await pool.request().query(batch);
console.log('Applied 014_route_stop_workflow.sql');
process.exit(0);
