import { getPool, sql } from '../../config/db.js';
import { milesBetween } from '../../utils/geography.js';
import {
  normalizeCityKey,
  parseUsAddressLine,
  type ParsedUsAddress,
} from '../../utils/parseUsAddress.js';
import { reverseGeocodeParts } from '../../services/routeOptimizer/addressSearch.js';
import { buildQuery, geocodeAddresses } from '../../services/routeOptimizer/geocoding.js';
import { listMyRoutePlans } from '../route-planner/routePlannerExecution.js';
import { normalizeStopStreet } from '../route-planner/routePlannerGeo.js';
import { formatUsAddressFromParts } from '../../utils/parseUsAddress.js';

type RouteStopLike = {
  stopLabel?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type MappedLocationRow = {
  locationId: number;
  practiceName: string;
  locationName: string | null;
  locationAddress: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressZip: string | null;
};

function formatStopAddress(stop: RouteStopLike) {
  return formatUsAddressFromParts({
    street: String(stop.addressStreet || stop.stopLabel || '').trim() || null,
    city: stop.addressCity || null,
    state: stop.addressState || 'FL',
    postalCode: stop.addressZip || null,
  });
}

function citiesMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCityKey(left);
  const b = normalizeCityKey(right);
  return Boolean(a && b && a === b);
}

function streetMatchScore(gpsStreet: string | null, locationStreet: string | null) {
  const gps = normalizeStopStreet(gpsStreet);
  const loc = normalizeStopStreet(locationStreet);
  if (!gps || !loc) return 0;
  if (gps === loc) return 100;
  if (gps.includes(loc) || loc.includes(gps)) return 80;
  const gpsTokens = gps.split(' ').filter(Boolean);
  const locTokens = new Set(loc.split(' ').filter(Boolean));
  const overlap = gpsTokens.filter((token) => locTokens.has(token)).length;
  if (!overlap) return 0;
  return Math.min(70, overlap * 20);
}

async function findMappedPracticeByAddress(input: {
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): Promise<MappedLocationRow | null> {
  const city = String(input.city || '').trim();
  const zip = String(input.postalCode || '').replace(/\D/g, '').slice(0, 5);
  const street = String(input.street || '').trim();
  if (!city && !zip) return null;

  const pool = await getPool();
  const request = pool.request();
  request.input('City', sql.NVarChar, city || null);
  request.input('Zip', sql.VarChar, zip || null);

  const zipFilter = zip
    ? `LEFT(LTRIM(RTRIM(CAST(ml.Location_AddressZip AS VARCHAR(20)))), 5) = @Zip`
    : '1 = 0';
  const cityFilter = city
    ? `UPPER(LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, '')))) = UPPER(@City)
       OR UPPER(LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, '')))) LIKE '%' + UPPER(@City) + '%'
       OR UPPER(@City) LIKE '%' + UPPER(LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, '')))) + '%'`
    : '1 = 0';

  const result = await request.query(`
    SELECT
      ml.ID AS LocationId,
      LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))) AS PracticeName,
      NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_Name, ''))), '') AS LocationName,
      LTRIM(RTRIM(ISNULL(ml.Location_AddressStreet, ''))) AS AddressStreet,
      LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, ''))) AS AddressCity,
      LTRIM(RTRIM(ISNULL(CAST(ml.Location_AddressZip AS VARCHAR(20)), ''))) AS AddressZip
    FROM dbo.Master_Location ml
    INNER JOIN dbo.Master_Practice mp ON mp.ID = ml.Practice_Id
    WHERE ISNULL(ml.Location_IsActive, 1) = 1
      AND LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))) <> ''
      AND ((${zipFilter}) OR (${cityFilter}))
  `);

  const rows = (result.recordset as Record<string, unknown>[])
    .map((row) => {
      const addressStreet = String(row.AddressStreet || '').trim() || null;
      const addressCity = String(row.AddressCity || '').trim() || null;
      const addressZip = String(row.AddressZip || '').replace(/\D/g, '').slice(0, 5) || null;
      const locationAddress = formatUsAddressFromParts({
        street: addressStreet,
        city: addressCity,
        state: 'FL',
        postalCode: addressZip,
      });
      return {
        locationId: Number(row.LocationId),
        practiceName: String(row.PracticeName || '').trim(),
        locationName: String(row.LocationName || '').trim() || null,
        locationAddress,
        addressStreet,
        addressCity,
        addressZip,
        score: streetMatchScore(street, addressStreet)
          + (zip && addressZip === zip ? 30 : 0)
          + (citiesMatch(city, addressCity) ? 15 : 0),
      };
    })
    .filter((row) => row.locationId > 0 && row.practiceName && row.locationAddress);

  if (!rows.length) return null;
  rows.sort((a, b) => b.score - a.score);
  const best = rows[0];
  if (street && best.score <= 0) return null;

  return {
    locationId: best.locationId,
    practiceName: best.practiceName,
    locationName: best.locationName,
    locationAddress: best.locationAddress,
    addressStreet: best.addressStreet,
    addressCity: best.addressCity,
    addressZip: best.addressZip,
  };
}

function toAddressParts(parsed: ParsedUsAddress) {
  return {
    street: parsed.street,
    city: parsed.city,
    state: parsed.state || 'FL',
    postalCode: parsed.postalCode,
  };
}

export async function getRepLocationHints(userId: number, lat: number, lng: number) {
  const geocoded = await reverseGeocodeParts(lat, lng);
  const currentLocationAddress = geocoded?.formattedAddress || null;

  let routeStop: {
    practiceName: string;
    locationAddress: string;
    distanceMiles: number;
  } | null = null;

  const plansResult = await listMyRoutePlans(userId);
  const plan = plansResult.plans?.[0];
  const stops = (plan?.stops ?? []) as RouteStopLike[];

  if (stops.length) {
    let nearest: RouteStopLike | null = null;
    let nearestMiles = Infinity;

    for (const stop of stops) {
      const stopLat = stop.latitude != null ? Number(stop.latitude) : NaN;
      const stopLng = stop.longitude != null ? Number(stop.longitude) : NaN;
      if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) continue;

      const distanceMiles = milesBetween(lat, lng, stopLat, stopLng);
      if (distanceMiles < nearestMiles) {
        nearestMiles = distanceMiles;
        nearest = stop;
      }
    }

    if (nearest && nearestMiles <= 0.35) {
      const locationAddress = formatStopAddress(nearest);
      if (locationAddress) {
        routeStop = {
          practiceName: String(nearest.stopLabel || '').trim() || locationAddress.split(',')[0] || 'Route stop',
          locationAddress,
          distanceMiles: Number(nearestMiles.toFixed(2)),
        };
      }
    }
  }

  const mappedLocation = await findMappedPracticeByAddress({
    street: geocoded?.street,
    city: geocoded?.city,
    postalCode: geocoded?.postalCode,
  });

  const mappedPractice = mappedLocation
    ? {
        practiceName: mappedLocation.practiceName,
        locationName: mappedLocation.locationName,
        locationAddress: mappedLocation.locationAddress,
        locationId: mappedLocation.locationId,
      }
    : routeStop
      ? {
          practiceName: routeStop.practiceName,
          locationName: null as string | null,
          locationAddress: routeStop.locationAddress,
          locationId: null as number | null,
        }
      : null;

  return {
    currentLocationAddress,
    addressParts: geocoded
      ? {
          street: geocoded.street,
          city: geocoded.city,
          state: geocoded.state || 'FL',
          postalCode: geocoded.postalCode,
        }
      : null,
    mappedPractice,
    routeStop,
    gpsMismatchWarning: geocoded?.state && geocoded.state.toUpperCase() !== 'FL'
      ? `GPS shows ${[geocoded.city, geocoded.state].filter(Boolean).join(', ')}. Type your Florida address and tap Apply address.`
      : null,
  };
}

export async function resolveAddressHints(userId: number, addressText: string) {
  const parsed = parseUsAddressLine(addressText);
  if (!parsed?.city && !parsed?.postalCode) {
    return {
      error: 'Enter city and ZIP in the address, e.g. 701 6th St S, St Petersburg, FL, 33701',
    } as const;
  }

  const mappedLocation = await findMappedPracticeByAddress({
    street: parsed.street,
    city: parsed.city,
    postalCode: parsed.postalCode,
  });

  let mappedPractice: {
    practiceName: string;
    locationName: string | null;
    locationAddress: string;
    locationId: number | null;
  } | null = mappedLocation
    ? {
        practiceName: mappedLocation.practiceName,
        locationName: mappedLocation.locationName,
        locationAddress: mappedLocation.locationAddress,
        locationId: mappedLocation.locationId,
      }
    : null;

  let latitude: number | null = null;
  let longitude: number | null = null;
  const query = buildQuery(parsed.street, parsed.city, parsed.state, parsed.postalCode);
  if (query) {
    const geocoded = await geocodeAddresses([query], { minDelaySeconds: 1.1 });
    const coord = geocoded.get(query);
    if (coord) {
      latitude = coord[0];
      longitude = coord[1];
    }
  }

  if (!mappedPractice) {
    const plansResult = await listMyRoutePlans(userId);
    const plan = plansResult.plans?.[0];
    const stops = (plan?.stops ?? []) as RouteStopLike[];
    const targetCity = normalizeCityKey(parsed.city);
    const targetZip = parsed.postalCode;

    for (const stop of stops) {
      const stopZip = String(stop.addressZip || '').replace(/\D/g, '').slice(0, 5);
      const stopCity = normalizeCityKey(stop.addressCity);
      const zipMatch = targetZip && stopZip === targetZip;
      const cityMatch = targetCity && stopCity === targetCity;
      const streetMatch = streetMatchScore(parsed.street ?? null, stop.addressStreet ?? null) >= 50;
      if ((zipMatch || cityMatch) && (!parsed.street || streetMatch)) {
        mappedPractice = {
          practiceName: String(stop.stopLabel || '').trim() || 'Route stop',
          locationName: null as string | null,
          locationAddress: formatStopAddress(stop),
          locationId: null as number | null,
        };
        break;
      }
    }
  }

  return {
    currentLocationAddress: parsed.formattedAddress,
    addressParts: toAddressParts(parsed),
    mappedPractice,
    latitude,
    longitude,
    practiceFound: Boolean(mappedPractice),
  };
}
