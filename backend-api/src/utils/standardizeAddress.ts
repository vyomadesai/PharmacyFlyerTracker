import { formatUsAddressFromParts, normalizeCityKey, type UsAddressParts } from './parseUsAddress.js';
import { normalizeStopStreet } from '../modules/route-planner/routePlannerGeo.js';
import { stripSuiteFromStreet } from './streetAddressMatch.js';

export type StandardizedAddress = {
  street: string | null;
  city: string | null;
  state: string;
  postalCode: string | null;
  formattedAddress: string;
  locationKey: string;
  buildingStreetKey: string;
};

function clean(value: unknown) {
  return String(value ?? '').trim() || null;
}

export function normalizePostalCode(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(0, 5) || null;
}

export function buildLocationKeyFromParts(parts: UsAddressParts) {
  const street = normalizeStopStreet(stripSuiteFromStreet(String(parts.street || '')));
  const zip = normalizePostalCode(parts.postalCode) || 'unknown';
  if (street) return `addr:${street}|${zip}`;
  return `zip:${zip}`;
}

export function standardizeAddress(parts: UsAddressParts): StandardizedAddress {
  const state = String(parts.state || 'FL').trim().toUpperCase() || 'FL';
  const street = clean(parts.street);
  const city = clean(parts.city);
  const postalCode = normalizePostalCode(parts.postalCode);
  const buildingStreetKey = normalizeStopStreet(stripSuiteFromStreet(street || ''));
  const locationKey = buildLocationKeyFromParts({ street, city, state, postalCode });
  return {
    street,
    city,
    state,
    postalCode,
    formattedAddress: formatUsAddressFromParts({ street, city, state, postalCode }),
    locationKey,
    buildingStreetKey,
  };
}

export function citiesMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeCityKey(left);
  const b = normalizeCityKey(right);
  if (!a || !b) return false;
  return a === b;
}

export function addressesLikelySame(
  left: UsAddressParts,
  right: UsAddressParts,
) {
  const leftStd = standardizeAddress(left);
  const rightStd = standardizeAddress(right);
  if (leftStd.locationKey === rightStd.locationKey) return true;
  if (
    leftStd.buildingStreetKey
    && leftStd.buildingStreetKey === rightStd.buildingStreetKey
    && leftStd.postalCode
    && leftStd.postalCode === rightStd.postalCode
  ) {
    return true;
  }
  if (
    leftStd.buildingStreetKey
    && leftStd.buildingStreetKey === rightStd.buildingStreetKey
    && citiesMatch(leftStd.city, rightStd.city)
  ) {
    return true;
  }
  return false;
}
