import * as Location from 'expo-location';
import type { AddressParts, MatchedFlyer, SavedCoords } from './types';

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

function normalizeAddressInput(input: string) {
  return String(input || '')
    .trim()
    .replace(/\s*\n+\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/,\s*,+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^,\s*|\s*,$/g, '')
    .trim();
}

function stripStateFromCity(city: string | null, state: string) {
  if (!city) return null;
  let cleaned = city.trim();
  const stateUpper = state.toUpperCase();
  if (/^[A-Z]{2}$/i.test(cleaned) && US_STATE_CODES.has(cleaned.toUpperCase())) {
    return null;
  }
  if (cleaned.toUpperCase().endsWith(` ${stateUpper}`)) {
    cleaned = cleaned.slice(0, -(stateUpper.length + 1)).trim();
  }
  return cleaned || null;
}

function splitStreetAndCityFromSinglePart(value: string) {
  const match = value.match(
    /^(\d[\d\s/A-Z.-]*?\b(?:ST|STREET|AVE|AV|AVENUE|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|WAY|CT|COURT|PL|PLACE|PKWY|PARKWAY|HWY|HIGHWAY|ROAD|RD)\.?\s+[NSEW]?\.?\b)\s+(.+)$/i,
  );
  if (!match) return { street: value.trim() || null, city: null as string | null };

  let street = match[1].trim();
  let remainder = match[2].trim();
  const suiteLeadRe =
    /^((?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*(?:[/#]\s*)?\#?\s*[A-Z0-9-]+)\s*(.*)$/i;

  while (remainder) {
    const suiteMatch = remainder.match(suiteLeadRe);
    if (!suiteMatch) break;
    street = `${street} ${suiteMatch[1].trim()}`.trim();
    remainder = suiteMatch[2].trim();
  }

  return {
    street: street || null,
    city: remainder || null,
  };
}

export function formatAddressFromParts(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}) {
  const state = String(parts.state || '').trim().toUpperCase() || 'FL';
  const city = stripStateFromCity(String(parts.city || '').trim() || null, state);
  const street = String(parts.street || '').trim() || null;
  const postalCode = String(parts.postalCode || '').replace(/\D/g, '').slice(0, 5) || null;

  return [street, city, state, postalCode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

export async function getCurrentLocation(): Promise<SavedCoords> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Location permission is required to detect where you are.');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

export function formatDeviceAddress(rows: Location.LocationGeocodedAddress[]) {
  const row = rows[0];
  if (!row) return '';
  return formatAddressFromParts({
    street: [row.streetNumber, row.street].filter(Boolean).join(' ') || null,
    city: row.city || null,
    state: row.region || 'FL',
    postalCode: row.postalCode ? String(row.postalCode).replace(/\D/g, '').slice(0, 5) : null,
  });
}

export function formatDeviceParts(rows: Location.LocationGeocodedAddress[]): AddressParts | null {
  const row = rows[0];
  if (!row) return null;
  return {
    street: [row.streetNumber, row.street].filter(Boolean).join(' ') || null,
    city: row.city || null,
    state: row.region || 'FL',
    postalCode: row.postalCode ? String(row.postalCode).replace(/\D/g, '').slice(0, 5) : null,
  };
}

export function parseTypedAddress(text: string): AddressParts | null {
  let cleaned = normalizeAddressInput(text);
  if (cleaned.length < 5) return null;

  cleaned = cleaned.replace(/,?\s*(USA|UNITED STATES)\s*$/i, '').trim();

  const zipMatch = cleaned.match(/\b(\d{5})(?:-?\d{4})?\b/);
  const postalCode = zipMatch ? zipMatch[1] : null;
  if (zipMatch) {
    cleaned = cleaned.replace(new RegExp(`\\s*${zipMatch[0]}\\s*`), ' ').replace(/,\s*$/, '').trim();
  }

  const stateMatch = cleaned.match(/(?:,\s*|\s+)([A-Z]{2})\s*$/i);
  const state = stateMatch && US_STATE_CODES.has(stateMatch[1].toUpperCase())
    ? stateMatch[1].toUpperCase()
    : 'FL';
  if (stateMatch && stateMatch.index != null) {
    cleaned = cleaned.slice(0, stateMatch.index).replace(/,\s*$/, '').trim();
  }

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  let street: string | null = null;
  let city: string | null = null;

  if (parts.length >= 2) {
    street = parts[0] || null;
    city = parts.slice(1).join(', ') || null;
  } else if (parts.length === 1) {
    if (/^\d/.test(parts[0])) {
      const split = splitStreetAndCityFromSinglePart(parts[0]);
      street = split.street;
      city = split.city;
    } else {
      city = parts[0];
    }
  }

  city = stripStateFromCity(city, state);

  if (!city && !postalCode) return null;
  return { street, city, state, postalCode };
}

export function validateRequiredAddressParts(parts: AddressParts | null | undefined): {
  ok: boolean;
  message?: string;
} {
  if (!parts?.street?.trim()) {
    return { ok: false, message: 'Street is required. Include the street line in your address.' };
  }
  if (!parts?.postalCode?.trim()) {
    return { ok: false, message: 'ZIP code is required. Include a 5-digit ZIP in your address.' };
  }
  return { ok: true };
}

export function normalizePhoneDigits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

export function orgMatchesPhoneFilter(orgPhone: string | null | undefined, phoneFilter: string) {
  const needle = normalizePhoneDigits(phoneFilter);
  if (!needle) return true;
  const haystack = normalizePhoneDigits(orgPhone || '');
  if (!haystack) return false;
  return haystack.includes(needle) || haystack.endsWith(needle.slice(-10));
}

export function flyerLabel(flyer: MatchedFlyer) {
  return flyer.flyerTitle || flyer.campaignName || 'Flyer';
}

export function dropStatusLabel(value: string) {
  const labels: Record<string, string> = {
    dropped: 'Dropped',
    refused: 'Refused',
    closed: 'Closed',
    no_access: 'No access',
    not_found: 'Not found',
    virtual_mail_only: 'Virtual/mail only',
  };
  return labels[value] || value;
}

export function stopTypeLabel(value: string) {
  const labels: Record<string, string> = {
    suite_reception: 'Suite reception',
    building_lobby: 'Building lobby/front desk',
    mailroom: 'Mailroom/shared office',
    clinic_office: 'Individual clinic office',
    virtual_mailbox: 'Virtual/registered-agent/mailbox',
    unknown: 'Unknown',
  };
  return labels[value] || value;
}

export function orgVerificationLabel(value: string) {
  const labels: Record<string, string> = {
    npi_only: 'NPI-only',
    confirmed_on_site: 'Confirmed on site',
    virtual_mail_only: 'Virtual/mail only',
    not_present: 'Not present',
    unsure: 'Unsure',
  };
  return labels[value] || value;
}

export function countOrgsAtTypedSuite(organizations: Array<{ suiteLabel?: string | null; atSearchAddress?: boolean }>) {
  const exactMatches = organizations.filter((org) => org.atSearchAddress);
  return exactMatches.length || organizations.length;
}

export function isHighDensityLocation(orgCount: number) {
  return orgCount >= 10;
}
