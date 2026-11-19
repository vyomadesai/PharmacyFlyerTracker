import type { AddressParts, OrgVerificationStatus, ProviderVerificationStatus } from '../new-entry/types';

// Explicit status assigned by the backend so the app never infers from raw flags.
export type FrontendEntityStatus =
  | 'known'
  | 'needs_mapping'
  | 'new_provider'
  | 'selected_for_review'
  | 'confirmed_here'
  | 'not_here'
  | 'unsure'
  | 'virtual_mail_only';

export type MatchConfidence = 'high' | 'medium' | 'low';

export type RouteDrop = {
  routePlanDropId: number;
  campaignId?: number | null;
  campaignName?: string | null;
  flyerTitle?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  matchedSpecialityCode?: string | null;
  status?: string | null;
};

export type RouteStopDoctor = {
  doctorId?: number | null;
  doctorName?: string | null;
  phone?: string | null;
  routePlanDropId?: number;
  matchedSpecialityCode?: string | null;
  status?: string | null;
  campaignId?: number | null;
  campaignName?: string | null;
  flyerTitle?: string | null;
};

export type RouteStop = {
  routePlanStopId: number;
  stopOrder: number;
  locationKey?: string | null;
  locationId?: number | null;
  stopLabel: string;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMiles?: number | null;
  status?: string | null;
  isConfigured?: boolean;
  phone?: string | null;
  drops?: RouteDrop[];
  doctors?: RouteStopDoctor[];
};

export type RoutePlan = {
  routePlanId: number;
  routeName: string;
  status?: string | null;
  campaignName?: string | null;
  planDate?: string | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  radiusMiles?: number | null;
  stops: RouteStop[];
};

export type V2Flyer = {
  key: string;
  campaignId: number;
  campaignName?: string | null;
  flyerTitle?: string | null;
  dropIds: number[];
  doctorCount: number;
  doctorLabel: string;
};

export type V2Location = {
  locationKey: string;
  routePlanStopId: number;
  stopOrder: number;
  stopLabel: string;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMiles?: number | null;
  status?: string | null;
  isConfigured: boolean;
  phone?: string | null;
  flyers: V2Flyer[];
  liveDistanceMiles?: number | null;
};

export type EntityType = 'mapped' | 'unmapped' | 'npi' | 'org' | 'discovery' | 'npi_registry' | 'master_doctor';

export type UnifiedEntitySource = 'mapped' | 'unmapped' | 'master_doctor' | 'npi_registry' | 'npi_live';

export type UnifiedEntityComparison = {
  field: 'name' | 'phone' | 'specialty' | 'address';
  values: Array<{ source: UnifiedEntitySource; value: string }>;
};

export type UnifiedEntity = {
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
  campaignId?: number | null;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
  alreadyKnown: boolean;
  comparisons: UnifiedEntityComparison[];
};

export type StopKind = 'mapped' | 'unmapped' | 'npi' | 'discovery';

export type PhoneGroup = {
  phoneKey: string;
  phoneLabel: string;
  locations: V2Location[];
};

export type EnrichmentOrg = {
  npi: string;
  organizationName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  organizationAddress: string;
  suiteLabel?: string | null;
  distanceMiles: number;
  atSearchAddress?: boolean;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
  sameAddress?: boolean;
  samePhone?: boolean;
  source?: string;
};

export type EnrichmentProvider = {
  npi: string;
  providerName: string;
  providerAddress: string;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  phone: string | null;
  alreadyKnown: boolean;
  isPrescriber: boolean;
  providerCategory: string;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
  sameAddress?: boolean;
  samePhone?: boolean;
  source?: string;
};

export type ConfiguredDoctor = {
  doctorId: number;
  doctorName: string | null;
  phone: string | null;
  npi?: string | null;
  campaignId: number | null;
  campaignName: string | null;
  flyerTitle: string | null;
  matchedSpecialityCode: string | null;
  status: string | null;
  routePlanDropId: number | null;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
};

export type UnmappedDoctor = {
  doctorId: number;
  doctorName: string | null;
  phone: string | null;
  npi: string | null;
  matchedSpecialityCode: string | null;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
};

export type StopEnrichment = {
  routePlanStopId: number;
  stopLabel?: string | null;
  practiceName?: string | null;
  configuredDoctors: ConfiguredDoctor[];
  locationMappedDoctors?: UnmappedDoctor[];
  masterDoctorsAtAddress?: UnmappedDoctor[];
  unmappedDoctors?: UnmappedDoctor[];
  organizations: EnrichmentOrg[];
  allProviders: EnrichmentProvider[];
  newProviders: EnrichmentProvider[];
  stats: {
    configuredDoctorCount: number;
    mappedDoctorCount?: number;
    unmappedDoctorCount?: number;
    organizationCount: number;
    allProviderCount: number;
    newProviderCount: number;
    alreadyKnownProviderCount: number;
    needsMappingCount?: number;
    newProvidersDiscoveryCount?: number;
    prescriberCount: number;
    atAddressOrgCount: number;
  };
  lookupHint: string | null;
  highDensity: boolean;
  standardizedAddress?: string | null;
  unifiedEntities?: UnifiedEntity[];
  recommendedFlyers?: RecommendedFlyer[];
  loading?: boolean;
  error?: string;
};

export type RecommendedFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  matchReason: string;
  doctorNames: string[];
};

export type OrgSelection = {
  organizationNpi: string;
  organizationName: string;
  organizationAddress: string;
  taxonomyCode: string | null;
  taxonomyDescription: string | null;
  distanceMiles: number;
  suiteLabel: string | null;
  verificationStatus: OrgVerificationStatus;
  phone: string;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
  entityType: EntityType;
};

export type ProviderSelection = {
  npi: string;
  providerName: string;
  providerAddress: string;
  taxonomyCode: string | null;
  taxonomyDescription: string | null;
  phone: string;
  alreadyKnown: boolean;
  isPrescriber: boolean;
  providerCategory: string;
  verificationStatus: ProviderVerificationStatus;
  selectedForReview: boolean;
  frontendStatus?: FrontendEntityStatus;
  matchReason?: string;
  matchConfidence?: MatchConfidence;
  entityType: EntityType;
};

export type DoctorSelection = {
  doctorId: number;
  routePlanDropId: number | null;
  doctorName: string;
  phone: string;
  specialty: string | null;
  flyerTitle: string | null;
  presentHere: boolean;
  entityType: EntityType;
};

export type DiscoveredEntry = {
  id: string;
  name: string;
  phone: string;
  specialty: string;
  presentHere: boolean;
};

export type DiscoverProvider = {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string;
};

export type DiscoverDraft = {
  practiceName: string;
  phone: string;
  locationAddress: string;
  addressParts: AddressParts | null;
  latitude: number | null;
  longitude: number | null;
  gpsDetected: boolean;
  providers: DiscoverProvider[];
};

export type StopVisitMeta = {
  practiceName: string;
  phones: string[];
};

export type UnifiedEntitySelection = {
  entityKey: string;
  npi: string | null;
  doctorId: number | null;
  routePlanDropId: number | null;
  displayName: string;
  phone: string;
  specialty: string | null;
  taxonomyCode: string | null;
  address: string | null;
  isOrganization: boolean;
  source: UnifiedEntitySource;
  sources: UnifiedEntitySource[];
  flyerTitle: string | null;
  campaignName?: string | null;
  presentHere: boolean;
  entityType: EntityType;
  campaignId?: number | null;
  comparisons: UnifiedEntityComparison[];
};

export type StopSelections = {
  doctors: DoctorSelection[];
  orgs: OrgSelection[];
  providers: ProviderSelection[];
  unifiedEntities: UnifiedEntitySelection[];
  discovered: DiscoveredEntry[];
  discover: DiscoverDraft;
  visitMeta: StopVisitMeta;
  enrichmentSaved?: boolean;
};
