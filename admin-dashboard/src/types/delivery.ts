export type MapDelivery = {
  DeliveryId: number;
  CampaignId: number;
  DoctorId?: number | null;
  DoctorName?: string | null;
  ClinicName?: string | null;
  DoctorAddressStreet?: string | null;
  DoctorAddressCity?: string | null;
  DoctorAddressState?: string | null;
  DoctorAddressZip?: string | null;
  PersonMet?: string | null;
  FlyerDelivered?: boolean | number | null;
  ResponseStatus?: string | null;
  Latitude: number | string;
  Longitude: number | string;
  GpsAccuracyMeters?: number | string | null;
  Notes?: string | null;
  FollowUpRequired?: boolean | number | null;
  SubmittedAt: string;
  CampaignName?: string | null;
  StaffName?: string | null;
  HasPhoto?: boolean | number | null;
};

export type CampaignOption = {
  CampaignId: number;
  CampaignName: string;
};

const floridaDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
  timeStyle: 'medium',
});

export function getDeliveryCoords(delivery: MapDelivery) {
  const lat = Number(delivery.Latitude);
  const lng = Number(delivery.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function statusColor(status?: string | null) {
  const value = String(status || '').toLowerCase();
  if (value.includes('accepted') || value.includes('left with staff')) return '#16a34a';
  if (value.includes('interested')) return '#2563eb';
  if (value.includes('follow up') || value.includes('not available') || value.includes('closed')) return '#ea580c';
  if (value.includes('declined') || value.includes('not interested')) return '#dc2626';
  return '#64748b';
}

export function formatSubmittedAt(value?: string | null) {
  if (!value) return '-';
  return floridaDateTimeFormatter.format(new Date(value));
}
