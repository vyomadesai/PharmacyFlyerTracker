import type {
  DiscoverDraft,
  DiscoverProvider,
  DiscoveredEntry,
  DoctorSelection,
  EntityType,
  OrgSelection,
  ProviderSelection,
  StopEnrichment,
  StopSelections,
  StopVisitMeta,
  UnifiedEntity,
  UnifiedEntitySelection,
  UnifiedEntitySource,
} from './types';
import type { AddressParts } from '../new-entry/types';

const enrichmentByStop = new Map<number, StopEnrichment>();
const selectionsByStop = new Map<number, StopSelections>();

const emptyVisitMeta = (): StopVisitMeta => ({ practiceName: '', phones: [''] });

const emptyDiscoverDraft = (): DiscoverDraft => ({
  practiceName: '',
  phone: '',
  locationAddress: '',
  addressParts: null,
  latitude: null,
  longitude: null,
  gpsDetected: false,
  providers: [],
});

const emptySelections = (): StopSelections => ({
  doctors: [],
  orgs: [],
  providers: [],
  unifiedEntities: [],
  discovered: [],
  discover: emptyDiscoverDraft(),
  visitMeta: emptyVisitMeta(),
});

function mapSourceToEntityType(source: UnifiedEntitySource, isOrganization: boolean): EntityType {
  if (isOrganization) return 'org';
  if (source === 'mapped') return 'mapped';
  if (source === 'unmapped' || source === 'master_doctor') return 'unmapped';
  if (source === 'npi_registry') return 'npi_registry';
  return 'npi';
}

function buildUnifiedSelections(
  entities: UnifiedEntity[],
  previous?: UnifiedEntitySelection[],
): UnifiedEntitySelection[] {
  const previousByKey = new Map((previous || []).map((entity) => [entity.entityKey, entity]));
  return entities.map((entity) => {
    const saved = previousByKey.get(entity.entityKey);
    const entityType = mapSourceToEntityType(entity.source, entity.isOrganization);
    return {
      entityKey: entity.entityKey,
      npi: entity.npi,
      doctorId: entity.doctorId,
      routePlanDropId: entity.routePlanDropId,
      displayName: saved?.displayName || entity.displayName,
      phone: saved?.phone || entity.phone || '',
      specialty: saved?.specialty ?? entity.specialty,
      taxonomyCode: entity.taxonomyCode,
      address: entity.address,
      isOrganization: entity.isOrganization,
      source: entity.source,
      sources: entity.sources,
      flyerTitle: entity.flyerTitle,
      campaignName: entity.campaignName,
      campaignId: entity.campaignId ?? null,
      presentHere: saved?.presentHere ?? entity.source === 'mapped',
      entityType,
      comparisons: entity.comparisons,
    };
  });
}

export function uniquePhoneList(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\D/g, '').slice(-10) || trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function buildVisitMeta(_enrichment: StopEnrichment, previous?: StopVisitMeta): StopVisitMeta {
  return {
    practiceName: previous?.practiceName || '',
    phones: previous?.phones?.length ? previous.phones : [''],
  };
}

function buildSelectionsFromEnrichment(
  enrichment: StopEnrichment,
  previous?: StopSelections,
): StopSelections {
  const previousDoctors = new Map((previous?.doctors || []).map((d) => [`${d.doctorId}-${d.routePlanDropId}`, d]));
  const previousOrgs = new Map((previous?.orgs || []).map((org) => [org.organizationNpi, org]));
  const previousProviders = new Map((previous?.providers || []).map((provider) => [provider.npi, provider]));
  const previousDiscovered = new Map((previous?.discovered || []).map((entry) => [entry.id, entry]));

  const doctors: DoctorSelection[] = enrichment.configuredDoctors.map((doctor) => {
    const key = `${doctor.doctorId}-${doctor.routePlanDropId}`;
    const saved = previousDoctors.get(key);
    return {
      doctorId: doctor.doctorId,
      routePlanDropId: doctor.routePlanDropId,
      doctorName: doctor.doctorName || 'Doctor',
      phone: doctor.phone || '',
      specialty: doctor.matchedSpecialityCode,
      flyerTitle: doctor.flyerTitle || doctor.campaignName,
      presentHere: saved?.presentHere ?? true,
      entityType: 'mapped',
    };
  });

  const unmappedDoctors: DoctorSelection[] = (
    enrichment.masterDoctorsAtAddress
    || enrichment.unmappedDoctors
    || []
  ).map((doctor) => {
    const saved = previousDoctors.get(`${doctor.doctorId}-null`) || previousDoctors.get(`${doctor.doctorId}-undefined`);
    return {
      doctorId: doctor.doctorId,
      routePlanDropId: null,
      doctorName: saved?.doctorName || doctor.doctorName || 'Doctor',
      phone: saved?.phone || doctor.phone || '',
      specialty: saved?.specialty ?? doctor.matchedSpecialityCode,
      flyerTitle: null,
      presentHere: saved?.presentHere ?? false,
      entityType: 'unmapped',
    };
  });

  const allDoctorRows = [...doctors, ...unmappedDoctors];

  const orgs: OrgSelection[] = enrichment.organizations.map((org) => {
    const saved = previousOrgs.get(org.npi);
    return {
      organizationNpi: org.npi,
      organizationName: saved?.organizationName || org.organizationName,
      organizationAddress: org.organizationAddress,
      taxonomyCode: org.taxonomyCode,
      taxonomyDescription: saved?.taxonomyDescription ?? org.taxonomyDesc,
      distanceMiles: org.distanceMiles,
      suiteLabel: org.suiteLabel || null,
      verificationStatus: saved?.verificationStatus || 'npi_only',
      phone: saved?.phone || org.phone || '',
      matchReason: org.matchReason,
      matchConfidence: org.matchConfidence,
      entityType: 'org',
    };
  });

  const providers: ProviderSelection[] = enrichment.allProviders.map((provider) => {
    const saved = previousProviders.get(provider.npi);
    const entityType: EntityType = provider.alreadyKnown ? 'unmapped' : 'npi';
    return {
      npi: provider.npi,
      providerName: saved?.providerName || provider.providerName,
      providerAddress: provider.providerAddress,
      taxonomyCode: provider.taxonomyCode,
      taxonomyDescription: saved?.taxonomyDescription ?? provider.taxonomyDesc,
      phone: saved?.phone || provider.phone || '',
      alreadyKnown: provider.alreadyKnown,
      isPrescriber: provider.isPrescriber,
      providerCategory: provider.providerCategory,
      verificationStatus: saved?.verificationStatus || (provider.alreadyKnown ? 'ignore' : 'npi_only'),
      selectedForReview: saved?.selectedForReview ?? false,
      frontendStatus: provider.frontendStatus,
      matchReason: provider.matchReason,
      matchConfidence: provider.matchConfidence,
      entityType,
    };
  });

  const discovered: DiscoveredEntry[] = (previous?.discovered || []).map((entry) => {
    const saved = previousDiscovered.get(entry.id);
    return saved || entry;
  });

  const unifiedEntities = enrichment.unifiedEntities?.length
    ? buildUnifiedSelections(enrichment.unifiedEntities, previous?.unifiedEntities)
    : [];

  return {
    doctors: allDoctorRows,
    orgs,
    providers,
    unifiedEntities,
    discovered,
    discover: previous?.discover || emptyDiscoverDraft(),
    visitMeta: buildVisitMeta(enrichment, previous?.visitMeta),
    enrichmentSaved: previous?.enrichmentSaved,
  };
}

function selectionsAreStale(existing: StopSelections, enrichment: StopEnrichment) {
  const unifiedCount = enrichment.unifiedEntities?.length || 0;
  if (unifiedCount > 0) {
    if (existing.unifiedEntities.length !== unifiedCount) return true;
    if (unifiedCount > 0 && existing.unifiedEntities.length === 0) return true;
    return false;
  }
  const doctorCount = enrichment.stats.mappedDoctorCount != null
    ? enrichment.stats.mappedDoctorCount + (enrichment.stats.unmappedDoctorCount ?? 0)
    : enrichment.configuredDoctors.length + (enrichment.masterDoctorsAtAddress?.length || enrichment.unmappedDoctors?.length || 0);
  const orgCount = enrichment.organizations.length;
  const providerCount = enrichment.allProviders.length;
  if (doctorCount > 0 && existing.doctors.length !== doctorCount) return true;
  if (orgCount > 0 && existing.orgs.length !== orgCount) return true;
  if (providerCount > 0 && existing.providers.length !== providerCount) return true;
  if (doctorCount > 0 && existing.doctors.length === 0) return true;
  if (orgCount > 0 && existing.orgs.length === 0) return true;
  if (providerCount > 0 && existing.providers.length === 0) return true;
  return false;
}

export function getStopEnrichment(routePlanStopId: number) {
  return enrichmentByStop.get(routePlanStopId) ?? null;
}

export function setStopEnrichment(routePlanStopId: number, enrichment: StopEnrichment) {
  enrichmentByStop.set(routePlanStopId, enrichment);
}

export function getStopSelections(routePlanStopId: number): StopSelections {
  return selectionsByStop.get(routePlanStopId) ?? emptySelections();
}

export function clearStopSelections(routePlanStopId: number) {
  selectionsByStop.delete(routePlanStopId);
}

export function initStopSelectionsFromEnrichment(routePlanStopId: number, enrichment: StopEnrichment) {
  if (enrichment.loading || enrichment.error) {
    return getStopSelections(routePlanStopId);
  }

  const existing = selectionsByStop.get(routePlanStopId);
  if (existing && !selectionsAreStale(existing, enrichment)) {
    return existing;
  }

  const next = buildSelectionsFromEnrichment(enrichment, existing);
  selectionsByStop.set(routePlanStopId, next);
  return next;
}

export function syncStopSelectionsFromEnrichment(routePlanStopId: number, enrichment: StopEnrichment) {
  if (enrichment.loading || enrichment.error) return getStopSelections(routePlanStopId);
  const existing = selectionsByStop.get(routePlanStopId);
  const next = buildSelectionsFromEnrichment(enrichment, existing);
  selectionsByStop.set(routePlanStopId, next);
  return next;
}

export function updateVisitMeta(routePlanStopId: number, patch: Partial<StopVisitMeta>) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    visitMeta: { ...current.visitMeta, ...patch },
  });
}

export function updateVisitPhone(routePlanStopId: number, index: number, phone: string) {
  const current = getStopSelections(routePlanStopId);
  const phones = [...current.visitMeta.phones];
  phones[index] = phone;
  selectionsByStop.set(routePlanStopId, {
    ...current,
    visitMeta: { ...current.visitMeta, phones },
  });
}

export function addVisitPhone(routePlanStopId: number) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    visitMeta: { ...current.visitMeta, phones: [...current.visitMeta.phones, ''] },
  });
}

export function updateUnifiedEntitySelection(
  routePlanStopId: number,
  entityKey: string,
  patch: Partial<UnifiedEntitySelection>,
) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    unifiedEntities: current.unifiedEntities.map((entity) =>
      entity.entityKey === entityKey ? { ...entity, ...patch } : entity,
    ),
  });
}

export function setUnifiedEntityPresent(routePlanStopId: number, entityKey: string, presentHere: boolean) {
  updateUnifiedEntitySelection(routePlanStopId, entityKey, { presentHere });
}

export function updateDoctorSelection(
  routePlanStopId: number,
  doctorId: number,
  routePlanDropId: number | null,
  patch: Partial<DoctorSelection>,
) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    doctors: current.doctors.map((doctor) => {
      if (doctor.doctorId !== doctorId || doctor.routePlanDropId !== routePlanDropId) return doctor;
      if (doctor.entityType === 'mapped') {
        const keys = Object.keys(patch);
        if (keys.length === 1 && keys[0] === 'presentHere') {
          return { ...doctor, presentHere: patch.presentHere ?? doctor.presentHere };
        }
        return doctor;
      }
      return { ...doctor, ...patch };
    }),
  });
}

export function updateOrgSelection(routePlanStopId: number, npi: string, patch: Partial<OrgSelection>) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    orgs: current.orgs.map((org) =>
      org.organizationNpi === npi ? { ...org, ...patch } : org,
    ),
  });
}

export function setOrgPresent(routePlanStopId: number, npi: string, presentHere: boolean) {
  updateOrgSelection(routePlanStopId, npi, {
    verificationStatus: presentHere ? 'confirmed_on_site' : 'not_present',
  });
}

export function updateProviderSelection(routePlanStopId: number, npi: string, patch: Partial<ProviderSelection>) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    providers: current.providers.map((provider) =>
      provider.npi === npi ? { ...provider, ...patch } : provider,
    ),
  });
}

export function setProviderPresent(routePlanStopId: number, npi: string, presentHere: boolean) {
  const current = getStopSelections(routePlanStopId);
  const provider = current.providers.find((p) => p.npi === npi);
  if (!provider) return;
  updateProviderSelection(routePlanStopId, npi, {
    selectedForReview: presentHere && !provider.alreadyKnown,
    verificationStatus: presentHere
      ? provider.alreadyKnown
        ? 'confirmed_on_site'
        : 'selected_for_review'
      : 'ignore',
  });
}

export function updateDiscoverDraft(routePlanStopId: number, patch: Partial<DiscoverDraft>) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    discover: { ...current.discover, ...patch },
  });
}

export function seedDiscoverFromStop(
  routePlanStopId: number,
  defaults: {
    locationAddress: string;
    addressParts?: AddressParts | null;
    latitude?: number | null;
    longitude?: number | null;
    practiceName?: string;
  },
) {
  const current = getStopSelections(routePlanStopId);
  if (current.discover.locationAddress.trim()) return;
  selectionsByStop.set(routePlanStopId, {
    ...current,
    discover: {
      ...current.discover,
      locationAddress: defaults.locationAddress,
      addressParts: defaults.addressParts ?? null,
      latitude: defaults.latitude ?? null,
      longitude: defaults.longitude ?? null,
      practiceName: defaults.practiceName?.trim() || current.discover.practiceName,
    },
  });
}

export function addDiscoverProvider(routePlanStopId: number) {
  const current = getStopSelections(routePlanStopId);
  const provider: DiscoverProvider = {
    id: `dp-${Date.now()}`,
    firstName: '',
    lastName: '',
    specialty: '',
  };
  updateDiscoverDraft(routePlanStopId, {
    providers: [...current.discover.providers, provider],
  });
}

export function updateDiscoverProvider(
  routePlanStopId: number,
  id: string,
  patch: Partial<DiscoverProvider>,
) {
  const current = getStopSelections(routePlanStopId);
  updateDiscoverDraft(routePlanStopId, {
    providers: current.discover.providers.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider,
    ),
  });
}

export function removeDiscoverProvider(routePlanStopId: number, id: string) {
  const current = getStopSelections(routePlanStopId);
  updateDiscoverDraft(routePlanStopId, {
    providers: current.discover.providers.filter((provider) => provider.id !== id),
  });
}

export function addDiscoveredEntry(routePlanStopId: number) {
  const current = getStopSelections(routePlanStopId);
  const fallbackPhone = uniquePhoneList([
    ...current.doctors.filter((d) => d.entityType === 'unmapped').map((d) => d.phone),
    ...current.discovered.map((d) => d.phone),
  ])[0] || '';
  const entry: DiscoveredEntry = {
    id: `new-${Date.now()}`,
    name: '',
    phone: fallbackPhone,
    specialty: '',
    presentHere: true,
  };
  selectionsByStop.set(routePlanStopId, {
    ...current,
    discovered: [...current.discovered, entry],
  });
}

export function updateDiscoveredEntry(routePlanStopId: number, id: string, patch: Partial<DiscoveredEntry>) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, {
    ...current,
    discovered: current.discovered.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  });
}

export function markEnrichmentSaved(routePlanStopId: number) {
  const current = getStopSelections(routePlanStopId);
  selectionsByStop.set(routePlanStopId, { ...current, enrichmentSaved: true });
}

export function clearRouteThreeSession() {
  enrichmentByStop.clear();
  selectionsByStop.clear();
}

export type RouteThreeStoresSnapshot = {
  enrichment: Array<[number, StopEnrichment]>;
  selections: Array<[number, StopSelections]>;
};

/** Serializable copy of the in-memory per-stop data (skips entries still loading). */
export function exportRouteThreeStores(): RouteThreeStoresSnapshot {
  return {
    enrichment: [...enrichmentByStop.entries()].filter(([, value]) => !value.loading),
    selections: [...selectionsByStop.entries()],
  };
}

export function importRouteThreeStores(snapshot: RouteThreeStoresSnapshot | null | undefined) {
  enrichmentByStop.clear();
  selectionsByStop.clear();
  if (!snapshot) return;
  for (const [stopId, value] of snapshot.enrichment || []) {
    if (value && !value.loading) enrichmentByStop.set(Number(stopId), value);
  }
  for (const [stopId, value] of snapshot.selections || []) {
    if (value) selectionsByStop.set(Number(stopId), value);
  }
}

export type EnrichmentSavePayload = {
  linkedOrgs: OrgSelection[];
  providers: ProviderSelection[];
  discovered: DiscoveredEntry[];
  discoverProviders: Array<{
    providerName: string;
    specialty: string;
    phone: string;
    providerAddress: string;
  }>;
  practiceName: string;
  discoverLocation: {
    locationAddress: string;
    addressParts: AddressParts | null;
    latitude: number | null;
    longitude: number | null;
    phone: string;
  } | null;
};

function discoverProviderName(provider: DiscoverProvider) {
  return `${provider.firstName} ${provider.lastName}`.trim();
}

export function getEnrichmentSavePayload(routePlanStopId: number): EnrichmentSavePayload {
  const selections = getStopSelections(routePlanStopId);
  const discover = selections.discover;
  const discoverProviders = discover.providers
    .filter((provider) => discoverProviderName(provider))
    .map((provider) => ({
      providerName: discoverProviderName(provider),
      specialty: provider.specialty.trim(),
      phone: discover.phone.trim(),
      providerAddress: discover.locationAddress.trim(),
    }));
  const discoverLocation = discover.locationAddress.trim()
    ? {
        locationAddress: discover.locationAddress.trim(),
        addressParts: discover.addressParts,
        latitude: discover.latitude,
        longitude: discover.longitude,
        phone: discover.phone.trim(),
      }
    : null;

  if (selections.unifiedEntities.length) {
    const present = selections.unifiedEntities.filter((entity) => entity.presentHere);
    const linkedOrgs: OrgSelection[] = present
      .filter((entity) => entity.isOrganization && entity.npi)
      .map((entity) => ({
        organizationNpi: entity.npi!,
        organizationName: entity.displayName,
        organizationAddress: entity.address || '',
        taxonomyCode: entity.taxonomyCode,
        taxonomyDescription: entity.specialty,
        distanceMiles: 0,
        suiteLabel: null,
        verificationStatus: 'confirmed_on_site',
        phone: entity.phone,
        entityType: 'org',
      }));
    const providers: ProviderSelection[] = present
      .filter((entity) => !entity.isOrganization && entity.source !== 'mapped')
      .map((entity) => ({
        npi: entity.npi || '',
        providerName: entity.displayName,
        providerAddress: entity.address || '',
        taxonomyCode: entity.taxonomyCode,
        taxonomyDescription: entity.specialty,
        phone: entity.phone,
        alreadyKnown: entity.source === 'unmapped' || entity.source === 'master_doctor',
        isPrescriber: true,
        providerCategory: entity.source,
        verificationStatus:
          entity.source === 'unmapped' || entity.source === 'master_doctor'
            ? 'confirmed_on_site'
            : 'selected_for_review',
        selectedForReview: entity.source === 'npi_registry' || entity.source === 'npi_live',
        entityType: entity.entityType,
      }));
    const discovered = selections.discovered.filter((entry) => entry.presentHere && entry.name.trim());
    return {
      linkedOrgs,
      providers,
      discovered,
      discoverProviders,
      practiceName: discover.practiceName.trim() || selections.visitMeta.practiceName,
      discoverLocation,
    };
  }

  const linkedOrgs = selections.orgs.filter((org) => orgPresent(org.verificationStatus));
  const providers = selections.providers.filter((provider) => providerPresent(provider));
  const discovered = selections.discovered.filter((entry) => entry.presentHere && entry.name.trim());
  return {
    linkedOrgs,
    providers,
    discovered,
    discoverProviders,
    practiceName: discover.practiceName.trim() || selections.visitMeta.practiceName,
    discoverLocation,
  };
}

function orgPresent(status: OrgSelection['verificationStatus']) {
  return status === 'confirmed_on_site';
}

function providerPresent(provider: ProviderSelection) {
  return provider.verificationStatus === 'confirmed_on_site' || provider.selectedForReview;
}

export function countPresentAtLocation(routePlanStopId: number) {
  const selections = getStopSelections(routePlanStopId);
  if (selections.unifiedEntities.length) {
    const present = selections.unifiedEntities.filter((entity) => entity.presentHere).length;
    return {
      doctors: present,
      orgs: 0,
      providers: 0,
      discovered: 0,
      discover: 0,
      total: present,
    };
  }
  const doctors = selections.doctors.filter((d) => d.presentHere).length;
  const orgs = selections.orgs.filter((o) => orgPresent(o.verificationStatus)).length;
  const providers = selections.providers.filter((p) => providerPresent(p)).length;
  const discovered = selections.discovered.filter((d) => d.presentHere).length;
  const discover = selections.discover.providers.filter((p) => discoverProviderName(p)).length;
  return { doctors, orgs, providers, discovered, discover, total: doctors + orgs + providers + discovered + discover };
}

export function isFieldEditable(entityType: EntityType, field: 'name' | 'phone' | 'specialty' | 'practice') {
  if (entityType === 'mapped' && field === 'name') return false;
  if (field === 'practice') return true;
  return true;
}
