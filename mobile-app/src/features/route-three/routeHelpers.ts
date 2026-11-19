import { normalizePhoneDigits } from '../new-entry/utils';
import type { PhoneGroup, RouteDrop, RoutePlan, RouteStop, StopKind, V2Flyer, V2Location } from './types';

export function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function stopDrops(stop: RouteStop): RouteDrop[] {
  if (stop.drops?.length) return stop.drops;
  return (stop.doctors || []).filter(
    (d): d is RouteDrop => typeof d.routePlanDropId === 'number' && d.routePlanDropId > 0,
  );
}

export function buildFlyersForStop(stop: RouteStop): V2Flyer[] {
  const byCampaign = new Map<number, V2Flyer>();
  for (const drop of stopDrops(stop)) {
    const campaignId = Number(drop.campaignId);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
    let flyer = byCampaign.get(campaignId);
    if (!flyer) {
      flyer = {
        key: `${stop.routePlanStopId}-${campaignId}`,
        campaignId,
        campaignName: drop.campaignName,
        flyerTitle: drop.flyerTitle,
        dropIds: [],
        doctorCount: 0,
        doctorLabel: '',
      };
      byCampaign.set(campaignId, flyer);
    }
    flyer.dropIds.push(drop.routePlanDropId);
  }

  for (const flyer of byCampaign.values()) {
    const doctors = stopDrops(stop)
      .filter((d) => Number(d.campaignId) === flyer.campaignId && d.doctorName)
      .map((d) => d.doctorName as string);
    const unique = [...new Set(doctors)];
    flyer.doctorCount = unique.length || flyer.dropIds.length;
    flyer.doctorLabel = unique.slice(0, 3).join(', ') + (unique.length > 3 ? ` +${unique.length - 3} more` : '');
  }

  return [...byCampaign.values()];
}

function resolveLocationPhone(loc: V2Location, plan: RoutePlan | null): string {
  if (loc.phone?.trim()) return loc.phone.trim();
  const stop = plan?.stops.find((s) => s.routePlanStopId === loc.routePlanStopId);
  if (stop?.phone?.trim()) return stop.phone.trim();
  for (const doctor of stop?.doctors ?? []) {
    if (doctor.phone?.trim()) return doctor.phone.trim();
  }
  return '';
}

function phoneGroupKey(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  if (digits.length >= 7) return digits.slice(-10);
  return '';
}

function formatPhoneLabel(phoneKey: string, rawPhone?: string | null): string {
  if (!phoneKey) return 'No phone';
  if (rawPhone?.trim()) return rawPhone.trim();
  const digits = phoneKey.slice(-10);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phoneKey;
}

export function groupLocationsByPhone(locations: V2Location[], plan: RoutePlan | null): PhoneGroup[] {
  const buckets = new Map<string, { phoneLabel: string; locations: V2Location[] }>();

  for (const loc of locations) {
    const rawPhone = resolveLocationPhone(loc, plan);
    const key = phoneGroupKey(rawPhone) || '__no_phone__';
    if (!buckets.has(key)) {
      buckets.set(key, {
        phoneLabel: formatPhoneLabel(key === '__no_phone__' ? '' : key, rawPhone),
        locations: [],
      });
    }
    buckets.get(key)!.locations.push(loc);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      phoneKey: key,
      phoneLabel: bucket.phoneLabel,
      locations: bucket.locations,
    }))
    .sort((a, b) => {
      if (a.phoneKey === '__no_phone__') return 1;
      if (b.phoneKey === '__no_phone__') return -1;
      const da = a.locations[0]?.distanceMiles ?? Number.POSITIVE_INFINITY;
      const db = b.locations[0]?.distanceMiles ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
}

function isConfiguredStop(stop: RouteStop): boolean {
  if (stop.isConfigured != null) return Boolean(stop.isConfigured);
  if (stop.locationId != null && stop.locationId > 0) return true;
  return String(stop.locationKey || '').startsWith('loc:');
}

export function planToLocations(plan: RoutePlan | null): V2Location[] {
  if (!plan) return [];
  return [...plan.stops]
    .filter((stop) => stop.status !== 'skipped')
    .sort((a, b) => {
      const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
      const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return a.stopOrder - b.stopOrder;
    })
    .map((stop) => ({
      locationKey: String(stop.locationKey || stop.routePlanStopId),
      routePlanStopId: stop.routePlanStopId,
      stopOrder: stop.stopOrder,
      stopLabel: stop.stopLabel,
      addressStreet: stop.addressStreet,
      addressCity: stop.addressCity,
      addressState: stop.addressState,
      addressZip: stop.addressZip,
      latitude: stop.latitude,
      longitude: stop.longitude,
      distanceMiles: stop.distanceMiles,
      status: stop.status,
      isConfigured: isConfiguredStop(stop),
      phone: stop.phone ?? null,
      flyers: buildFlyersForStop(stop),
    }));
}

export function initialCompletedFlyers(plan: RoutePlan | null): Record<string, boolean> {
  const done: Record<string, boolean> = {};
  if (!plan) return done;
  for (const stop of plan.stops) {
    for (const flyer of buildFlyersForStop(stop)) {
      const drops = stopDrops(stop).filter((d) => Number(d.campaignId) === flyer.campaignId);
      if (drops.length > 0 && drops.every((d) => d.status === 'completed')) {
        done[flyer.key] = true;
      }
    }
  }
  return done;
}

export function addressLine(loc?: V2Location | null) {
  if (!loc) return '';
  const line1 = loc.addressStreet || '';
  const cityState = [loc.addressCity, loc.addressState].filter(Boolean).join(', ');
  const line2 = [cityState, loc.addressZip].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

export function locationTitle(loc?: V2Location | null) {
  if (!loc) return '';
  if (loc.stopLabel) return loc.stopLabel;
  if (loc.addressStreet) return loc.addressStreet;
  return 'Location';
}

/**
 * Practice/clinic name for a stop — never a doctor or org name.
 * Only trusts `enrichment.practiceName` (typed by the distributor or from Master_Practice).
 * Stop labels are not used: on unmapped stops they are doctor/provider names.
 */
export function resolveMappedPracticeName(
  loc?: V2Location | null,
  enrichment?: { stopLabel?: string | null; practiceName?: string | null } | null,
): string {
  if (!loc) return '';
  return enrichment?.practiceName?.trim() || '';
}

export function flyerLabel(flyer: Pick<V2Flyer, 'flyerTitle' | 'campaignName'>) {
  return flyer.flyerTitle || flyer.campaignName || 'Assigned flyer';
}

export function mergeRecommendedFlyers(
  planned: V2Flyer[],
  recommended: Array<{
    campaignId: number;
    campaignName: string;
    flyerTitle: string | null;
    matchReason?: string;
    doctorNames?: string[];
  }> | null | undefined,
  routePlanStopId: number,
): V2Flyer[] {
  const byCampaign = new Map<number, V2Flyer>();
  for (const flyer of planned) {
    byCampaign.set(flyer.campaignId, { ...flyer });
  }

  for (const rec of recommended || []) {
    const campaignId = Number(rec.campaignId);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
    const names = rec.doctorNames || [];
    const existing = byCampaign.get(campaignId);
    if (existing) {
      if (!existing.doctorLabel && names.length) {
        existing.doctorCount = names.length;
        existing.doctorLabel = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
      }
      continue;
    }
    byCampaign.set(campaignId, {
      key: `${routePlanStopId}-${campaignId}`,
      campaignId,
      campaignName: rec.campaignName,
      flyerTitle: rec.flyerTitle,
      dropIds: [],
      doctorCount: names.length,
      doctorLabel: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : ''),
    });
  }

  return [...byCampaign.values()];
}

export function oneLineAddress(loc?: V2Location | null) {
  return addressLine(loc).replace(/\n/g, ', ');
}

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function milesBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

export function formatDistance(miles: number | null) {
  if (miles === null) return 'GPS needed';
  if (miles < 0.1) return 'At location';
  return `${miles.toFixed(1)} mi`;
}

export function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatRouteDateLabel(value?: string | null) {
  const key = value?.trim().slice(0, 10);
  const [year, month, day] = (key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : localDateKey()).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function sortLocationsByGps(
  locations: V2Location[],
  gps: { latitude: number; longitude: number } | null,
): V2Location[] {
  if (!gps) return locations;
  return [...locations]
    .map((loc) => {
      const lat = numberValue(loc.latitude);
      const lng = numberValue(loc.longitude);
      const liveDistanceMiles =
        lat !== null && lng !== null
          ? milesBetween(
              { latitude: gps.latitude, longitude: gps.longitude },
              { latitude: lat, longitude: lng },
            )
          : loc.distanceMiles ?? Number.POSITIVE_INFINITY;
      return { ...loc, liveDistanceMiles };
    })
    .sort((a, b) => {
      const da = a.liveDistanceMiles ?? Number.POSITIVE_INFINITY;
      const db = b.liveDistanceMiles ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return a.stopOrder - b.stopOrder;
    });
}

/** Stops tied to Master_Location with a DB practice name (e.g. PHC). */
export function isMappedPracticeStop(loc: V2Location): boolean {
  return loc.isConfigured;
}

export function splitStopsForNavigator(
  locations: V2Location[],
  gps: { latitude: number; longitude: number } | null,
) {
  const sorted = sortLocationsByGps(locations, gps);
  const openStops: V2Location[] = [];
  const mappedPracticeStops: V2Location[] = [];
  for (const loc of sorted) {
    if (isMappedPracticeStop(loc)) mappedPracticeStops.push(loc);
    else openStops.push(loc);
  }
  return { openStops, mappedPracticeStops, allStops: sorted };
}

export function inferStopKind(loc: V2Location, enrichment?: { stats?: { configuredDoctorCount?: number; mappedDoctorCount?: number; unmappedDoctorCount?: number; alreadyKnownProviderCount?: number; newProviderCount?: number } } | null): StopKind {
  if (loc.isConfigured && (enrichment?.stats?.mappedDoctorCount ?? enrichment?.stats?.configuredDoctorCount ?? 0) > 0) return 'mapped';
  const unmappedDoctors = enrichment?.stats?.unmappedDoctorCount ?? 0;
  const known = enrichment?.stats?.alreadyKnownProviderCount ?? 0;
  const npiNew = enrichment?.stats?.newProviderCount ?? 0;
  if (unmappedDoctors > 0 || known > 0) return 'unmapped';
  if (npiNew > 0) return 'npi';
  return 'discovery';
}

export function stopKindLabel(kind: StopKind): string {
  switch (kind) {
    case 'mapped': return 'Mapped';
    case 'unmapped': return 'Unmapped';
    case 'npi': return 'NPI';
    case 'discovery': return 'Discovery';
  }
}
