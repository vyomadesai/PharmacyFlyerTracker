import { getPool, sql } from '../../config/db.js';
import { normalizeStopStreet } from '../route-planner/routePlannerGeo.js';
import {
  addressesLikelySame,
  citiesMatch,
  normalizePostalCode,
  standardizeAddress,
  type StandardizedAddress,
} from '../../utils/standardizeAddress.js';
import { stripSuiteFromStreet } from '../../utils/streetAddressMatch.js';
import {
  attachDistanceToRecords,
  boundingBoxForRadius,
  ensureLocationCoordinates,
  filterGroupsByRadius,
  isPlausibleFloridaCoord,
} from './npiRegistryGeocode.js';

export type NpiRegistryRecord = {
  registryProviderId: number;
  npi: string;
  providerName: string;
  npiType: string;
  status: string;
  phone: string | null;
  fax: string | null;
  street: string | null;
  city: string | null;
  state: string;
  postalCode: string | null;
  formattedAddress: string;
  taxonomyCode: string | null;
  taxonomyDescription: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
  isOrganization: boolean;
  isPrimaryTaxonomy: boolean;
  standardized: StandardizedAddress;
  latitude?: number | null;
  longitude?: number | null;
  distanceMiles?: number | null;
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeNpi(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

function parseCoord(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapRow(row: Record<string, unknown>): NpiRegistryRecord | null {
  const npi = normalizeNpi(clean(row.Npi));
  if (npi.length !== 10) return null;

  const street = clean(row.PrimaryStreetLine1);
  const city = clean(row.PrimaryCity);
  const state = clean(row.PrimaryState) || 'FL';
  const postalCode = normalizePostalCode(clean(row.PrimaryPostalCode));
  const standardized = standardizeAddress({ street, city, state, postalCode });
  const npiType = clean(row.NpiType) || '';
  const taxonomyCode = clean(row.TaxonomyCode);
  const taxonomyDescription = clean(row.TaxonomyDescription);

  const mapped: NpiRegistryRecord = {
    registryProviderId: Number(row.RegistryProviderId) || 0,
    npi,
    providerName: clean(row.ProviderName) || npi,
    npiType,
    status: clean(row.Status) || 'Active',
    phone: clean(row.PrimaryPhone),
    fax: clean(row.PrimaryFax),
    street,
    city,
    state,
    postalCode,
    formattedAddress: standardized.formattedAddress,
    taxonomyCode,
    taxonomyDescription,
    taxonomyState: clean(row.TaxonomyState),
    licenseNumber: clean(row.LicenseNumber),
    isOrganization: /NPI-2/i.test(npiType),
    isPrimaryTaxonomy: row.IsPrimary === true || row.IsPrimary === 1,
    standardized,
    latitude: parseCoord(row.PrimaryLatitude),
    longitude: parseCoord(row.PrimaryLongitude),
  };
  if (!isPlausibleFloridaCoord(mapped.latitude ?? null, mapped.longitude ?? null)) {
    mapped.latitude = null;
    mapped.longitude = null;
  }
  return mapped;
}

export async function lookupNpiRegistryAtAddress(input: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}) {
  const target = standardizeAddress({
    street: input.street,
    city: input.city,
    state: input.state || 'FL',
    postalCode: input.postalCode,
  });
  const postalCode = target.postalCode;
  const city = target.city;
  const buildingStreet = target.buildingStreetKey;

  if (!postalCode && !city && !buildingStreet) {
    return { records: [] as NpiRegistryRecord[], hint: 'Address required for local NPI lookup.' };
  }

  const pool = await getPool();
  const request = pool.request();
  const whereParts: string[] = [`p.Status = 'Active'`];

  if (postalCode) {
    request.input('PostalCode', sql.VarChar(20), postalCode);
    whereParts.push(`LEFT(REPLACE(p.PrimaryPostalCode, ' ', ''), 5) = @PostalCode`);
  } else if (city) {
    request.input('CityKey', sql.NVarChar, city.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    whereParts.push(`REPLACE(REPLACE(UPPER(p.PrimaryCity), '.', ''), ' ', '') LIKE '%' + @CityKey + '%'`);
  }

  const result = await request.query(`
    SELECT
      p.RegistryProviderId,
      p.Npi,
      p.ProviderName,
      p.NpiType,
      p.Status,
      p.PrimaryStreetLine1,
      p.PrimaryCity,
      p.PrimaryState,
      p.PrimaryPostalCode,
      p.PrimaryPhone,
      p.PrimaryFax,
      p.PrimaryLatitude,
      p.PrimaryLongitude,
      t.TaxonomyCode,
      t.TaxonomyDescription,
      t.TaxonomyState,
      t.LicenseNumber,
      t.IsPrimary
    FROM dbo.PharmacyFlyer_NPI_Registry_Data p
    LEFT JOIN dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy t
      ON t.RegistryProviderId = p.RegistryProviderId
      AND t.IsPrimary = 1
    WHERE ${whereParts.join(' AND ')}
    ORDER BY p.ProviderName, p.Npi
  `);

  const byNpi = new Map<string, NpiRegistryRecord>();
  for (const row of result.recordset as Record<string, unknown>[]) {
    const mapped = mapRow(row);
    if (!mapped) continue;
    if (!buildingStreet) {
      byNpi.set(mapped.npi, mapped);
      continue;
    }
    const candidateStreet = normalizeStopStreet(stripSuiteFromStreet(mapped.street || ''));
    const sameStreet = candidateStreet === buildingStreet
      || candidateStreet.startsWith(buildingStreet)
      || buildingStreet.startsWith(candidateStreet);
    const sameZip = !postalCode || mapped.postalCode === postalCode;
    const sameCity = citiesMatch(mapped.city, target.city);
    if (sameStreet && (sameZip || sameCity)) {
      byNpi.set(mapped.npi, mapped);
      continue;
    }
    if (
      addressesLikelySame(
        { street: mapped.street, city: mapped.city, state: mapped.state, postalCode: mapped.postalCode },
        { street: target.street, city: target.city, state: target.state, postalCode: target.postalCode },
      )
    ) {
      byNpi.set(mapped.npi, mapped);
    }
  }

  const records = [...byNpi.values()];
  return {
    records,
    hint: records.length
      ? `${records.length} local NPI record(s) at this address`
      : 'No local NPI registry matches at this address.',
  };
}

const MAX_GEOCODE_GROUPS_PER_LOOKUP = 60;

export type NpiLocationGroup = {
  locationKey: string;
  formattedAddress: string;
  street: string | null;
  city: string | null;
  state: string;
  postalCode: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  records: NpiRegistryRecord[];
};

export async function lookupNpiRegistryNearby(input: {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  postalCode?: string | null;
  maxGeocodeGroups?: number;
}) {
  const pool = await getPool();
  const postalCode = normalizePostalCode(input.postalCode);
  const zipPrefix = postalCode ? postalCode.slice(0, 3) : '337';
  const box = boundingBoxForRadius(input.latitude, input.longitude, input.radiusMiles);

  const request = pool.request()
    .input('ZipPrefix', sql.VarChar(5), `${zipPrefix}%`)
    .input('MinLat', sql.Decimal(10, 7), box.minLat)
    .input('MaxLat', sql.Decimal(10, 7), box.maxLat)
    .input('MinLng', sql.Decimal(10, 7), box.minLng)
    .input('MaxLng', sql.Decimal(10, 7), box.maxLng);

  const result = await request.query(`
    SELECT
      p.RegistryProviderId,
      p.Npi,
      p.ProviderName,
      p.NpiType,
      p.Status,
      p.PrimaryStreetLine1,
      p.PrimaryCity,
      p.PrimaryState,
      p.PrimaryPostalCode,
      p.PrimaryPhone,
      p.PrimaryFax,
      p.PrimaryLatitude,
      p.PrimaryLongitude,
      t.TaxonomyCode,
      t.TaxonomyDescription,
      t.TaxonomyState,
      t.LicenseNumber,
      t.IsPrimary
    FROM dbo.PharmacyFlyer_NPI_Registry_Data p
    LEFT JOIN dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy t
      ON t.RegistryProviderId = p.RegistryProviderId
      AND t.IsPrimary = 1
    WHERE p.Status = 'Active'
      AND p.PrimaryLatitude IS NOT NULL
      AND p.PrimaryLongitude IS NOT NULL
      AND p.PrimaryLatitude BETWEEN @MinLat AND @MaxLat
      AND p.PrimaryLongitude BETWEEN @MinLng AND @MaxLng
    ORDER BY p.PrimaryPostalCode, p.PrimaryStreetLine1, p.ProviderName
  `);

  const byNpi = new Map<string, NpiRegistryRecord>();
  for (const row of result.recordset as Record<string, unknown>[]) {
    const mapped = mapRow(row);
    if (!mapped) continue;
    byNpi.set(mapped.npi, mapped);
  }

  const locationGroups = groupNpiRegistryByLocation([...byNpi.values()]);
  const targetZip = postalCode || zipPrefix;
  const sortedGroups = [...locationGroups].sort((a, b) => {
    const aZip = a.postalCode?.slice(0, 5) || '';
    const bZip = b.postalCode?.slice(0, 5) || '';
    const aSameZip = aZip === targetZip ? 0 : 1;
    const bSameZip = bZip === targetZip ? 0 : 1;
    if (aSameZip !== bSameZip) return aSameZip - bSameZip;
    return a.formattedAddress.localeCompare(b.formattedAddress);
  });

  const withStoredCoords = sortedGroups.filter(
    (group) => group.records[0]?.latitude != null && group.records[0]?.longitude != null,
  );
  const needsGeocode = sortedGroups.filter(
    (group) => group.records[0]?.latitude == null || group.records[0]?.longitude == null,
  );
  const geocodeCandidates = needsGeocode.slice(0, input.maxGeocodeGroups ?? MAX_GEOCODE_GROUPS_PER_LOOKUP);
  const groupsToResolve = [...withStoredCoords, ...geocodeCandidates];

  const coords = await ensureLocationCoordinates(
    groupsToResolve.map((group) => ({
      locationKey: group.locationKey,
      street: group.street,
      city: group.city,
      state: group.state,
      postalCode: group.postalCode,
      latitude: group.records[0]?.latitude ?? null,
      longitude: group.records[0]?.longitude ?? null,
    })),
    { persist: true },
  );

  const withinRadius = filterGroupsByRadius(
    groupsToResolve,
    coords,
    input.latitude,
    input.longitude,
    input.radiusMiles,
  );

  const groups: NpiLocationGroup[] = withinRadius.map((group) => ({
    locationKey: group.locationKey,
    formattedAddress: group.formattedAddress,
    street: group.street,
    city: group.city,
    state: group.state,
    postalCode: group.postalCode,
    phone: group.phone,
    latitude: group.latitude,
    longitude: group.longitude,
    distanceMiles: group.distanceMiles,
    records: attachDistanceToRecords(group.records, group),
  }));

  const records = groups.flatMap((group) => group.records);
  return {
    records,
    groups,
    radiusMiles: input.radiusMiles,
    zipPrefix,
  };
}

export function groupNpiRegistryByLocation(records: NpiRegistryRecord[]) {
  const groups = new Map<string, {
    locationKey: string;
    formattedAddress: string;
    street: string | null;
    city: string | null;
    state: string;
    postalCode: string | null;
    phone: string | null;
    records: NpiRegistryRecord[];
  }>();

  for (const record of records) {
    const key = record.standardized.locationKey;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        locationKey: key,
        formattedAddress: record.formattedAddress,
        street: record.street,
        city: record.city,
        state: record.state,
        postalCode: record.postalCode,
        phone: record.phone,
        records: [record],
      });
      continue;
    }
    existing.records.push(record);
    if (!existing.phone && record.phone) existing.phone = record.phone;
  }

  return [...groups.values()];
}
