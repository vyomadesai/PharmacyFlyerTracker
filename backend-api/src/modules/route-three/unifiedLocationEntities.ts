import type {
  FrontendEntityStatus,
  MatchConfidence,
  RouteThreeConfiguredDoctor,
  RouteThreeLocationMappedDoctor,
  RouteThreeMasterDoctorAtAddress,
  RouteThreeOrganization,
  RouteThreeProvider,
} from '../route-three/routeThreeEnrichment.js';
import type { NpiRegistryRecord } from '../npi-registry/npiRegistryLocationLookup.js';

export type UnifiedEntitySource =
  | 'mapped'
  | 'unmapped'
  | 'master_doctor'
  | 'npi_registry'
  | 'npi_live';

export type UnifiedEntityComparison = {
  field: 'name' | 'phone' | 'specialty' | 'address';
  values: Array<{ source: UnifiedEntitySource; value: string }>;
};

export type UnifiedLocationEntity = {
  entityKey: string;
  npi: string | null;
  doctorId: number | null;
  routePlanDropId: number | null;
  registryProviderId: number | null;
  displayName: string;
  phone: string | null;
  specialty: string | null;
  taxonomyCode: string | null;
  address: string | null;
  isOrganization: boolean;
  source: UnifiedEntitySource;
  sources: UnifiedEntitySource[];
  flyerTitle: string | null;
  campaignName: string | null;
  campaignId: number | null;
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
  alreadyKnown: boolean;
  comparisons: UnifiedEntityComparison[];
};

type RawEntity = {
  entityKey: string;
  npi: string | null;
  doctorId: number | null;
  routePlanDropId: number | null;
  registryProviderId: number | null;
  displayName: string;
  phone: string | null;
  specialty: string | null;
  taxonomyCode: string | null;
  address: string | null;
  isOrganization: boolean;
  source: UnifiedEntitySource;
  flyerTitle: string | null;
  campaignName: string | null;
  campaignId: number | null;
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
  alreadyKnown: boolean;
};

const SOURCE_PRIORITY: Record<UnifiedEntitySource, number> = {
  mapped: 5,
  unmapped: 4,
  master_doctor: 4,
  npi_registry: 3,
  npi_live: 2,
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeNpi(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

function normalizePhone(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickPrimarySource(sources: UnifiedEntitySource[]): UnifiedEntitySource {
  return [...sources].sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a])[0];
}

function buildComparisons(variants: RawEntity[]): UnifiedEntityComparison[] {
  const fields: Array<UnifiedEntityComparison['field']> = ['name', 'phone', 'specialty', 'address'];
  const comparisons: UnifiedEntityComparison[] = [];

  for (const field of fields) {
    const values = variants.map((variant) => {
      let value = '';
      if (field === 'name') value = variant.displayName || '';
      if (field === 'phone') value = variant.phone || '';
      if (field === 'specialty') value = variant.specialty || '';
      if (field === 'address') value = variant.address || '';
      return { source: variant.source, value: value.trim() };
    }).filter((entry) => entry.value);

    const unique = new Set(values.map((entry) => entry.value.toLowerCase()));
    if (unique.size > 1) {
      comparisons.push({ field, values });
    }
  }

  return comparisons;
}

function mergeVariants(variants: RawEntity[]): UnifiedLocationEntity {
  const sources = [...new Set(variants.map((variant) => variant.source))];
  const primarySource = pickPrimarySource(sources);
  const primary = variants.find((variant) => variant.source === primarySource) || variants[0];
  const npi = variants.map((variant) => normalizeNpi(variant.npi)).find((value) => value.length === 10) || null;

  return {
    entityKey: npi ? `npi:${npi}` : primary.entityKey,
    npi,
    doctorId: variants.find((variant) => variant.doctorId)?.doctorId ?? null,
    routePlanDropId: variants.find((variant) => variant.routePlanDropId)?.routePlanDropId ?? null,
    registryProviderId: variants.find((variant) => variant.registryProviderId)?.registryProviderId ?? null,
    displayName: primary.displayName,
    phone: variants.find((variant) => variant.phone)?.phone ?? null,
    specialty: variants.find((variant) => variant.specialty)?.specialty ?? null,
    taxonomyCode: variants.find((variant) => variant.taxonomyCode)?.taxonomyCode ?? null,
    address: variants.find((variant) => variant.address)?.address ?? null,
    isOrganization: variants.some((variant) => variant.isOrganization),
    source: primarySource,
    sources,
    flyerTitle: variants.find((variant) => variant.flyerTitle)?.flyerTitle ?? null,
    campaignName: variants.find((variant) => variant.campaignName)?.campaignName ?? null,
    campaignId: variants.find((variant) => variant.campaignId)?.campaignId ?? null,
    frontendStatus: primary.frontendStatus,
    matchReason: primary.matchReason,
    matchConfidence: primary.matchConfidence,
    alreadyKnown: variants.some((variant) => variant.alreadyKnown),
    comparisons: buildComparisons(variants),
  };
}

function groupVariants(variants: RawEntity[]) {
  const byNpi = new Map<string, RawEntity[]>();
  const noNpi: RawEntity[] = [];

  for (const variant of variants) {
    const npi = normalizeNpi(variant.npi);
    if (npi.length === 10) {
      const bucket = byNpi.get(npi) || [];
      bucket.push(variant);
      byNpi.set(npi, bucket);
      continue;
    }
    noNpi.push(variant);
  }

  const merged: UnifiedLocationEntity[] = [...byNpi.values()].map((group) => mergeVariants(group));

  for (const variant of noNpi) {
    const existingIndex = merged.findIndex((entity) => {
      if (variant.doctorId && entity.doctorId === variant.doctorId) return true;
      const sameName = normalizeName(entity.displayName) === normalizeName(variant.displayName);
      const leftPhone = normalizePhone(entity.phone);
      const rightPhone = normalizePhone(variant.phone);
      return sameName && leftPhone.length >= 7 && leftPhone === rightPhone;
    });
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      const recombined = mergeVariants([
        ...variants.filter((v) => existing.sources.includes(v.source) || v.entityKey === variant.entityKey),
      ]);
      merged[existingIndex] = recombined;
      continue;
    }
    merged.push(mergeVariants([variant]));
  }

  return merged.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function organizationEntitySource(org: RouteThreeOrganization): UnifiedEntitySource {
  const raw = String(org.source || '').toLowerCase();
  if (raw.includes('registry') || raw.includes('local')) return 'npi_registry';
  return 'npi_live';
}

export function buildUnifiedLocationEntities(input: {
  configuredDoctors: RouteThreeConfiguredDoctor[];
  locationMappedDoctors: RouteThreeLocationMappedDoctor[];
  masterDoctorsAtAddress: RouteThreeMasterDoctorAtAddress[];
  organizations: RouteThreeOrganization[];
  allProviders: RouteThreeProvider[];
  npiRegistryRecords: NpiRegistryRecord[];
  npiRegistryOrganizations?: NpiRegistryRecord[];
}) {
  const variants: RawEntity[] = [];
  const flyerByDoctorId = new Map(
    input.configuredDoctors
      .filter((doctor) => doctor.doctorId > 0)
      .map((doctor) => [doctor.doctorId, doctor]),
  );

  for (const doctor of input.locationMappedDoctors) {
    const flyer = flyerByDoctorId.get(doctor.doctorId);
    variants.push({
      entityKey: `mapped:${doctor.doctorId}`,
      npi: doctor.npi,
      doctorId: doctor.doctorId,
      routePlanDropId: flyer?.routePlanDropId ?? null,
      registryProviderId: null,
      displayName: doctor.doctorName || 'Doctor',
      phone: doctor.phone,
      specialty: doctor.matchedSpecialityCode,
      taxonomyCode: doctor.matchedSpecialityCode,
      address: null,
      isOrganization: false,
      source: 'mapped',
      flyerTitle: flyer?.flyerTitle ?? null,
      campaignName: flyer?.campaignName ?? null,
      campaignId: flyer?.campaignId ?? null,
      frontendStatus: flyer ? 'known' : doctor.frontendStatus,
      matchReason: flyer
        ? `${doctor.matchReason} · On today's flyer list`
        : doctor.matchReason,
      matchConfidence: doctor.matchConfidence,
      alreadyKnown: true,
    });
  }

  for (const doctor of input.masterDoctorsAtAddress) {
    variants.push({
      entityKey: `master_doctor:${doctor.doctorId}`,
      npi: doctor.npi,
      doctorId: doctor.doctorId,
      routePlanDropId: null,
      registryProviderId: null,
      displayName: doctor.doctorName || 'Doctor',
      phone: doctor.phone,
      specialty: doctor.matchedSpecialityCode,
      taxonomyCode: doctor.matchedSpecialityCode,
      address: null,
      isOrganization: false,
      source: 'master_doctor',
      flyerTitle: null,
      campaignName: null,
      campaignId: null,
      frontendStatus: doctor.frontendStatus,
      matchReason: doctor.matchReason,
      matchConfidence: doctor.matchConfidence,
      alreadyKnown: true,
    });
  }

  for (const doctor of input.configuredDoctors) {
    if (doctor.doctorId > 0 && input.locationMappedDoctors.some((mapped) => mapped.doctorId === doctor.doctorId)) {
      continue;
    }
    variants.push({
      entityKey: `mapped:${doctor.doctorId}:${doctor.routePlanDropId ?? 'none'}`,
      npi: doctor.npi,
      doctorId: doctor.doctorId,
      routePlanDropId: doctor.routePlanDropId,
      registryProviderId: null,
      displayName: doctor.doctorName || 'Doctor',
      phone: doctor.phone,
      specialty: doctor.matchedSpecialityCode,
      taxonomyCode: doctor.matchedSpecialityCode,
      address: null,
      isOrganization: false,
      source: 'mapped',
      flyerTitle: doctor.flyerTitle,
      campaignName: doctor.campaignName,
      campaignId: doctor.campaignId,
      frontendStatus: doctor.frontendStatus,
      matchReason: doctor.matchReason,
      matchConfidence: doctor.matchConfidence,
      alreadyKnown: true,
    });
  }

  for (const org of input.organizations) {
    variants.push({
      entityKey: `org:${org.npi}`,
      npi: org.npi,
      doctorId: null,
      routePlanDropId: null,
      registryProviderId: null,
      displayName: org.organizationName,
      phone: org.phone,
      specialty: org.taxonomyDesc,
      taxonomyCode: org.taxonomyCode,
      address: org.organizationAddress,
      isOrganization: true,
      source: organizationEntitySource(org),
      flyerTitle: null,
      campaignName: null,
      campaignId: null,
      frontendStatus: org.frontendStatus,
      matchReason: org.matchReason,
      matchConfidence: org.matchConfidence,
      alreadyKnown: false,
    });
  }

  for (const provider of input.allProviders) {
    variants.push({
      entityKey: `provider:${provider.npi}`,
      npi: provider.npi,
      doctorId: null,
      routePlanDropId: null,
      registryProviderId: null,
      displayName: provider.providerName,
      phone: provider.phone,
      specialty: provider.taxonomyDesc,
      taxonomyCode: provider.taxonomyCode,
      address: provider.providerAddress,
      isOrganization: false,
      source: 'npi_live',
      flyerTitle: null,
      campaignName: null,
      campaignId: null,
      frontendStatus: provider.frontendStatus,
      matchReason: provider.matchReason,
      matchConfidence: provider.matchConfidence,
      alreadyKnown: provider.alreadyKnown,
    });
  }

  for (const record of input.npiRegistryRecords) {
    if (record.isOrganization) continue;
    variants.push({
      entityKey: `registry:${record.npi}`,
      npi: record.npi,
      doctorId: null,
      routePlanDropId: null,
      registryProviderId: record.registryProviderId,
      displayName: record.providerName,
      phone: record.phone,
      specialty: record.taxonomyDescription || record.taxonomyCode,
      taxonomyCode: record.taxonomyCode,
      address: record.formattedAddress,
      isOrganization: false,
      source: 'npi_registry',
      flyerTitle: null,
      campaignName: null,
      campaignId: null,
      frontendStatus: 'new_provider',
      matchReason: 'Local NPI registry at this address',
      matchConfidence: 'high',
      alreadyKnown: false,
    });
  }

  for (const record of input.npiRegistryOrganizations || []) {
    if (!record.isOrganization) continue;
    variants.push({
      entityKey: `registry-org:${record.npi}`,
      npi: record.npi,
      doctorId: null,
      routePlanDropId: null,
      registryProviderId: record.registryProviderId,
      displayName: record.providerName,
      phone: record.phone,
      specialty: record.taxonomyDescription || record.taxonomyCode,
      taxonomyCode: record.taxonomyCode,
      address: record.formattedAddress,
      isOrganization: true,
      source: 'npi_registry',
      flyerTitle: null,
      campaignName: null,
      campaignId: null,
      frontendStatus: 'new_provider',
      matchReason: 'Local NPI registry organization at this address',
      matchConfidence: 'high',
      alreadyKnown: false,
    });
  }

  return groupVariants(variants);
}
