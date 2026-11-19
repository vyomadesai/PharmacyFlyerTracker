import { getPool } from '../../config/db.js';
import {
  formatProviderAddress,
  inferPostalCodeForAddress,
  searchNppesProvidersByLocation,
  type NppesProvider,
} from '../../services/nppesLookup.js';

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

export type NewProviderResult = NppesProvider & {
  providerAddress: string;
};

function buildLookupSummary(newCount: number, alreadyKnownCount: number) {
  const parts: string[] = [];
  if (newCount > 0) {
    parts.push(`${newCount} at this location`);
  }
  if (alreadyKnownCount > 0) {
    parts.push(`${alreadyKnownCount} already in database`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export async function lookupProvidersAtLocation(input: {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  street?: string | null;
  phone?: string | null;
  addressText?: string | null;
}) {
  let postalCode = input.postalCode || null;
  if (!postalCode) {
    postalCode = await inferPostalCodeForAddress({
      street: input.street,
      city: input.city,
      state: input.state,
      addressText: input.addressText,
    });
  }

  const search = await searchNppesProvidersByLocation({
    city: input.city,
    state: input.state,
    postalCode,
    street: input.street,
    phone: input.phone,
    limit: 1200,
  });

  const nppesMatches = search.providers;

  if (!nppesMatches.length) {
    return {
      providers: [] as NewProviderResult[],
      newCount: 0,
      alreadyKnownCount: 0,
      summaryHint: null,
      hint: search.hint
        || (input.street
          ? 'No NPI providers matched this street at the typed location. Try NPI Records Lookup without changing the street, or verify the address.'
          : 'No NPI providers found for this city/ZIP.'),
    };
  }

  const existing = await loadExistingNpis(nppesMatches.map((provider) => provider.npi));
  const newProviders = nppesMatches
    .filter((provider) => !existing.has(provider.npi))
    .map((provider) => ({
      ...provider,
      providerAddress: formatProviderAddress(provider),
    }));
  const matchedCount = nppesMatches.length - newProviders.length;
  const summaryHint = buildLookupSummary(newProviders.length, matchedCount);

  return {
    providers: newProviders,
    newCount: newProviders.length,
    alreadyKnownCount: matchedCount,
    summaryHint,
    hint: newProviders.length
      ? null
      : matchedCount
        ? `All ${matchedCount} NPI provider(s) at this location are already in Master_Doctor.`
        : search.hint,
  };
}
