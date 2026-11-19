// Driving-time matrix between locations.
// Primary: public OSRM /table (real road durations), tiled to respect the
// 100-coordinate cap. Fallback: offline great-circle estimate. Cached as JSON.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function offlineMatrix(coords, avgSpeedKmh, detourFactor) {
  const n = coords.length;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = haversineKm(coords[i], coords[j]) * detourFactor;
      M[i][j] = (km / avgSpeedKmh) * 3600;
    }
  }
  return M;
}

function cacheKey(coords, engine, extra = "") {
  const h = crypto.createHash("sha1");
  h.update(engine + "|" + extra + "|");
  for (const [lat, lon] of coords) h.update(`${lat.toFixed(6)},${lon.toFixed(6)};`);
  return h.digest("hex").slice(0, 16);
}

async function getJSON(url, { timeoutMs = 30000, retries = 3 } = {}) {
  let last;
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

export async function osrmMatrix(coords, { baseUrl, block = 45, sleepMs = 1000 } = {}) {
  const n = coords.length;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const blocks = [];
  for (let i = 0; i < n; i += block) {
    blocks.push(Array.from({ length: Math.min(block, n - i) }, (_, k) => i + k));
  }
  const total = blocks.length * blocks.length;
  let done = 0;
  for (const rb of blocks) {
    for (const cb of blocks) {
      const same = rb === cb;
      const idxs = same ? rb : rb.concat(cb);
      const coordStr = idxs.map((k) => `${coords[k][1]},${coords[k][0]}`).join(";");
      const src = rb.map((_, a) => a);
      const dst = same ? src : cb.map((_, b) => rb.length + b);
      const url =
        `${baseUrl}/table/v1/driving/${coordStr}` +
        `?sources=${src.join(";")}&destinations=${dst.join(";")}&annotations=duration`;
      const data = await getJSON(url);
      if (data.code !== "Ok") throw new Error(`OSRM error: ${data.code} ${data.message || ""}`);
      const dur = data.durations;
      for (let a = 0; a < rb.length; a++) {
        for (let b = 0; b < cb.length; b++) {
          const v = dur[a][b];
          M[rb[a]][cb[b]] = v == null ? 0 : v;
        }
      }
      done++;
      process.stdout.write(`\r[travel] OSRM tile ${done}/${total}`);
      await sleep(sleepMs);
    }
  }
  process.stdout.write("\n");
  return M;
}

export async function buildTravelMatrix(coords, opts = {}) {
  const {
    engine = "osrm",
    avgSpeedKmh = 48.0,
    detourFactor = 1.3,
    osrmUrl = "https://router.project-osrm.org",
    cacheDir = "cache",
  } = opts;
  fs.mkdirSync(cacheDir, { recursive: true });
  const extra = engine === "offline" ? `${avgSpeedKmh}-${detourFactor}` : "";
  const key = cacheKey(coords, engine, extra);
  const cacheFile = path.join(cacheDir, `matrix_${engine}_${key}.json`);
  if (fs.existsSync(cacheFile)) {
    return { matrix: JSON.parse(fs.readFileSync(cacheFile, "utf8")), engine };
  }

  if (engine === "offline") {
    const M = offlineMatrix(coords, avgSpeedKmh, detourFactor);
    fs.writeFileSync(cacheFile, JSON.stringify(M));
    return { matrix: M, engine: "offline" };
  }

  try {
    const M = await osrmMatrix(coords, { baseUrl: osrmUrl });
    fs.writeFileSync(cacheFile, JSON.stringify(M));
    return { matrix: M, engine: "osrm" };
  } catch (e) {
    console.log(`[travel] OSRM unavailable (${e.message}); falling back to offline estimate.`);
    const M = offlineMatrix(coords, avgSpeedKmh, detourFactor);
    const offKey = cacheKey(coords, "offline", `${avgSpeedKmh}-${detourFactor}`);
    fs.writeFileSync(path.join(cacheDir, `matrix_offline_${offKey}.json`), JSON.stringify(M));
    return { matrix: M, engine: "offline (osrm fallback)" };
  }
}
