// Driving-time matrix between locations.
//
// Ported from data_processing_node/src/travel.js (logic unchanged).
// Primary: public OSRM /table (real road durations), tiled to respect the
// 100-coordinate cap. Fallback: offline great-circle estimate. Cached as JSON.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Coord = [number, number];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Shared with data_processing_node so matrices are reused across both tools.
export const DEFAULT_CACHE_DIR =
  process.env.ROUTE_OPT_CACHE_DIR ||
  path.resolve(HERE, '../../../../data_processing_node/cache');

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function offlineMatrix(coords: Coord[], avgSpeedKmh: number, detourFactor: number): number[][] {
  const n = coords.length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = haversineKm(coords[i], coords[j]) * detourFactor;
      M[i][j] = (km / avgSpeedKmh) * 3600;
    }
  }
  return M;
}

function cacheKey(coords: Coord[], engine: string, extra = ''): string {
  const h = crypto.createHash('sha1');
  h.update(engine + '|' + extra + '|');
  for (const [lat, lon] of coords) h.update(`${lat.toFixed(6)},${lon.toFixed(6)};`);
  return h.digest('hex').slice(0, 16);
}

async function getJSON(url: string, { timeoutMs = 30000, retries = 3 } = {}): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await sleep(2000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`OSRM request failed after ${retries} tries: ${last}`);
}

const MILES_PER_METER = 1 / 1609.344;

/** Single origin-to-destination driving distance via OSRM (matches Google Maps closely). */
export async function osrmDrivingDistanceMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  osrmUrl = 'https://router.project-osrm.org',
): Promise<number | null> {
  const url =
    `${osrmUrl}/route/v1/driving/` +
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false`;
  try {
    const data = await getJSON(url, { timeoutMs: 15000, retries: 2 });
    if (data.code !== 'Ok' || !data.routes?.[0]?.distance) return null;
    return Math.round(data.routes[0].distance * MILES_PER_METER * 100) / 100;
  } catch {
    return null;
  }
}

/** Driving distances from one origin to many destinations (one OSRM table call). */
export async function osrmDrivingDistancesFromOrigin(
  origin: { latitude: number; longitude: number },
  destinations: Array<{ latitude: number; longitude: number }>,
  osrmUrl = 'https://router.project-osrm.org',
): Promise<Array<number | null>> {
  if (!destinations.length) return [];
  if (destinations.length === 1) {
    return [await osrmDrivingDistanceMiles(origin, destinations[0], osrmUrl)];
  }

  const coordStr = [
    `${origin.longitude},${origin.latitude}`,
    ...destinations.map((d) => `${d.longitude},${d.latitude}`),
  ].join(';');
  const dst = destinations.map((_, index) => index + 1).join(';');
  const url =
    `${osrmUrl}/table/v1/driving/${coordStr}` +
    `?sources=0&destinations=${dst}&annotations=distance`;

  try {
    const data = await getJSON(url, { timeoutMs: 20000, retries: 2 });
    if (data.code !== 'Ok' || !Array.isArray(data.distances?.[0])) {
      return destinations.map(() => null);
    }
    return data.distances[0].map((meters: number | null) =>
      meters == null ? null : Math.round(meters * MILES_PER_METER * 100) / 100,
    );
  } catch {
    return destinations.map(() => null);
  }
}

export async function osrmMatrix(
  coords: Coord[],
  { baseUrl, block = 45, sleepMs = 1000, onProgress }:
    { baseUrl: string; block?: number; sleepMs?: number; onProgress?: (done: number, total: number) => void }
): Promise<number[][]> {
  const n = coords.length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const blocks: number[][] = [];
  for (let i = 0; i < n; i += block) {
    blocks.push(Array.from({ length: Math.min(block, n - i) }, (_, k) => i + k));
  }
  const total = blocks.length * blocks.length;
  let done = 0;
  if (onProgress) onProgress(0, total);
  for (const rb of blocks) {
    for (const cb of blocks) {
      const same = rb === cb;
      const idxs = same ? rb : rb.concat(cb);
      const coordStr = idxs.map((k) => `${coords[k][1]},${coords[k][0]}`).join(';');
      const src = rb.map((_, a) => a);
      const dst = same ? src : cb.map((_, b) => rb.length + b);
      const url =
        `${baseUrl}/table/v1/driving/${coordStr}` +
        `?sources=${src.join(';')}&destinations=${dst.join(';')}&annotations=duration`;
      const data = await getJSON(url);
      if (data.code !== 'Ok') throw new Error(`OSRM error: ${data.code} ${data.message || ''}`);
      const dur = data.durations;
      for (let a = 0; a < rb.length; a++) {
        for (let b = 0; b < cb.length; b++) {
          const v = dur[a][b];
          M[rb[a]][cb[b]] = v == null ? 0 : v;
        }
      }
      done++;
      if (onProgress) onProgress(done, total);
      process.stdout.write(`\r[travel] OSRM tile ${done}/${total}`);
      await sleep(sleepMs);
    }
  }
  process.stdout.write('\n');
  return M;
}

export type TravelOptions = {
  engine?: 'osrm' | 'offline';
  avgSpeedKmh?: number;
  detourFactor?: number;
  osrmUrl?: string;
  cacheDir?: string;
  // Reports OSRM tile progress (done, total). Only fires when a matrix is
  // actually built from OSRM — cache hits and the offline engine are instant.
  onProgress?: (done: number, total: number) => void;
};

export async function buildTravelMatrix(
  coords: Coord[],
  opts: TravelOptions = {}
): Promise<{ matrix: number[][]; engine: string }> {
  const {
    engine = 'osrm',
    avgSpeedKmh = 48.0,
    detourFactor = 1.3,
    osrmUrl = 'https://router.project-osrm.org',
    cacheDir = DEFAULT_CACHE_DIR,
    onProgress
  } = opts;
  fs.mkdirSync(cacheDir, { recursive: true });
  const extra = engine === 'offline' ? `${avgSpeedKmh}-${detourFactor}` : '';

  // Cache by the *set* of locations, not the order they arrive in. We sort the
  // coordinates into a canonical order for the cache key, build/store the matrix
  // in that order, then permute it back to the caller's order. This means the
  // same group of doctors reuses the cached OSRM matrix even when the upstream
  // step (e.g. multi-campaign merge) hands them over in a different order.
  const order = coords.map((_, i) => i).sort((a, b) => {
    const ca = coords[a], cb = coords[b];
    return ca[0] - cb[0] || ca[1] - cb[1];
  });
  const sortedCoords = order.map((i) => coords[i]);
  // pos[originalIndex] = its slot in the sorted/canonical matrix.
  const pos = new Array<number>(coords.length);
  order.forEach((origIdx, sortedIdx) => { pos[origIdx] = sortedIdx; });
  const restore = (sorted: number[][]): number[][] =>
    coords.map((_, i) => coords.map((__, j) => sorted[pos[i]][pos[j]]));

  const key = cacheKey(sortedCoords, engine, extra);
  const cacheFile = path.join(cacheDir, `matrix_${engine}_${key}.json`);
  if (fs.existsSync(cacheFile)) {
    const sorted = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return { matrix: restore(sorted), engine };
  }

  if (engine === 'offline') {
    const sorted = offlineMatrix(sortedCoords, avgSpeedKmh, detourFactor);
    fs.writeFileSync(cacheFile, JSON.stringify(sorted));
    return { matrix: restore(sorted), engine: 'offline' };
  }

  try {
    const sorted = await osrmMatrix(sortedCoords, { baseUrl: osrmUrl, onProgress });
    fs.writeFileSync(cacheFile, JSON.stringify(sorted));
    return { matrix: restore(sorted), engine: 'osrm' };
  } catch (e: any) {
    console.log(`[travel] OSRM unavailable (${e.message}); falling back to offline estimate.`);
    const sorted = offlineMatrix(sortedCoords, avgSpeedKmh, detourFactor);
    const offKey = cacheKey(sortedCoords, 'offline', `${avgSpeedKmh}-${detourFactor}`);
    fs.writeFileSync(path.join(cacheDir, `matrix_offline_${offKey}.json`), JSON.stringify(sorted));
    return { matrix: restore(sorted), engine: 'offline (osrm fallback)' };
  }
}
