import { milesBetween } from '../../utils/geography.js';
import { parseUsAddressLine } from '../../utils/parseUsAddress.js';
import { reverseGeocodeParts } from '../../services/routeOptimizer/addressSearch.js';
import { buildQuery, geocodeAddresses } from '../../services/routeOptimizer/geocoding.js';
import {
  formatProviderAddress,
  normalizeNppesZip,
  searchNppesByLocation,
  type NppesProvider,
} from '../../services/nppesLookup.js';
import {
  parseStreetWithSuite,
  providerMatchesSearchStreet,
  providerSuiteLabel,
} from '../../utils/streetAddressMatch.js';

export type NearbyOrgResult = {
  npi: string;
  organizationName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  organizationAddress: string;
  suiteLabel: string | null;
  distanceMiles: number;
  latitude: number | null;
  longitude: number | null;
  atSearchAddress?: boolean;
};

function toNearbyOrg(
  org: NppesProvider,
  distanceMiles: number,
  latitude: number | null,
  longitude: number | null,
  atSearchAddress = false,
): NearbyOrgResult {
  return {
    npi: org.npi,
    organizationName: org.providerName,
    taxonomyDesc: org.taxonomyDesc,
    taxonomyCode: org.taxonomyCode,
    phone: org.phone,
    organizationAddress: formatProviderAddress(org),
    suiteLabel: providerSuiteLabel(org),
    distanceMiles: Number(distanceMiles.toFixed(2)),
    latitude,
    longitude,
    atSearchAddress,
  };
}

async function resolveSearchCenter(input: {
  latitude?: number | null;
  longitude?: number | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}) {
  const query = buildQuery(input.street, input.city, input.state || 'FL', input.postalCode);
  if (query) {
    const geocoded = await geocodeAddresses([query], { minDelaySeconds: 1.1 });
    const coord = geocoded.get(query);
    if (coord) {
      return { latitude: coord[0], longitude: coord[1] };
    }
  }

  if (input.latitude != null && input.longitude != null) {
    return { latitude: input.latitude, longitude: input.longitude };
  }

  return null;
}

function orgAtSearchAddress(
  org: NppesProvider,
  street: string | null | undefined,
  postalCode: string | null | undefined,
) {
  const targetZip = normalizeNppesZip(postalCode);
  const orgZip = normalizeNppesZip(org.postalCode);
  if (targetZip && orgZip && targetZip !== orgZip) return false;
  if (!street?.trim()) return Boolean(targetZip && orgZip && targetZip === orgZip);
  return providerMatchesSearchStreet(org, street);
}

export async function findNearbyOrganizations(input: {
  latitude?: number | null;
  longitude?: number | null;
  radiusMiles?: number;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  addressText?: string | null;
}) {
  const parsed = input.addressText ? parseUsAddressLine(input.addressText) : null;
  const street = input.street || parsed?.street || null;
  const city = input.city || parsed?.city || null;
  const postalCode = input.postalCode || parsed?.postalCode || null;
  const state = input.state || parsed?.state || 'FL';
  const radiusMiles = Math.min(Math.max(Number(input.radiusMiles) || 0.5, 0.1), 10);

  const center = await resolveSearchCenter({
    latitude: input.latitude,
    longitude: input.longitude,
    street,
    city,
    state,
    postalCode,
  });

  if (!center) {
    return {
      organizations: [] as NearbyOrgResult[],
      hint: 'Could not locate this address. Check the format: 5398 Park St N, St Petersburg, FL, 33709',
      searchCenter: { latitude: null, longitude: null, city, state, postalCode, street },
    };
  }

  const { latitude, longitude } = center;

  let searchCity = city;
  let searchPostalCode = postalCode;
  if (!searchCity && !searchPostalCode) {
    const geocoded = await reverseGeocodeParts(latitude, longitude);
    searchCity = geocoded?.city || null;
    searchPostalCode = geocoded?.postalCode || null;
  }

  if (!searchCity && !searchPostalCode) {
    return {
      organizations: [] as NearbyOrgResult[],
      hint: 'Could not resolve city/ZIP. Type a full address with city and ZIP.',
      searchCenter: { latitude, longitude, city: searchCity, state, postalCode: searchPostalCode, street },
    };
  }

  const streetNeedle = street?.trim() || null;
  const parsedStreet = streetNeedle ? parseStreetWithSuite(streetNeedle) : null;
  const nppesStreetFilter = parsedStreet?.buildingStreet || streetNeedle;

  const search = await searchNppesByLocation({
    city: searchCity,
    state,
    postalCode: searchPostalCode,
    street: nppesStreetFilter,
    limit: 400,
    enumerationType: 'NPI-2',
  });

  const orgs = search.providers.filter((provider) => provider.isOrganization);

  const filteredOrgs = streetNeedle
    ? orgs.filter((org) => providerMatchesSearchStreet(org, streetNeedle))
    : orgs;
  if (!filteredOrgs.length) {
    return {
      organizations: [] as NearbyOrgResult[],
      hint: streetNeedle
        ? `No organizations on ${streetNeedle} in ZIP ${searchPostalCode || searchCity || state}.`
        : `No organizations found in NPI Registry for ${[searchCity, state, searchPostalCode].filter(Boolean).join(', ')}.`,
      searchCenter: { latitude, longitude, city: searchCity, state, postalCode: searchPostalCode, street },
    };
  }

  const queryByNpi = new Map<string, string>();
  for (const org of filteredOrgs) {
    const streetLine = [org.address1, org.address2].filter(Boolean).join(', ');
    const query = buildQuery(streetLine || org.address1, org.city, org.state, org.postalCode);
    if (query) queryByNpi.set(org.npi, query);
  }

  const uniqueQueries = [...new Set(queryByNpi.values())];
  const geocodedMap = uniqueQueries.length
    ? await geocodeAddresses(uniqueQueries, { minDelaySeconds: 0.5 })
    : new Map<string, [number, number]>();

  const withDistance: NearbyOrgResult[] = [];

  for (const org of filteredOrgs) {
    const atAddress = streetNeedle
      ? orgAtSearchAddress(org, streetNeedle, searchPostalCode)
      : orgAtSearchAddress(org, null, searchPostalCode);
    const query = queryByNpi.get(org.npi);
    const coord = query ? geocodedMap.get(query) : null;
    const orgLat = coord?.[0] ?? null;
    const orgLng = coord?.[1] ?? null;
    const distanceMiles = orgLat != null && orgLng != null
      ? milesBetween(latitude, longitude, orgLat, orgLng)
      : atAddress
        ? 0
        : Infinity;

    if (atAddress || distanceMiles <= radiusMiles) {
      withDistance.push(toNearbyOrg(
        org,
        atAddress ? Math.min(distanceMiles, 0.05) : distanceMiles,
        orgLat,
        orgLng,
        atAddress,
      ));
    }
  }

  withDistance.sort((a, b) => {
    if (a.atSearchAddress && !b.atSearchAddress) return -1;
    if (!a.atSearchAddress && b.atSearchAddress) return 1;
    return a.distanceMiles - b.distanceMiles;
  });

  return {
    organizations: withDistance,
    hint: withDistance.length
      ? null
      : `${filteredOrgs.length} organization(s) at this address/ZIP but none within ${radiusMiles} mi.`,
    searchCenter: { latitude, longitude, city: searchCity, state, postalCode: searchPostalCode, street },
  };
}
