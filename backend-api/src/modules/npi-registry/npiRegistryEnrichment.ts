import { getPool } from '../../config/db.js';
import type { AddressProviderResult } from '../new-entries/newEntriesProvidersAtAddress.js';
import type { NearbyOrgResult } from '../new-entries/newEntriesNearbyOrgs.js';
import { addressesLikelySame } from '../../utils/standardizeAddress.js';
import {
  lookupNpiRegistryAtAddress,
  lookupNpiRegistryNearby,
  type NpiRegistryRecord,
} from './npiRegistryLocationLookup.js';

const PRESCRIBER_CODE_PREFIXES = ['207', '208', '209', '363L', '363A', '363LF', '364S'];

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

function classifyProvider(record: NpiRegistryRecord) {
  const code = String(record.taxonomyCode || '').trim().toUpperCase();
  const desc = String(record.taxonomyDescription || '').trim().toUpperCase();
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
  } else if (record.taxonomyDescription?.trim()) {
    providerCategory = record.taxonomyDescription.trim();
  }

  return { isPrescriber, providerCategory };
}

function recordAtSearchAddress(
  record: NpiRegistryRecord,
  input: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  },
) {
  return addressesLikelySame(
    {
      street: record.street,
      city: record.city,
      state: record.state,
      postalCode: record.postalCode,
    },
    {
      street: input.street,
      city: input.city,
      state: input.state || 'FL',
      postalCode: input.postalCode,
    },
  );
}

function toOrgResult(
  record: NpiRegistryRecord,
  distanceMiles: number,
  atSearchAddress: boolean,
): NearbyOrgResult {
  return {
    npi: record.npi,
    organizationName: record.providerName,
    taxonomyDesc: record.taxonomyDescription,
    taxonomyCode: record.taxonomyCode,
    phone: record.phone,
    organizationAddress: record.formattedAddress,
    suiteLabel: null,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    atSearchAddress,
  };
}

function toProviderResult(record: NpiRegistryRecord, alreadyKnown: boolean): AddressProviderResult {
  const { isPrescriber, providerCategory } = classifyProvider(record);
  return {
    npi: record.npi,
    providerName: record.providerName,
    taxonomyDesc: record.taxonomyDescription,
    taxonomyCode: record.taxonomyCode,
    phone: record.phone,
    providerAddress: record.formattedAddress,
    alreadyKnown,
    isPrescriber,
    providerCategory,
  };
}

export async function buildLocalRegistryEnrichment(input: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMiles?: number;
  /** When false (default for stop check-in), only same standardized address — not radius nearby. */
  includeNearby?: boolean;
}) {
  const state = String(input.state || 'FL').trim().toUpperCase();
  const atAddress = await lookupNpiRegistryAtAddress({
    street: input.street,
    city: input.city,
    state,
    postalCode: input.postalCode,
  });

  const nearby = input.includeNearby && input.latitude != null && input.longitude != null
    ? await lookupNpiRegistryNearby({
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMiles: input.radiusMiles ?? 0.5,
        postalCode: input.postalCode,
      })
    : { records: [] as NpiRegistryRecord[], groups: [], radiusMiles: input.radiusMiles ?? 0.5 };

  const byNpi = new Map<string, NpiRegistryRecord & { atSearchAddress: boolean; distanceMiles: number }>();
  for (const record of atAddress.records) {
    byNpi.set(record.npi, {
      ...record,
      atSearchAddress: true,
      distanceMiles: 0,
    });
  }
  for (const record of nearby.records) {
    const existing = byNpi.get(record.npi);
    if (existing) {
      if ((record.distanceMiles ?? 999) < existing.distanceMiles) {
        byNpi.set(record.npi, {
          ...existing,
          ...record,
          atSearchAddress: existing.atSearchAddress,
          distanceMiles: record.distanceMiles ?? existing.distanceMiles,
        });
      }
      continue;
    }
    byNpi.set(record.npi, {
      ...record,
      atSearchAddress: recordAtSearchAddress(record, input),
      distanceMiles: record.distanceMiles ?? 0,
    });
  }

  const records = [...byNpi.values()];
  const individuals = records.filter((record) => !record.isOrganization);
  const organizationsAtAddress = records.filter((record) => record.isOrganization);
  const existingNpis = await loadExistingNpis(individuals.map((record) => record.npi));

  const organizations: NearbyOrgResult[] = organizationsAtAddress.map((record) =>
    toOrgResult(record, record.distanceMiles, record.atSearchAddress),
  );
  const allProviders: AddressProviderResult[] = individuals.map((record) =>
    toProviderResult(record, existingNpis.has(record.npi)),
  );

  organizations.sort((a, b) => a.distanceMiles - b.distanceMiles);
  const newProviders = allProviders.filter((provider) => !provider.alreadyKnown);
  const prescriberCount = allProviders.filter((provider) => provider.isPrescriber).length;

  const hint = [
    atAddress.records.filter((r) => !r.isOrganization).length
      ? `${atAddress.records.filter((r) => !r.isOrganization).length} individual(s) at this address`
      : null,
    atAddress.records.filter((r) => r.isOrganization).length
      ? `${atAddress.records.filter((r) => r.isOrganization).length} organization(s) at this address`
      : null,
    nearby.records.length ? `${nearby.records.length} within ${nearby.radiusMiles} mi` : null,
  ].filter(Boolean).join(' · ') || 'No local NPI registry matches at this address.';

  return {
    records: individuals,
    organizationRecords: organizationsAtAddress,
    organizations,
    allProviders,
    newProviders,
    alreadyKnownCount: allProviders.length - newProviders.length,
    prescriberCount,
    summaryHint: [
      newProviders.length > 0 ? `${newProviders.length} new nearby` : null,
      allProviders.length - newProviders.length > 0
        ? `${allProviders.length - newProviders.length} already in database`
        : null,
    ].filter(Boolean).join(' · ') || hint,
    lookupHint: hint,
  };
}
