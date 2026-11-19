import { getPool } from '../../config/db.js';
import {
  formatProviderAddress,
  searchNppesByLocation,
  type NppesProvider,
} from '../../services/nppesLookup.js';
import { parseStreetWithSuite, providerMatchesSearchStreet } from '../../utils/streetAddressMatch.js';

export type AddressProviderResult = {
  npi: string;
  providerName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  providerAddress: string;
  alreadyKnown: boolean;
  isPrescriber: boolean;
  providerCategory: string;
};

async function loadExistingNpis(npis: string[]) {
  const unique = [...new Set(npis.filter(Boolean))];
  if (!unique.length) return new Set<string>();

  const pool = await getPool();
  const placeholders = unique.map((_, index) => `@Npi${index}`).join(', ');
  const request = pool.request();
  unique.forEach((npi, index) => request.input(`Npi${index}`, npi));

  const result = await request.query(`
    SELECT LTRIM(RTRIM(ISNULL(Doctor_NPINo, ''))) AS Npi
    FROM dbo.Master_Doctor
    WHERE LTRIM(RTRIM(ISNULL(Doctor_NPINo, ''))) IN (${placeholders})
  `);

  return new Set(
    (result.recordset as Array<{ Npi?: string }>)
      .map((row) => String(row.Npi || '').replace(/\D/g, ''))
      .filter((npi) => npi.length === 10),
  );
}

const PRESCRIBER_CODE_PREFIXES = ['207', '208', '209', '363L', '363A', '363LF', '364S'];

function classifyProvider(provider: NppesProvider) {
  const code = String(provider.taxonomyCode || '').trim().toUpperCase();
  const desc = String(provider.taxonomyDesc || '').trim().toUpperCase();
  const isPrescriber = PRESCRIBER_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))
    || /\b(MD|DO|DPM|DDS|DMD|NP|PA|APRN|PHYSICIAN|PRESCRIBER)\b/.test(desc);

  let providerCategory = 'Other';
  if (/\b(MD|DO|PHYSICIAN|SURGEON|INTERNIST|FAMILY)\b/.test(desc) || code.startsWith('207') || code.startsWith('208')) {
    providerCategory = 'Doctor';
  } else if (/\b(NP|NURSE PRACTITIONER|PA\b|PHYSICIAN ASSISTANT|APRN)\b/.test(desc) || code.startsWith('363')) {
    providerCategory = 'NP/PA';
  } else if (/\bPSYCHOLOGIST\b/.test(desc) || code.startsWith('103')) {
    providerCategory = 'Psychologist';
  } else if (/\b(THERAPIST|COUNSELOR|SOCIAL WORK|MFT|LMFT|LPC)\b/.test(desc)) {
    providerCategory = 'Therapist';
  } else if (isPrescriber) {
    providerCategory = 'Prescriber';
  } else if (provider.taxonomyDesc?.trim()) {
    providerCategory = provider.taxonomyDesc.trim();
  }

  return { isPrescriber, providerCategory };
}

function toProviderResult(provider: NppesProvider, alreadyKnown: boolean): AddressProviderResult {
  const { isPrescriber, providerCategory } = classifyProvider(provider);
  return {
    npi: provider.npi,
    providerName: provider.providerName,
    taxonomyDesc: provider.taxonomyDesc,
    taxonomyCode: provider.taxonomyCode,
    phone: provider.phone,
    providerAddress: formatProviderAddress(provider),
    alreadyKnown,
    isPrescriber,
    providerCategory,
  };
}

export async function lookupProvidersAtAddress(input: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  exactSuite?: boolean;
}) {
  const city = String(input.city || '').trim() || null;
  const state = String(input.state || 'FL').trim().toUpperCase();
  const postalCode = String(input.postalCode || '').replace(/\D/g, '').slice(0, 5) || null;
  const street = String(input.street || '').trim() || null;

  if (!city && !postalCode) {
    return { error: 'City or ZIP is required to search providers at this address.' } as const;
  }

  const parsedStreet = street ? parseStreetWithSuite(street) : null;
  const nppesStreetFilter = parsedStreet?.buildingStreet || street;

  const search = await searchNppesByLocation({
    city,
    state,
    postalCode,
    street: nppesStreetFilter,
    limit: 1200,
    enumerationType: 'NPI-1',
  });

  const streetFilter = input.exactSuite && street ? street : street;
  const atAddress = search.providers.filter((provider) => {
    if (provider.isOrganization) return false;
    if (!streetFilter) return true;
    return providerMatchesSearchStreet(provider, streetFilter);
  });

  const existing = await loadExistingNpis(atAddress.map((provider) => provider.npi));
  const allProviders = atAddress.map((provider) => toProviderResult(provider, existing.has(provider.npi)));
  const newProviders = allProviders.filter((provider) => !provider.alreadyKnown);
  const prescriberCount = allProviders.filter((provider) => provider.isPrescriber).length;

  return {
    providers: newProviders,
    allProviders,
    newCount: newProviders.length,
    alreadyKnownCount: allProviders.length - newProviders.length,
    prescriberCount,
    nonPrescriberCount: allProviders.length - prescriberCount,
    summaryHint: [
      newProviders.length > 0 ? `${newProviders.length} new at this address` : null,
      allProviders.length - newProviders.length > 0
        ? `${allProviders.length - newProviders.length} already in database`
        : null,
    ].filter(Boolean).join(' · ') || null,
  };
}
