// Geocode street addresses to [lat, lon] via OpenStreetMap / Nominatim.
//
// Ported from data_processing_node/src/geocoding.js (logic unchanged): address
// normalization, multi-attempt lookup, ZIP-centroid fallback, and an on-disk
// JSON cache. The cache file uses the exact same format and (by default) the
// exact same file as the data_processing_node project, so previously resolved
// St. Petersburg / Pinellas addresses are reused and not looked up again.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { milesBetween } from '../../utils/geography.js';

const UNRESOLVED = 'UNRESOLVED';

const DIRECTION: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NO: 'N', SO: 'S', EA: 'E', WE: 'W'
};
const STREET_TYPE: Record<string, string> = {
  AV: 'AVE', AVE: 'AVE', AVENUE: 'AVE', BLVD: 'BLVD', ST: 'ST',
  STREET: 'ST', DR: 'DR', PK: 'PARK', PKWY: 'PKWY', CT: 'CT'
};
const SUITE_RE =
  /[,\s]*(?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*#?\s*\w+\b/gi;
const ZIP_RE = /\b(\d{5})\b/;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let geocodeQueue: Promise<unknown> = Promise.resolve();

async function withGeocodeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = geocodeQueue.then(fn, fn);
  geocodeQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Default to the shared data_processing_node cache so geocodes are reused.
// Resolved relative to this module so it works whether run via tsx (src/) or
// compiled (dist/): .../backend-api/{src|dist}/services/routeOptimizer ->
// .../pharmacy-flyer-tracker-v2/data_processing_node/cache/geocode_cache.json
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CACHE_PATH =
  process.env.ROUTE_OPT_GEOCODE_CACHE ||
  path.resolve(HERE, '../../../../data_processing_node/cache/geocode_cache.json');

export function buildQuery(
  street?: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null
): string {
  const streetPart = (street || '').trim();
  const cityPart = (city || '').trim().toUpperCase();
  const statePart = (state || '').trim().toUpperCase();
  const parts = [streetPart, cityPart, statePart].filter(Boolean);
  let q = parts.join(', ');
  if (zip && String(zip).trim()) q += ` ${String(zip).trim()}`;
  q += ', USA';
  return q;
}

export function parseUsAddressQuery(query: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} | null {
  const trimmed = String(query || '').replace(/, USA$/i, '').trim();
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const street = parts[0];
  const city = parts[1];
  const stateZipMatch = parts[2].match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (!stateZipMatch) return null;
  return {
    street,
    city,
    state: stateZipMatch[1].toUpperCase(),
    zip: stateZipMatch[2],
  };
}

function extractHouseNumber(street: string): string | null {
  const match = String(street || '').trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

export function normalizeStreet(street: string): string {
  let s = ' ' + street.toUpperCase().trim() + ' ';
  s = s.replace('DR MLK', 'DR MARTIN LUTHER KING');
  s = s.replace(/\bMLK\b/g, 'MARTIN LUTHER KING');
  s = s.replace(SUITE_RE, ' ');
  s = s.replace(/#/g, ' ');
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  const out = tokens.map((t) => DIRECTION[t] || STREET_TYPE[t] || t);
  return out.join(' ').trim();
}

function normalizedQuery(rawQuery: string): string {
  const idx = rawQuery.indexOf(',');
  if (idx === -1) return normalizeStreet(rawQuery);
  return normalizeStreet(rawQuery.slice(0, idx)) + rawQuery.slice(idx);
}

// A formatting-independent key for the same physical address: normalize the
// street (strip suite/unit, expand abbreviations), upper-case the whole thing,
// and collapse whitespace. Two address strings that differ only in suite,
// punctuation, abbreviation, or casing map to the same canonical key, so a
// coordinate resolved once is reused for every variant — never recomputed.
function canonicalKey(rawQuery: string): string {
  return normalizedQuery(rawQuery).toUpperCase().replace(/\s+/g, ' ').trim();
}

type CacheValue = [number, number] | string | null;

function loadCache(cachePath: string): Record<string, CacheValue> {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cachePath: string, cache: Record<string, CacheValue>): void {
  fs.mkdirSync(path.dirname(cachePath) || '.', { recursive: true });
  const tmp = cachePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, cachePath);
}

type CoordEntry = { key: string; coord: [number, number] };

function pickPreferredCoordinate(entries: CoordEntry[]): [number, number] {
  if (entries.length === 1) return entries[0].coord;

  const exactCanonical = entries.find((entry) => canonicalKey(entry.key) === entry.key);
  if (exactCanonical) return exactCanonical.coord;

  for (const entry of entries) {
    const parts = parseUsAddressQuery(entry.key);
    if (!parts) continue;
    const built = buildQuery(parts.street, parts.city, parts.state, parts.zip);
    if (built === entry.key || canonicalKey(built) === canonicalKey(entry.key)) {
      return entry.coord;
    }
  }

  return entries[0].coord;
}

// Index every cached entry by its canonical (formatting-independent) key so a
// coordinate resolved under one address spelling is reused for any other
// spelling of the same place. When duplicate spellings disagree, pick one
// preferred coordinate locally (no live re-geocode during check-in).
function buildCanonicalIndex(cache: Record<string, CacheValue>): Map<string, CacheValue> {
  const grouped = new Map<string, CoordEntry[]>();
  const idx = new Map<string, CacheValue>();

  for (const [k, v] of Object.entries(cache)) {
    const ck = canonicalKey(k);
    if (Array.isArray(v)) {
      if (!grouped.has(ck)) grouped.set(ck, []);
      grouped.get(ck)!.push({ key: k, coord: v });
      continue;
    }
    if (!idx.has(ck)) idx.set(ck, v);
  }

  for (const [ck, entries] of grouped) {
    if (entries.length === 1) {
      idx.set(ck, entries[0].coord);
      continue;
    }

    let maxSpreadMiles = 0;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        maxSpreadMiles = Math.max(
          maxSpreadMiles,
          milesBetween(
            entries[i].coord[0],
            entries[i].coord[1],
            entries[j].coord[0],
            entries[j].coord[1],
          ),
        );
      }
    }

    const preferred = maxSpreadMiles >= 0.25
      ? pickPreferredCoordinate(entries)
      : entries[0].coord;
    idx.set(ck, preferred);
    for (const entry of entries) {
      cache[entry.key] = preferred;
    }
  }

  return idx;
}

// Coordinate already known for this query, either under its exact string or any
// equivalent spelling of the same address. null = not resolved yet.
function resolvedCoord(
  cache: Record<string, CacheValue>,
  canonIndex: Map<string, CacheValue>,
  q: string
): [number, number] | null {
  const viaCanon = canonIndex.get(canonicalKey(q));
  if (Array.isArray(viaCanon)) return [viaCanon[0] as number, viaCanon[1] as number];
  const direct = cache[q];
  if (Array.isArray(direct)) return [direct[0] as number, direct[1] as number];
  return null;
}

function needsLookup(
  cache: Record<string, CacheValue>,
  canonIndex: Map<string, CacheValue>,
  q: string
): boolean {
  if (resolvedCoord(cache, canonIndex, q)) return false; // resolved (any spelling) -> never recompute
  if (cache[q] === UNRESOLVED) return false;             // known-unresolvable for this exact form
  return true;                                            // missing/null -> look up
}

async function nominatim(
  query: string,
  userAgent: string,
  timeoutMs = 10000,
  expectedHouseNumber: string | null = null,
): Promise<[number, number] | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&q=' +
    encodeURIComponent(query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (Array.isArray(data) && data.length) {
      if (expectedHouseNumber && !resultMatchesHouseNumber(data[0], expectedHouseNumber)) {
        return null;
      }
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function nominatimStructured(
  parts: { street: string; city: string; state: string; zip: string },
  userAgent: string,
  timeoutMs = 10000,
  expectedHouseNumber: string | null = null,
): Promise<[number, number] | null> {
  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'us',
    addressdetails: '1',
    street: normalizeStreet(parts.street),
    city: parts.city.trim(),
    state: parts.state.trim(),
    postalcode: parts.zip.trim(),
    country: 'USA',
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (Array.isArray(data) && data.length) {
      if (expectedHouseNumber && !resultMatchesHouseNumber(data[0], expectedHouseNumber)) {
        return null;
      }
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resultMatchesHouseNumber(result: any, houseNo: string): boolean {
  const normalizedHouse = String(houseNo || '').trim();
  if (!normalizedHouse) return true;
  const addressHouse = result?.address?.house_number;
  if (addressHouse != null && String(addressHouse).trim() === normalizedHouse) return true;
  const displayName = String(result?.display_name || '');
  return new RegExp(`\\b${normalizedHouse}\\b`).test(displayName);
}

async function attempt(
  query: string,
  userAgent: string,
  minDelay: number
): Promise<[number, number] | null> {
  const parts = parseUsAddressQuery(query);
  const expectedHouseNumber = parts ? extractHouseNumber(parts.street) : extractHouseNumber(query);
  const candidates = [...new Set([normalizedQuery(query), query])];

  if (parts) {
    const structured = await nominatimStructured(parts, userAgent, 10000, expectedHouseNumber);
    await sleep(minDelay);
    if (structured) return structured;
  }

  for (const cand of candidates) {
    const result = await nominatim(cand, userAgent, 10000, expectedHouseNumber);
    await sleep(minDelay);
    if (result) return result;
  }

  return null;
}

export type GeocodeOptions = {
  cachePath?: string;
  userAgent?: string;
  minDelaySeconds?: number;
  useZipFallback?: boolean;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Resolve a list of query strings to [lat, lon] | null.
 */
export async function geocodeAddresses(
  queries: string[],
  opts: GeocodeOptions = {}
): Promise<Map<string, [number, number] | null>> {
  return withGeocodeLock(async () => {
  const {
    cachePath = DEFAULT_CACHE_PATH,
    userAgent = 'routeopt-distribution-planner',
    minDelaySeconds = 1.1,
    useZipFallback = true,
    onProgress
  } = opts;
  const minDelay = minDelaySeconds * 1000;

  const cache = loadCache(cachePath);
  const cacheBefore = JSON.stringify(cache);
  const canonIndex = buildCanonicalIndex(cache);
  const unique = [...new Set(queries)];
  const todo = unique.filter((q) => needsLookup(cache, canonIndex, q));

  if (todo.length) {
    console.log(
      `[geocode] resolving ${todo.length} addresses (~${(
        (todo.length * minDelaySeconds) /
        60
      ).toFixed(1)} min, cached for reuse)...`
    );
    const zipCache = new Map<string, [number, number] | null>();
    const zipCentroid = async (zip: string) => {
      if (zipCache.has(zip)) return zipCache.get(zip)!;
      const v = await attempt(`${zip}, USA`, userAgent, minDelay);
      zipCache.set(zip, v);
      return v;
    };

    for (let i = 0; i < todo.length; i++) {
      const q = todo[i];
      let result: [number, number] | null = await attempt(q, userAgent, minDelay);
      if (!result && useZipFallback && !q.toUpperCase().includes('PO BOX')) {
        const m = q.match(ZIP_RE);
        if (m) result = await zipCentroid(m[1]);
      }
      cache[q] = result ? result : UNRESOLVED;
      // Keep the canonical index in sync so other spellings of the same address
      // in this same batch reuse the coordinate instead of looking it up again.
      const ck = canonicalKey(q);
      if (result) canonIndex.set(ck, result);
      else if (!canonIndex.has(ck)) canonIndex.set(ck, UNRESOLVED);
      if (onProgress) onProgress(i + 1, todo.length);
      if ((i + 1) % 20 === 0 || i === todo.length - 1) {
        console.log(`[geocode]   ${i + 1}/${todo.length} done`);
        saveCache(cachePath, cache);
      }
    }
    saveCache(cachePath, cache);
  } else if (JSON.stringify(cache) !== cacheBefore) {
    saveCache(cachePath, cache);
  }

  const out = new Map<string, [number, number] | null>();
  for (const q of unique) {
    out.set(q, resolvedCoord(cache, canonIndex, q));
  }
  return out;
  });
}
