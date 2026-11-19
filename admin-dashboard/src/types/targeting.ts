export type ApprovalStatus =
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'assigned'
  | 'completed'
  | 'skipped';

export type TargetedDoctor = {
  DoctorId: number;
  NPI: string | null;
  DoctorName: string;
  FirstName?: string | null;
  LastName?: string | null;
  Specialty: string | null;
  CustomSpecialtyText?: string | null;
  DoctorType: string;
  PrimaryAddress: string | null;
  SecondaryAddress: string | null;
  City: string | null;
  State: string | null;
  Zip: string | null;
  Phone: string | null;
  Fax: string | null;
  LicenseNumber: string | null;
  TaxonomyCode: string | null;
  PrimaryTaxonomy: boolean | null;
  TaxonomyDescription: string | null;
  PracticeName: string | null;
  Latitude: number | null;
  Longitude: number | null;
  CoordinateSource: string | null;
  DistanceMiles: number | null;
  LocalRecordCount: number;
  DuplicateDoctorIds: string | null;
};

export type CampaignTarget = {
  CampaignTargetId: number;
  CampaignId: number;
  CampaignConfigId: number | null;
  TargetType: 'doctor' | 'pharmacy';
  DoctorId: number | null;
  NPI: string | null;
  PharmacyId: number | null;
  AssignedFlyerName: string | null;
  ApprovalStatus: ApprovalStatus;
  ApprovedByUserId?: number | null;
  ApprovedAt?: string | null;
  RejectedByUserId?: number | null;
  RejectedAt?: string | null;
  ApprovalNotes?: string | null;
  VisitFrequencyType: string;
  VisitFrequencyDays?: number | null;
  NextDueDate?: string | null;
  LastVisitedAt?: string | null;
  CheckInRequired: boolean;
  ProofUploadRequired: boolean;
  CreatedAt?: string;
  CampaignName?: string;
  ConfigName?: string | null;
  ConfigFlyerName?: string | null;
  MarketId?: number | null;
  MarketName?: string | null;
  TargetName?: string | null;
  Specialty?: string | null;
  DoctorType?: string | null;
  TaxonomyCode?: string | null;
  TaxonomyDescription?: string | null;
  PrimaryAddress?: string | null;
  SecondaryAddress?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Phone?: string | null;
  Fax?: string | null;
  LicenseNumber?: string | null;
  PracticeName?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  DistanceMiles?: number | null;
  VisitDueStatus?: string | null;
  /** @deprecated use ApprovalStatus */
  TargetStatus?: string;
};

export type CampaignTargetListResponse = {
  count: number;
  targets: CampaignTarget[];
};

export type DoctorSearchResponse = {
  count: number;
  filters: Record<string, unknown>;
  doctors: TargetedDoctor[];
  warnings?: string[];
};
