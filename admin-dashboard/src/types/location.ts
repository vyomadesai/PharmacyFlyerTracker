export type Market = {
  MarketId: number;
  MarketName: string;
  MarketNumber: string;
  CenterAddress?: string | null;
  CenterCity?: string | null;
  CenterState?: string | null;
  CenterZip?: string | null;
  CenterLatitude?: number | null;
  CenterLongitude?: number | null;
  RadiusMiles: number;
  IsActive: boolean;
  CreatedAt?: string;
  UpdatedAt?: string | null;
};

export type Pharmacy = {
  PharmacyId: number;
  PharmacyName: string;
  Address1?: string | null;
  Address2?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Phone?: string | null;
  Fax?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  MarketId?: number | null;
  LegacyPharmacyInfoNo?: number | null;
  IsActive: boolean;
  MarketName?: string | null;
  MarketNumber?: string | null;
  DistanceMiles?: number | null;
  CreatedAt?: string;
  UpdatedAt?: string | null;
};
