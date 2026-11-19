export type ParsedUsAddress = {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  formattedAddress: string;
};

export type UsAddressParts = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
};

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

/** Standard format: street, city, state, zip (comma between each part). */
export function formatUsAddressFromParts(parts: UsAddressParts) {
  const state = String(parts.state || '').trim().toUpperCase() || 'FL';
  const city = stripStateFromCity(String(parts.city || '').trim() || null, state);
  const street = String(parts.street || '').trim() || null;
  const postalCode = String(parts.postalCode || '').replace(/\D/g, '').slice(0, 5) || null;

  return [street, city, state, postalCode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function normalizeCityKey(value: string | null | undefined) {
  let text = String(value || '').trim().toUpperCase();
  text = text.replace(/^ST\.?\s+/, 'SAINT ');
  text = text.replace(/^FT\.?\s+/, 'FORT ');
  text = text.replace(/[^A-Z0-9]/g, '');
  return text;
}

export function parseUsAddressLine(input: string): ParsedUsAddress | null {
  let cleaned = normalizeAddressInput(input);
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

  const formattedAddress = formatUsAddressFromParts({ street, city, state, postalCode }) || cleaned;

  return {
    street,
    city,
    state,
    postalCode,
    formattedAddress,
  };
}
