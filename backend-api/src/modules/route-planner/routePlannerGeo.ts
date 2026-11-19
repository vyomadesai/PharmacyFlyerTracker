import { buildQuery, geocodeAddresses } from '../../services/routeOptimizer/geocoding.js';
import { isValidCoordinatePair, milesBetween, parseCoordinate } from '../../utils/geography.js';

export type StartPointInput = {
  startLatitude?: number | null;
  startLongitude?: number | null;
  startZip?: string | null;
  startAddress?: string | null;
};

export type ResolvedStartPoint = {
  startType: 'gps' | 'address' | 'zip' | 'none';
  startLabel: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number;
};

export type AddressForGeocode = {
  key: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

const STOP_SUITE_RE = /[,\s]*(?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*#?\s*\w+\b/gi;

export function normalizeStopStreet(street?: string | null): string {
  let s = ` ${String(street || '').toUpperCase().trim()} `;
  s = s.replace(STOP_SUITE_RE, ' ');
  s = s.replace(/[#.,]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Skip queries with no street number and no ZIP — they resolve to state/city centroids. */
export function isGeocodableQuery(query: string): boolean {
  if (!query || query === ', USA') return false;
  if (/\b\d{5}\b/.test(query)) return true;
  const streetPart = query.split(',')[0]?.trim() ?? '';
  return /^\d+\s/.test(streetPart);
}

/** True when the stop represents a Master_Location from Doctor_Location_Mapping (loc:N key). */
export function isMappedLocationStop(input: {
  locationId?: number | null;
  locationKey?: string | null;
}): boolean {
  if (input.locationId != null && input.locationId > 0) return true;
  const key = String(input.locationKey || '').trim();
  return key.startsWith('loc:');
}

export function stopLocationKey(input: {
  locationId?: number | null;
  practiceId?: number | null;
  addressStreet?: string | null;
  addressZip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: string | null;
}): string {
  // Mapped locations always merge on Master_Location id, not per-doctor geocodes.
  if (input.locationId != null && input.locationId > 0) return `loc:${input.locationId}`;
  if (input.practiceId != null && input.practiceId > 0) return `practice:${input.practiceId}`;
  if (
    input.coordinateSource === 'geocoded' &&
    input.latitude != null &&
    input.longitude != null
  ) {
    return `geo:${Number(input.latitude).toFixed(4)},${Number(input.longitude).toFixed(4)}`;
  }
  const street = normalizeStopStreet(input.addressStreet);
  const zip = String(input.addressZip || '').trim();
  if (street) return `addr:${street}|${zip}`;
  if (input.latitude != null && input.longitude != null) {
    return `geo:${Number(input.latitude).toFixed(4)},${Number(input.longitude).toFixed(4)}`;
  }
  return `zip:${zip || 'unknown'}`;
}

export async function resolveStartPoint(
  input: StartPointInput,
  radiusMiles = 10,
): Promise<ResolvedStartPoint | { error: string }> {
  const lat = parseCoordinate(input.startLatitude);
  const lng = parseCoordinate(input.startLongitude);
  const zip = String(input.startZip || '').replace(/\D/g, '').slice(0, 5);
  const address = String(input.startAddress || '').trim();

  if (isValidCoordinatePair(lat, lng) && lng != null) {
    return {
      startType: 'gps',
      startLabel: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      centerLatitude: lat,
      centerLongitude: lng,
      radiusMiles,
    };
  }

  if (address) {
    const geocoded = await geocodeAddresses([address], { minDelaySeconds: 1.1 });
    const coord = geocoded.get(address);
    if (!coord) {
      return { error: `Could not resolve coordinates for ${address}.` };
    }
    return {
      startType: 'address',
      startLabel: address,
      centerLatitude: coord[0],
      centerLongitude: coord[1],
      radiusMiles,
    };
  }

  if (zip.length === 5) {
    const query = `${zip}, USA`;
    const geocoded = await geocodeAddresses([query], { minDelaySeconds: 1.1 });
    const coord = geocoded.get(query);
    if (!coord) {
      return { error: `Could not resolve coordinates for zip ${zip}.` };
    }
    return {
      startType: 'zip',
      startLabel: zip,
      centerLatitude: coord[0],
      centerLongitude: coord[1],
      radiusMiles,
    };
  }

  return {
    startType: 'none',
    startLabel: null,
    centerLatitude: null,
    centerLongitude: null,
    radiusMiles,
  };
}

export async function resolveCoordinatesForAddresses(addresses: AddressForGeocode[]) {
  const uniqueQueries = new Map<string, AddressForGeocode>();
  for (const addr of addresses) {
    const query = buildQuery(addr.street, addr.city, addr.state, addr.zip);
    if (!isGeocodableQuery(query)) continue;
    if (!uniqueQueries.has(query)) uniqueQueries.set(query, addr);
  }

  const geocoded = await geocodeAddresses([...uniqueQueries.keys()], { minDelaySeconds: 0.35 });
  const byKey = new Map<string, { latitude: number; longitude: number; source: string }>();

  for (const addr of addresses) {
    const query = buildQuery(addr.street, addr.city, addr.state, addr.zip);
    if (!isGeocodableQuery(query)) continue;
    const coord = geocoded.get(query);
    if (coord) {
      byKey.set(addr.key, { latitude: coord[0], longitude: coord[1], source: 'geocoded' });
      continue;
    }
    const zip = String(addr.zip || '').replace(/\D/g, '').slice(0, 5);
    if (zip.length === 5) {
      const zipQuery = `${zip}, USA`;
      const zipCoord = geocoded.get(zipQuery) || (await geocodeAddresses([zipQuery])).get(zipQuery);
      if (zipCoord) {
        byKey.set(addr.key, { latitude: zipCoord[0], longitude: zipCoord[1], source: 'zip-centroid' });
      }
    }
  }

  return byKey;
}

function extractZip5(zip?: string | null) {
  return String(zip || '').replace(/\D/g, '').slice(0, 5);
}

/**
 * Geocode only addresses whose ZIP is near the GPS point. Check-in used to
 * street-geocode the entire mapped/campaign universe first, which can take
 * minutes and drops the mobile connection.
 */
export async function resolveCoordinatesNearPoint(
  addresses: AddressForGeocode[],
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
) {
  const padMiles = Math.max(radiusMiles * 2, radiusMiles + 8);
  const zips = [...new Set(addresses.map((addr) => extractZip5(addr.zip)).filter((zip) => zip.length === 5))];
  const zipQueries = zips.map((zip) => `${zip}, USA`);
  const zipCoords = zipQueries.length
    ? await geocodeAddresses(zipQueries, { minDelaySeconds: 0.2, useZipFallback: false })
    : new Map<string, [number, number] | null>();

  const nearbyZips = new Set<string>();
  for (const zip of zips) {
    const coord = zipCoords.get(`${zip}, USA`);
    if (!coord) {
      nearbyZips.add(zip);
      continue;
    }
    if (milesBetween(centerLat, centerLng, coord[0], coord[1]) <= padMiles) {
      nearbyZips.add(zip);
    }
  }

  const nearby = addresses.filter((addr) => {
    const zip = extractZip5(addr.zip);
    if (zip.length === 5) return nearbyZips.has(zip);
    return true;
  });

  const ranked = nearby.map((addr) => {
    const zip = extractZip5(addr.zip);
    const coord = zip.length === 5 ? zipCoords.get(`${zip}, USA`) : null;
    const dist = coord
      ? milesBetween(centerLat, centerLng, coord[0], coord[1])
      : Number.POSITIVE_INFINITY;
    return { addr, dist };
  }).sort((a, b) => a.dist - b.dist);

  const MAX_STREET_GEOCODES = 80;
  const toGeocode = ranked.slice(0, MAX_STREET_GEOCODES).map((row) => row.addr);
  return resolveCoordinatesForAddresses(toGeocode);
}

export function filterByRadius<T extends { latitude?: number | null; longitude?: number | null }>(
  rows: T[],
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
): Array<T & { distanceMiles: number }> {
  const filtered: Array<T & { distanceMiles: number }> = [];
  for (const row of rows) {
    if (row.latitude == null || row.longitude == null) continue;
    const distanceMiles = milesBetween(centerLat, centerLng, row.latitude, row.longitude);
    if (distanceMiles <= radiusMiles) {
      filtered.push({ ...row, distanceMiles: Math.round(distanceMiles * 100) / 100 });
    }
  }
  filtered.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return filtered;
}

export function orderStopsNearestNeighbor<T extends { latitude?: number | null; longitude?: number | null }>(
  stops: T[],
  startLat: number,
  startLng: number,
): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let cursorLat = startLat;
  let cursorLng = startLng;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.MAX_VALUE;
    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      const lat = stop.latitude;
      const lng = stop.longitude;
      if (lat == null || lng == null) {
        bestIndex = i;
        bestDistance = Number.MAX_VALUE - remaining.length + i;
        break;
      }
      const dist = milesBetween(cursorLat, cursorLng, lat, lng);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    if (next.latitude != null && next.longitude != null) {
      cursorLat = next.latitude;
      cursorLng = next.longitude;
    }
  }

  return ordered;
}
