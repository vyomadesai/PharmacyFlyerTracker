import { getPool, sql } from '../../config/db.js';
import { buildQuery, geocodeAddresses } from '../../services/routeOptimizer/geocoding.js';
import { milesBetween } from '../../utils/geography.js';
import { isGeocodableQuery, resolveCoordinatesForAddresses } from '../route-planner/routePlannerGeo.js';
import type { NpiRegistryRecord } from './npiRegistryLocationLookup.js';

export type LocationCoordinate = {
  latitude: number;
  longitude: number;
  source: 'db' | 'geocoded' | 'zip-centroid';
};

export type NpiLocationGroupInput = {
  locationKey: string;
  street: string | null;
  city: string | null;
  state: string;
  postalCode: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function parseCoord(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function isPlausibleFloridaCoord(latitude: number | null, longitude: number | null) {
  if (latitude == null || longitude == null) return false;
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) return false;
  return latitude >= 24 && latitude <= 31.5 && longitude <= -79 && longitude >= -88;
}

export function boundingBoxForRadius(centerLat: number, centerLng: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.2));
  return {
    minLat: centerLat - latDelta,
    maxLat: centerLat + latDelta,
    minLng: centerLng - lngDelta,
    maxLng: centerLng + lngDelta,
  };
}

export async function loadStoredCoordinatesForLocationKeys(locationKeys: string[]) {
  const unique = [...new Set(locationKeys.filter(Boolean))];
  const byKey = new Map<string, LocationCoordinate>();
  if (!unique.length) return byKey;

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(ISNULL(p.PrimaryStreetLine1, ''))) AS Street,
      LTRIM(RTRIM(ISNULL(p.PrimaryCity, ''))) AS City,
      LTRIM(RTRIM(ISNULL(p.PrimaryState, 'FL'))) AS State,
      LEFT(REPLACE(ISNULL(p.PrimaryPostalCode, ''), ' ', ''), 5) AS PostalCode,
      p.PrimaryLatitude AS Latitude,
      p.PrimaryLongitude AS Longitude
    FROM dbo.PharmacyFlyer_NPI_Registry_Data p
    WHERE p.PrimaryLatitude IS NOT NULL
      AND p.PrimaryLongitude IS NOT NULL
      AND p.Status = 'Active'
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const lat = parseCoord(row.Latitude);
    const lng = parseCoord(row.Longitude);
    if (lat == null || lng == null) continue;
    const query = buildQuery(
      clean(row.Street),
      clean(row.City),
      clean(row.State) || 'FL',
      clean(row.PostalCode),
    );
    if (!query) continue;
    const key = `addr:${query}`;
    if (!unique.some((candidate) => candidate === key || candidate.includes(clean(row.PostalCode) || ''))) {
      continue;
    }
    byKey.set(key, { latitude: lat, longitude: lng, source: 'db' });
  }

  return byKey;
}

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

export async function ensureLocationCoordinates(
  groups: NpiLocationGroupInput[],
  options?: { persist?: boolean },
) {
  const byKey = new Map<string, LocationCoordinate>();
  const needsGeocode: NpiLocationGroupInput[] = [];

  for (const group of groups) {
    const lat = parseCoord(group.latitude);
    const lng = parseCoord(group.longitude);
    if (isPlausibleFloridaCoord(lat, lng)) {
      byKey.set(group.locationKey, { latitude: lat!, longitude: lng!, source: 'db' });
      continue;
    }
    needsGeocode.push(group);
  }

  if (needsGeocode.length) {
    const geocodeInputs = needsGeocode.map((group) => ({
      key: group.locationKey,
      street: group.street,
      city: group.city,
      state: group.state,
      zip: group.postalCode,
    }));
    const resolved = await resolveCoordinatesForAddresses(geocodeInputs);
    for (const group of needsGeocode) {
      const coord = resolved.get(group.locationKey);
      if (!coord || !isPlausibleFloridaCoord(coord.latitude, coord.longitude)) continue;
      byKey.set(group.locationKey, {
        latitude: coord.latitude,
        longitude: coord.longitude,
        source: coord.source === 'zip-centroid' ? 'zip-centroid' : 'geocoded',
      });
    }
  }

  if (options?.persist) {
    await persistCoordinatesForGroups(groups, byKey);
  }

  return byKey;
}

export async function persistCoordinatesForGroups(
  groups: NpiLocationGroupInput[],
  coordinates: Map<string, LocationCoordinate>,
) {
  const pool = await getPool();
  for (const group of groups) {
    const coord = coordinates.get(group.locationKey);
    if (!coord || coord.source === 'zip-centroid') continue;
    const street = clean(group.street);
    const city = clean(group.city);
    const state = clean(group.state) || 'FL';
    const postalCode = clean(group.postalCode);
    if (!street && !postalCode) continue;

    await pool.request()
      .input('Street', sql.NVarChar, street)
      .input('City', sql.NVarChar, city)
      .input('State', sql.VarChar(10), state)
      .input('PostalCode', sql.VarChar(20), postalCode)
      .input('Latitude', sql.Decimal(10, 7), coord.latitude)
      .input('Longitude', sql.Decimal(10, 7), coord.longitude)
      .query(`
        UPDATE dbo.PharmacyFlyer_NPI_Registry_Data
        SET PrimaryLatitude = @Latitude,
            PrimaryLongitude = @Longitude,
            GeocodedAt = SYSDATETIME()
        WHERE Status = 'Active'
          AND PrimaryLatitude IS NULL
          AND (
            (@Street IS NOT NULL AND LTRIM(RTRIM(ISNULL(PrimaryStreetLine1, ''))) = @Street)
            OR (@Street IS NULL AND PrimaryStreetLine1 IS NULL)
          )
          AND LTRIM(RTRIM(ISNULL(PrimaryCity, ''))) = ISNULL(@City, '')
          AND LTRIM(RTRIM(ISNULL(PrimaryState, 'FL'))) = @State
          AND LEFT(REPLACE(ISNULL(PrimaryPostalCode, ''), ' ', ''), 5) = ISNULL(LEFT(REPLACE(@PostalCode, ' ', ''), 5), '')
      `);
  }
}

export function filterGroupsByRadius<T extends NpiLocationGroupInput>(
  groups: T[],
  coordinates: Map<string, LocationCoordinate>,
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
) {
  const within: Array<T & { latitude: number; longitude: number; distanceMiles: number }> = [];
  for (const group of groups) {
    const coord = coordinates.get(group.locationKey);
    if (!coord || !isPlausibleFloridaCoord(coord.latitude, coord.longitude)) continue;
    const distanceMiles = milesBetween(centerLat, centerLng, coord.latitude, coord.longitude);
    if (distanceMiles > radiusMiles) continue;
    within.push({
      ...group,
      latitude: coord.latitude,
      longitude: coord.longitude,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
    });
  }
  within.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return within;
}

export async function geocodeUniqueNpiAddresses(
  addresses: Array<{
    street: string | null;
    city: string | null;
    state: string;
    postalCode: string | null;
  }>,
  options?: { minDelaySeconds?: number },
) {
  const uniqueQueries = new Map<string, typeof addresses[number]>();
  for (const addr of addresses) {
    const query = buildQuery(addr.street, addr.city, addr.state, addr.postalCode);
    if (!isGeocodableQuery(query)) continue;
    if (!uniqueQueries.has(query)) uniqueQueries.set(query, addr);
  }

  const geocoded = await geocodeAddresses([...uniqueQueries.keys()], {
    minDelaySeconds: options?.minDelaySeconds ?? 0.35,
  });

  const updates: Array<{
    street: string | null;
    city: string | null;
    state: string;
    postalCode: string | null;
    latitude: number;
    longitude: number;
  }> = [];

  for (const [query, addr] of uniqueQueries) {
    const coord = geocoded.get(query);
    if (!coord || !isPlausibleFloridaCoord(coord[0], coord[1])) continue;
    updates.push({
      ...addr,
      latitude: coord[0],
      longitude: coord[1],
    });
  }

  return updates;
}

export function attachDistanceToRecords(
  records: NpiRegistryRecord[],
  group: { latitude: number; longitude: number; distanceMiles: number },
) {
  return records.map((record) => ({
    ...record,
    latitude: group.latitude,
    longitude: group.longitude,
    distanceMiles: group.distanceMiles,
  }));
}
