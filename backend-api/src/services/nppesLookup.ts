import { formatUsAddressFromParts } from '../utils/parseUsAddress.js';

const NPPES_API_BASE = 'https://npiregistry.cms.hhs.gov/api/';

type AnyRecord = Record<string, unknown>;

export type NppesTaxonomy = {
  code: string | null;
  desc: string | null;
  state: string | null;
  license: string | null;
  primary: boolean;
};

export type NppesProvider = {
  npi: string;
  providerName: string;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  primaryTaxonomy: string | null;
  selectedTaxonomy: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  isOrganization: boolean;
  taxonomies: NppesTaxonomy[];
  primaryPracticeAddress: string;
  secondaryPracticeAddresses: string[];
};

function cleanNpi(value: unknown) {
  if (value === null || value === undefined) return null;
  const npi = String(value).trim().replace(/\D/g, '');
  return npi.length === 10 ? npi : null;
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function normalizePhone(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '');
}

function normalizeLicense(value: unknown) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function compactCityKey(city: string) {
  return city.trim().replace(/\./g, '').replace(/\s+/g, ' ').toUpperCase();
}

/** NPPES uses USPS-style city names (ST PETERSBURG), not expanded forms (SAINT PETERSBURG). */
export function normalizeCityForNppes(city: string | null) {
  if (!city) return null;
  const key = compactCityKey(city);
  if (key === 'ST PETERSBURG' || key === 'SAINT PETERSBURG' || key === 'ST PETE' || key === 'SAINT PETE') {
    return 'ST PETERSBURG';
  }
  return key;
}

/** Some cities appear under multiple spellings in NPPES; search all variants and merge. */
export function getNppesCitySearchVariants(city: string | null) {
  if (!city) return [] as string[];
  const key = compactCityKey(city);
  if (key === 'ST PETERSBURG' || key === 'SAINT PETERSBURG' || key === 'ST PETE' || key === 'SAINT PETE') {
    return ['ST PETERSBURG', 'SAINT PETERSBURG'];
  }
  const normalized = normalizeCityForNppes(city);
  return normalized ? [normalized] : [];
}

function normalizeStopStreet(street?: string | null) {
  let s = ` ${String(street || '').toUpperCase().trim()} `;
  s = s.replace(/[#.,]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function streetMatches(providerStreet: string | null | undefined, needle: string) {
  if (!needle) return true;
  const left = normalizeStopStreet(providerStreet);
  const right = normalizeStopStreet(needle);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function normalizeZip(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(0, 5) || null;
}

function normalizeCity(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function providerDisplayName(
  isOrganization: boolean,
  basic: AnyRecord,
  organizationName: string | null,
) {
  if (isOrganization && organizationName) return organizationName;
  const parts = [basic.first_name, basic.middle_name, basic.last_name, basic.credential]
    .map((part) => cleanString(part))
    .filter(Boolean);
  return parts.join(' ').trim() || organizationName || 'Unknown provider';
}

function parseTaxonomies(raw: AnyRecord[]): NppesTaxonomy[] {
  return raw.map((entry) => ({
    code: cleanString(entry.code),
    desc: cleanString(entry.desc),
    state: cleanString(entry.state),
    license: normalizeLicense(entry.license),
    primary: entry.primary === true,
  }));
}

export function buildTaxonomySummary(taxonomies: NppesTaxonomy[]) {
  const primaryTaxonomy = taxonomies.find((entry) => entry.primary) || null;
  const selectedTaxonomy = primaryTaxonomy || taxonomies[0] || null;
  const selectedLabel = selectedTaxonomy
    ? `${selectedTaxonomy.code || '—'}${selectedTaxonomy.desc ? ` - ${selectedTaxonomy.desc}` : ''}`
    : '—';

  return {
    primaryTaxonomy: primaryTaxonomy ? 'Yes' : (taxonomies.length ? 'No' : '—'),
    selectedTaxonomy: selectedLabel,
    taxonomyCode: selectedTaxonomy?.code || null,
    taxonomyDesc: selectedTaxonomy?.desc || null,
    taxonomyState: selectedTaxonomy?.state || null,
    licenseNumber: selectedTaxonomy?.license || null,
  };
}

function formatNppesAddressRow(address: AnyRecord) {
  const street = [cleanString(address.address_1), cleanString(address.address_2)]
    .filter(Boolean)
    .join(', ') || cleanString(address.address_1);
  const postalCode = cleanString(address.postal_code)
    ? String(address.postal_code).replace(/\D/g, '').slice(0, 5)
    : null;
  return formatUsAddressFromParts({
    street,
    city: cleanString(address.city),
    state: cleanString(address.state),
    postalCode,
  });
}

function buildPracticeAddresses(addresses: AnyRecord[]) {
  const formatted = addresses
    .map((entry) => ({
      purpose: String(entry.address_purpose || '').toUpperCase(),
      formatted: formatNppesAddressRow(entry),
    }))
    .filter((entry) => entry.formatted);

  const uniqueFormatted = [...new Set(formatted.map((entry) => entry.formatted))];
  const locationEntry = formatted.find((entry) => entry.purpose === 'LOCATION');
  const primaryPracticeAddress = locationEntry?.formatted || uniqueFormatted[0] || '';
  const secondaryPracticeAddresses = uniqueFormatted.filter(
    (address) => address !== primaryPracticeAddress,
  );

  return { primaryPracticeAddress, secondaryPracticeAddresses };
}

function flattenNppesRecord(record: AnyRecord | null | undefined): NppesProvider | null {
  if (!record) return null;
  const basic = (record.basic || {}) as AnyRecord;
  const isOrganization = String(record.enumeration_type || '').toUpperCase() === 'NPI-2';
  const organizationName = cleanString(basic.organization_name);
  const addresses = (record.addresses || []) as AnyRecord[];
  const taxonomies = parseTaxonomies((record.taxonomies || []) as AnyRecord[]);
  const address =
    addresses.find((entry) => entry.address_purpose === 'LOCATION')
    || addresses.find((entry) => entry.address_purpose === 'MAILING')
    || {};
  const taxonomySummary = buildTaxonomySummary(taxonomies);
  const npi = cleanNpi(record.number);
  if (!npi) return null;
  const { primaryPracticeAddress, secondaryPracticeAddresses } = buildPracticeAddresses(addresses);

  return {
    npi,
    providerName: providerDisplayName(isOrganization, basic, organizationName),
    firstName: isOrganization ? null : cleanString(basic.first_name),
    lastName: isOrganization ? organizationName : cleanString(basic.last_name),
    credential: cleanString(basic.credential),
    taxonomyCode: taxonomySummary.taxonomyCode,
    taxonomyDesc: taxonomySummary.taxonomyDesc,
    primaryTaxonomy: taxonomySummary.primaryTaxonomy,
    selectedTaxonomy: taxonomySummary.selectedTaxonomy,
    taxonomyState: taxonomySummary.taxonomyState,
    licenseNumber: taxonomySummary.licenseNumber,
    address1: cleanString(address.address_1),
    address2: cleanString(address.address_2),
    city: cleanString(address.city),
    state: cleanString(address.state),
    postalCode: cleanString(address.postal_code),
    phone: normalizePhone(address.telephone_number) || null,
    isOrganization,
    taxonomies,
    primaryPracticeAddress: primaryPracticeAddress || formatNppesAddressRow(address),
    secondaryPracticeAddresses,
  };
}

function recordMatchesLocation(
  provider: NppesProvider,
  input: { city?: string | null; postalCode?: string | null },
) {
  const targetZip = normalizeZip(input.postalCode);
  const targetCity = normalizeCity(input.city);
  const providerZip = normalizeZip(provider.postalCode);
  const providerCity = normalizeCity(provider.city);

  if (targetZip && providerZip && targetZip === providerZip) return true;
  if (targetCity && providerCity && targetCity === providerCity) return true;
  return !targetZip && !targetCity;
}

async function fetchNppes(params: Record<string, string | number | undefined | null>) {
  const url = new URL(NPPES_API_BASE);
  url.searchParams.set('version', '2.1');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      url.searchParams.set(key, String(value).trim());
    }
  });
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NPPES HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ result_count?: number; results?: AnyRecord[] }>;
}

export async function inferPostalCodeForAddress(input: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  addressText?: string | null;
}) {
  const query = cleanString(input.addressText)
    || [input.street, input.city, input.state || 'FL', 'USA'].filter(Boolean).join(', ');
  if (!query || query.length < 8) return null;

  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&q='
      + encodeURIComponent(query);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'pharmacy-flyer-mobile/1.0', Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json() as Array<{ address?: { postcode?: string } }>;
    const postcode = data[0]?.address?.postcode;
    return postcode ? String(postcode).replace(/\D/g, '').slice(0, 5) || null : null;
  } catch {
    return null;
  }
}

function recordMatchesPhone(record: AnyRecord, phone: string | null) {
  const digits = normalizePhone(phone);
  if (!digits || digits.length < 7) return true;
  const needle = digits.length >= 10 ? digits.slice(-10) : digits;
  const addresses = (record.addresses || []) as AnyRecord[];
  return addresses.some((entry) => {
    const hay = normalizePhone(entry.telephone_number);
    if (!hay) return false;
    if (hay.includes(digits)) return true;
    if (needle.length >= 7 && hay.slice(-10) === needle) return true;
    return false;
  });
}

function recordMatchesStreet(record: AnyRecord, street: string | null) {
  const needle = normalizeStopStreet(street || '');
  if (!needle) return true;
  const addresses = (record.addresses || []) as AnyRecord[];
  return addresses.some(
    (entry) => streetMatches(cleanString(entry.address_1), needle)
      || streetMatches(cleanString(entry.address_2), needle),
  );
}

function buildNppesLocationSearchPlans(input: {
  city?: string | null;
  state: string;
  postalCode?: string | null;
}) {
  const plans: Array<Record<string, string>> = [];
  const seen = new Set<string>();

  const addPlan = (params: Record<string, string>) => {
    const key = JSON.stringify(params);
    if (seen.has(key)) return;
    seen.add(key);
    plans.push(params);
  };

  if (input.postalCode) {
    addPlan({ state: input.state, postal_code: input.postalCode });
  }

  if (input.city) {
    for (const cityVariant of getNppesCitySearchVariants(input.city)) {
      addPlan({ state: input.state, city: cityVariant });
    }
  }

  if (!plans.length) {
    addPlan({ state: input.state });
  }

  return plans;
}

async function fetchNppesLocationBatch(
  baseParams: Record<string, string>,
  input: {
    city?: string | null;
    postalCode?: string | null;
    street?: string | null;
    phone?: string | null;
  },
  byNpi: Map<string, NppesProvider>,
) {
  const phoneDigits = normalizePhone(input.phone);
  const streetNeedle = normalizeStopStreet(input.street || '');
  const needsPostFilter = phoneDigits.length >= 7 || Boolean(streetNeedle);
  const maxSkip = needsPostFilter ? 1000 : 0;

  for (let skip = 0; skip <= maxSkip; skip += 200) {
    const response = await fetchNppes({ ...baseParams, limit: 200, skip });
    const rawResults = response.results || [];
    if (!rawResults.length) break;

    for (const record of rawResults) {
      const provider = flattenNppesRecord(record);
      if (!provider || byNpi.has(provider.npi)) continue;
      if (!recordMatchesLocation(provider, { city: input.city, postalCode: input.postalCode })) continue;
      if (!recordMatchesPhone(record, input.phone ?? null)) continue;
      if (!recordMatchesStreet(record, input.street ?? null)) continue;
      byNpi.set(provider.npi, provider);
    }

    if (rawResults.length < 200) break;
    if (!needsPostFilter) break;
  }
}

export async function searchNppesProvidersByLocation(input: {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  street?: string | null;
  phone?: string | null;
  limit?: number;
  enumerationType?: 'NPI-1' | 'NPI-2';
}) {
  const city = cleanString(input.city);
  const state = cleanString(input.state)?.toUpperCase() || 'FL';
  const postalCode = normalizeZip(input.postalCode);
  const streetNeedle = normalizeStopStreet(input.street || '');
  const phoneDigits = normalizePhone(input.phone);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 1200);
  const enumerationType = input.enumerationType;

  if (!city && !postalCode) {
    return { providers: [] as NppesProvider[], hint: 'City or ZIP from GPS is required for NPI lookup.' };
  }

  const byNpi = new Map<string, NppesProvider>();
  const searchPlans = buildNppesLocationSearchPlans({ city, state, postalCode });

  for (const plan of searchPlans) {
    const params = enumerationType ? { ...plan, enumeration_type: enumerationType } : plan;
    await fetchNppesLocationBatch(params, { city, postalCode, street: input.street, phone: input.phone }, byNpi);
  }

  const allMatches = Array.from(byNpi.values()).filter(
    (provider) => providerMatchesEnumerationType(provider, enumerationType),
  );
  const ranked = streetNeedle
    ? [...allMatches].sort((a, b) => {
        const aMatch = streetMatches(a.address1, streetNeedle) ? 1 : 0;
        const bMatch = streetMatches(b.address1, streetNeedle) ? 1 : 0;
        return bMatch - aMatch;
      })
    : allMatches;

  return {
    providers: ranked.slice(0, limit),
    totalAtLocation: allMatches.length,
    hint: phoneDigits.length >= 7 && !allMatches.length
      ? 'No NPI providers matched this phone at the typed location.'
      : null as string | null,
  };
}

export async function fetchNppesProviderByNpi(npi: string) {
  const cleaned = cleanNpi(npi);
  if (!cleaned) return null;
  const response = await fetchNppes({ number: cleaned, limit: 1 });
  return flattenNppesRecord(response.results?.[0]);
}

export function formatProviderAddress(provider: NppesProvider) {
  const line1 = [provider.address1, provider.address2].filter(Boolean).join(', ');
  const line2 = [provider.city, provider.state, provider.postalCode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  return [line1, line2].filter(Boolean).join(', ');
}

function providerMatchesEnumerationType(
  provider: NppesProvider,
  enumerationType?: 'NPI-1' | 'NPI-2',
) {
  if (!enumerationType) return true;
  if (enumerationType === 'NPI-2') return provider.isOrganization;
  return !provider.isOrganization;
}

export async function searchNppesByLocation(input: {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  street?: string | null;
  phone?: string | null;
  limit?: number;
  enumerationType?: 'NPI-1' | 'NPI-2';
}) {
  return searchNppesProvidersByLocation(input);
}

export function matchesSearchStreet(
  providerStreet: string | null | undefined,
  searchStreet: string | null | undefined,
) {
  if (!searchStreet?.trim()) return false;
  return streetMatches(providerStreet, searchStreet);
}

export function normalizeNppesZip(value: unknown) {
  return normalizeZip(value);
}

export function providerAtSameAddress(individual: NppesProvider, org: NppesProvider) {
  if (individual.isOrganization || !org.isOrganization) return false;
  const targetZip = normalizeZip(org.postalCode);
  const targetCity = normalizeCity(org.city);
  const providerZip = normalizeZip(individual.postalCode);
  const providerCity = normalizeCity(individual.city);
  const zipMatch = Boolean(targetZip && providerZip && targetZip === providerZip);
  const cityMatch = Boolean(targetCity && providerCity && targetCity === providerCity);
  const streetMatch = streetMatches(individual.address1, org.address1 || '');
  return streetMatch && (zipMatch || cityMatch);
}
