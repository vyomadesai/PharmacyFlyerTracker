// Geocode street addresses to {lat, lon} via OpenStreetMap / Nominatim.
// Mirrors the Python version: address normalization, multi-attempt lookup,
// ZIP-centroid fallback, and an on-disk JSON cache (same file format as Python,
// so the two implementations can share cache/geocode_cache.json).

import fs from "node:fs";
import path from "node:path";

const UNRESOLVED = "UNRESOLVED";

const DIRECTION = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NO: "N", SO: "S", EA: "E", WE: "W",
};
const STREET_TYPE = {
  AV: "AVE", AVE: "AVE", AVENUE: "AVE", BLVD: "BLVD", ST: "ST",
  STREET: "ST", DR: "DR", PK: "PARK", PKWY: "PKWY", CT: "CT",
};
const SUITE_RE =
  /[,\s]*(?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*#?\s*\w+\b/gi;
const ZIP_RE = /\b(\d{5})\b/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function buildQuery(street, city, state, zip) {
  const parts = [street, city, state].map((p) => (p || "").trim()).filter(Boolean);
  let q = parts.join(", ");
  if (zip && zip.trim()) q += ` ${zip.trim()}`;
  q += ", USA";
  return q;
}

export function normalizeStreet(street) {
  let s = " " + street.toUpperCase().trim() + " ";
  s = s.replace("DR MLK", "DR MARTIN LUTHER KING");
  s = s.replace(/\bMLK\b/g, "MARTIN LUTHER KING");
  s = s.replace(SUITE_RE, " ");
  s = s.replace(/#/g, " ");
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  const out = tokens.map((t) => DIRECTION[t] || STREET_TYPE[t] || t);
  return out.join(" ").trim();
}

function normalizedQuery(rawQuery) {
  const idx = rawQuery.indexOf(",");
  if (idx === -1) return normalizeStreet(rawQuery);
  return normalizeStreet(rawQuery.slice(0, idx)) + rawQuery.slice(idx);
}

function loadCache(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath) || ".", { recursive: true });
  const tmp = cachePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, cachePath);
}

function needsLookup(cache, q) {
  if (!(q in cache)) return true;
  return cache[q] === null; // old transient failures get retried; UNRESOLVED does not
}

async function nominatim(query, userAgent, timeoutMs = 10000) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" +
    encodeURIComponent(query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, "Accept-Language": "en" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function attempt(query, userAgent, minDelay) {
  for (let i = 0; i < 3; i++) {
    const r = await nominatim(query, userAgent);
    await sleep(minDelay);
    if (r) return r;
  }
  return null;
}

/**
 * Resolve a list of query strings to {lat, lon} | null.
 * @returns {Promise<Map<string,[number,number]|null>>}
 */
export async function geocodeAddresses(queries, opts = {}) {
  const {
    cachePath = "cache/geocode_cache.json",
    userAgent = "routeopt-distribution-planner",
    minDelaySeconds = 1.1,
    useZipFallback = true,
  } = opts;
  const minDelay = minDelaySeconds * 1000;

  const cache = loadCache(cachePath);
  const unique = [...new Set(queries)];
  const todo = unique.filter((q) => needsLookup(cache, q));

  if (todo.length) {
    console.log(
      `[geocode] resolving ${todo.length} addresses (~${(
        (todo.length * minDelaySeconds) /
        60
      ).toFixed(1)} min, cached for reuse)...`
    );
    const zipCache = new Map();
    const zipCentroid = async (zip) => {
      if (zipCache.has(zip)) return zipCache.get(zip);
      const v = await attempt(`${zip}, USA`, userAgent, minDelay);
      zipCache.set(zip, v);
      return v;
    };

    for (let i = 0; i < todo.length; i++) {
      const q = todo[i];
      let result = null;
      for (const cand of [...new Set([normalizedQuery(q), q])]) {
        result = await attempt(cand, userAgent, minDelay);
        if (result) break;
      }
      if (!result && useZipFallback && !q.toUpperCase().includes("PO BOX")) {
        const m = q.match(ZIP_RE);
        if (m) result = await zipCentroid(m[1]);
      }
      cache[q] = result ? result : UNRESOLVED;
      if ((i + 1) % 20 === 0 || i === todo.length - 1) {
        console.log(`[geocode]   ${i + 1}/${todo.length} done`);
        saveCache(cachePath, cache);
      }
    }
    saveCache(cachePath, cache);
  }

  const out = new Map();
  for (const q of unique) {
    const v = cache[q];
    out.set(q, Array.isArray(v) ? [v[0], v[1]] : null);
  }
  return out;
}
