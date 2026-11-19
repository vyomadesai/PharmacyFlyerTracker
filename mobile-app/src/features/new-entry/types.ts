export type AddressParts = {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type SavedCoords = {
  latitude: number;
  longitude: number;
};

export type LocationHints = {
  currentLocationAddress: string | null;
  addressParts: AddressParts | null;
  mappedPractice: {
    practiceName: string;
    locationName: string | null;
    locationAddress: string;
    locationId: number | null;
  } | null;
  gpsMismatchWarning?: string | null;
};

export type ResolveAddressResponse = {
  currentLocationAddress: string;
  addressParts: AddressParts;
  mappedPractice: LocationHints['mappedPractice'];
  latitude?: number | null;
  longitude?: number | null;
  practiceFound?: boolean;
};

export type OrgListItem = {
  npi: string;
  organizationName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  organizationAddress: string;
  suiteLabel?: string | null;
  distanceMiles: number;
  atSearchAddress?: boolean;
};

export type OrgDetail = {
  npi: string;
  organizationName: string;
  organizationAddress: string;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  primaryTaxonomy: string | null;
  selectedTaxonomy: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
  phone: string | null;
};

export type DropStatus =
  | 'dropped'
  | 'refused'
  | 'closed'
  | 'no_access'
  | 'not_found'
  | 'virtual_mail_only';

export type StopType =
  | 'suite_reception'
  | 'building_lobby'
  | 'mailroom'
  | 'clinic_office'
  | 'virtual_mailbox'
  | 'unknown';

export type OrgVerificationStatus =
  | 'npi_only'
  | 'confirmed_on_site'
  | 'virtual_mail_only'
  | 'not_present'
  | 'unsure';

export type ProviderVerificationStatus =
  | 'npi_only'
  | 'confirmed_on_site'
  | 'selected_for_review'
  | 'ignore';

export type PhysicalDrop = {
  dropStatus: DropStatus;
  stopType: StopType;
  campaignId: number | null;
  flyerTitle: string | null;
  flyerQuantity: number;
  photoUri: string;
  notes: string;
  droppedAt: string | null;
};

export type OrgLink = {
  organizationNpi: string;
  organizationName: string;
  organizationAddress: string;
  taxonomyCode: string | null;
  taxonomyDescription: string | null;
  distanceMiles: number;
  suiteLabel: string | null;
  verificationStatus: OrgVerificationStatus;
  flyerAttributed?: boolean;
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
};

export type NpiSummaryStats = {
  physicalFlyerDrops: number;
  organizationCount: number;
  exactSuiteMatchCount: number;
  providerCount: number;
  alreadyKnownProviderCount: number;
  newProviderCandidateCount: number;
  prescriberCount: number;
  nonPrescriberCount: number;
  highDensity: boolean;
  suspiciousSuite: boolean;
  manyUnrelatedTaxonomies: boolean;
  manyLlcs: boolean;
  warnings: string[];
  suiteLabel: string | null;
  lookupHint: string | null;
};

export type OrgProviderDraft = {
  npi: string;
  providerName: string;
  providerAddress: string;
  primaryPracticeAddress: string;
  secondaryPracticeAddresses: string[];
  phone: string;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  primaryTaxonomy: string | null;
  selectedTaxonomy: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
  practiceName: string;
};

export type OrgProviderDetail = {
  npi: string;
  providerName: string;
  providerAddress: string;
  primaryPracticeAddress: string;
  secondaryPracticeAddresses: string[];
  phone: string | null;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  primaryTaxonomy: string | null;
  selectedTaxonomy: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
  practiceName: string | null;
};

export type OrgProviderItem = {
  npi: string;
  providerName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  providerAddress: string;
  alreadyKnown: boolean;
};

export type ProviderListItem = {
  npi: string;
  providerName: string;
  taxonomyDesc: string | null;
  phone: string | null;
  providerAddress: string;
};

export type ProviderDetail = ProviderListItem & {
  primaryTaxonomy: string | null;
  selectedTaxonomy: string | null;
  taxonomyCode: string | null;
  taxonomyState: string | null;
  licenseNumber: string | null;
};

export type MatchedFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  matchReason: string;
  recommended?: boolean;
};

export type NewEntrySession = {
  practiceName: string;
  locationAddress: string;
  addressParts: AddressParts | null;
  phone: string;
  coords: SavedCoords | null;
  organizations: OrgListItem[];
  lookupHint: string | null;
  visitBatchId?: string;
  physicalDrop?: PhysicalDrop;
  orgLinks?: OrgLink[];
  providerSelections?: ProviderSelection[];
  npiSummary?: NpiSummaryStats;
  orgVisit?: {
    organization: OrgDetail;
    selectedFlyer: MatchedFlyer | null;
    flyerDropped: boolean;
    photoUri: string;
    providers: OrgProviderItem[];
    newCount: number;
    alreadyKnownCount: number;
    summaryHint: string | null;
    selectedProviderNpis: string[];
    providerDrafts: Record<string, OrgProviderDraft>;
  };
};

export const DROP_STATUS_OPTIONS: Array<{ value: DropStatus; label: string }> = [
  { value: 'dropped', label: 'Dropped' },
  { value: 'refused', label: 'Refused' },
  { value: 'closed', label: 'Closed' },
  { value: 'no_access', label: 'No access' },
  { value: 'not_found', label: 'Not found' },
  { value: 'virtual_mail_only', label: 'Virtual/mail only' },
];

export const STOP_TYPE_OPTIONS: Array<{ value: StopType; label: string }> = [
  { value: 'suite_reception', label: 'Suite reception' },
  { value: 'building_lobby', label: 'Building lobby/front desk' },
  { value: 'mailroom', label: 'Mailroom/shared office' },
  { value: 'clinic_office', label: 'Individual clinic office' },
  { value: 'virtual_mailbox', label: 'Virtual/registered-agent/mailbox' },
  { value: 'unknown', label: 'Unknown' },
];

export const ORG_VERIFICATION_OPTIONS: Array<{ value: OrgVerificationStatus; label: string }> = [
  { value: 'npi_only', label: 'NPI-only' },
  { value: 'confirmed_on_site', label: 'Confirmed on site' },
  { value: 'virtual_mail_only', label: 'Virtual/mail only' },
  { value: 'not_present', label: 'Not present' },
  { value: 'unsure', label: 'Unsure' },
];

export const PROVIDER_VERIFICATION_OPTIONS: Array<{ value: ProviderVerificationStatus; label: string }> = [
  { value: 'npi_only', label: 'NPI-only' },
  { value: 'confirmed_on_site', label: 'Confirmed on site' },
  { value: 'selected_for_review', label: 'Selected for review' },
  { value: 'ignore', label: 'Ignore' },
];
