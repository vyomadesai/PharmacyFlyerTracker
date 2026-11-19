export type Campaign = {
  CampaignId: number;
  CampaignName: string;
  Description?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  IsActive: boolean;
  CreatedDate?: string;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  MatchTitle?: string | null;
  MatchIdentifier?: string | null;
  IsDefaultFallback?: boolean;
};

export type CampaignConfig = {
  CampaignConfigId?: number;
  ConfigId?: number;
  CampaignId: number;
  ConfigName: string;
  TargetType: 'doctor' | 'pharmacy' | 'both' | 'Doctor' | 'Pharmacy' | 'Both';
  FlyerName?: string | null;
  DoctorType?: 'Specialty' | 'Primary Care' | 'Any' | 'primary_care' | 'specialist' | 'any' | null;
  SpecialtySource?: 'backend' | 'npi_registry' | 'custom' | 'any' | null;
  Specialty?: string | null;
  SpecialtyValue?: string | null;
  CustomSpecialty?: string | null;
  CustomSpecialtyText?: string | null;
  TaxonomyCode?: string | null;
  TaxonomyDescription?: string | null;
  RequirePrimaryTaxonomy?: boolean | null;
  Geography?: string | null;
  TargetCity?: string | null;
  TargetState?: string | null;
  MarketId?: number | null;
  CenterAddress?: string | null;
  CenterLatitude?: number | null;
  CenterLongitude?: number | null;
  RadiusMiles?: number | null;
  VisitFrequencyType?: 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'custom_days';
  VisitFrequencyDays?: number | null;
  CheckInRequired?: boolean;
  ProofRequired?: boolean;
  ProofUploadRequired?: boolean;
  ApprovalRequired?: boolean;
  IsActive: boolean;
  CampaignName?: string;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  MatchTitle?: string | null;
  MatchIdentifier?: string | null;
  MarketName?: string | null;
  MarketNumber?: string | null;
  CreatedAt?: string;
  UpdatedAt?: string | null;
};

export const emptyConfigForm = {
  configName: '',
  targetType: 'Doctor',
  flyerName: '',
  doctorType: 'Any',
  specialtySource: 'backend',
  specialty: '',
  customSpecialty: '',
  taxonomyCode: '',
  taxonomyDescription: '',
  requirePrimaryTaxonomy: false,
  geography: 'Pinellas Park',
  city: 'Pinellas Park',
  state: 'FL',
  market: '',
  centerLatitude: '',
  centerLongitude: '',
  radiusMiles: '',
  visitFrequencyDays: '',
  checkInRequired: true,
  proofRequired: true,
  isActive: true,
};
