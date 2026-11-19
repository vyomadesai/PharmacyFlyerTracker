export type AddressSuggestion = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

import { formatUsAddressFromParts } from '../../utils/parseUsAddress.js';

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
};

type NominatimRow = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
};

function formatUsAddress(row: NominatimRow): string {
  const address = row.address;
  if (address) {
    const street = [address.house_number, address.road].filter(Boolean).join(' ').trim() || null;
    const city = address.city || address.town || address.village || address.municipality || null;
    const state = address.state ? String(address.state).trim() : null;
    const postalCode = address.postcode ? String(address.postcode).replace(/\D/g, '').slice(0, 5) : null;
    const formatted = formatUsAddressFromParts({ street, city, state, postalCode });
    if (formatted) return formatted;
  }

  const raw = String(row.display_name || '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return raw;
  const country = parts[parts.length - 1];
  if (country === 'United States' || country === 'USA') parts.pop();
  return parts.join(', ');
}

export async function searchAddressSuggestions(
  query: string,
  limit = 6,
): Promise<AddressSuggestion[]> {
  const q = String(query || '').trim();
  if (q.length < 3) return [];

  const safeLimit = Math.min(Math.max(Math.floor(limit) || 6, 1), 10);
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      countrycodes: 'us',
      limit: String(safeLimit),
      q,
    }).toString();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'pharmacy-flyer-tracker-route-planner',
        'Accept-Language': 'en',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimRow[];
    if (!Array.isArray(data)) return [];

    return data
      .map((row) => {
        const lat = row.lat != null ? Number(row.lat) : NaN;
        const lng = row.lon != null ? Number(row.lon) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const label = String(row.display_name || '').trim();
        const address = formatUsAddress(row) || label;
        if (!address) return null;
        return {
          id: String(row.place_id ?? `${lat},${lng},${address}`),
          label,
          address,
          latitude: lat,
          longitude: lng,
        };
      })
      .filter((row): row is AddressSuggestion => row != null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export type ReverseGeocodeParts = {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
};

function buildStreetLine(address: NominatimAddress | undefined) {
  if (!address) return null;
  const line = [address.house_number, address.road].filter(Boolean).join(' ').trim();
  return line || null;
}

function pickCity(address: NominatimAddress | undefined) {
  if (!address) return null;
  return address.city || address.town || address.village || address.municipality || null;
}

export async function reverseGeocodeParts(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeParts | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const url =
    'https://nominatim.openstreetmap.org/reverse?' +
    new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      lat: String(latitude),
      lon: String(longitude),
    }).toString();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'pharmacy-flyer-tracker-route-planner',
        'Accept-Language': 'en',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimRow & { address?: NominatimAddress };
    const formattedAddress = formatUsAddress(data) || String(data.display_name || '').trim();
    const address = data.address;
    const street = buildStreetLine(address);
    const city = pickCity(address);
    const state = address?.state ? String(address.state).trim() : null;
    const postalCode = address?.postcode ? String(address.postcode).replace(/\D/g, '').slice(0, 5) : null;

    return {
      street: street || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      formattedAddress: formattedAddress || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocodeAddress(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const parts = await reverseGeocodeParts(latitude, longitude);
  return parts?.formattedAddress || null;
}
