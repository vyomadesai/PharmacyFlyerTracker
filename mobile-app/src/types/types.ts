export type Campaign = {
  CampaignId: number;
  CampaignName: string;
  Description?: string;
  FlyerIdentifier?: string;
  FlyerCategory?: string;
  FlyerTitle?: string;
  FlyerFileUrl?: string;
  TargetAudience?: string;
  DefaultVisitFrequencyDays?: number;
  MatchTitle?: string;
  MatchIdentifier?: string;
};

export type Doctor = {
  ID: number;
  Doctor_NO?: number;
  Doctor_FirstName?: string;
  Doctor_LastName?: string;
  Doctor_AddressStreet?: string;
  Doctor_AddressCity?: string;
  Doctor_AddressState?: string;
  Doctor_AddressZip?: string;
  Doctor_Phone?: string;
  Doctor_MobileNo?: string;
  Doctor_Email?: string;
  Doctor_NPINo?: string;
  Practice_Name?: string;
  Doctor_Type?: string;
  PriSpec?: string;
  DropoffLatitude?: number | string | null;
  DropoffLongitude?: number | string | null;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  Doctor_Latitude?: number | string | null;
  Doctor_Longitude?: number | string | null;
  Practice_Latitude?: number | string | null;
  Practice_Longitude?: number | string | null;
};

export type AssignmentStop = {
  AssignmentId: number;
  CampaignId: number;
  CampaignName: string;
  FlyerTitle?: string | null;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  FlyerFileUrl?: string | null;
  TargetType: string;
  TargetId?: number | null;
  DoctorId?: number | null;
  TargetName: string;
  PracticeName?: string | null;
  Specialty?: string | null;
  NpiNumber?: string | null;
  AddressStreet?: string | null;
  AddressCity?: string | null;
  AddressState?: string | null;
  AddressZip?: string | null;
  Phone?: string | null;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  ApprovalStatus?: string | null;
  AssignmentStatus?: string | null;
  CheckInStatus?: string | null;
  ScheduledDate?: string | null;
  VisitFrequencyDays?: number | null;
  LastVisitDate?: string | null;
  NextVisitDueDate?: string | null;
  RouteId?: number | null;
  RouteName?: string | null;
  RouteStopOrder?: number | null;
  StopOrder?: number | null;
  StopStatus?: string | null;
  CheckedInAt?: string | null;
  CheckInDistanceMiles?: number | string | null;
  CompletedAt?: string | null;
  EstimatedDistanceFromPreviousMiles?: number | string | null;
  LocationFlyers?: LocationFlyer[] | null;
  LocationFlyerCount?: number | null;
};

// Every flyer that must be dropped at the same physical location. A doctor/location
// can require more than one flyer (one assignment per flyer), each completed on its own.
export type LocationFlyer = {
  AssignmentId: number;
  CampaignId: number;
  CampaignName?: string | null;
  FlyerTitle?: string | null;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  AssignmentStatus?: string | null;
  StopStatus?: string | null;
};
