import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import { api } from '../../src/services/api';
import { useCheckInRadiusMiles } from '../../src/config';
import { normalizePhoneDigits } from '../../src/features/new-entry/utils';

const PERSON_MET_DEFAULT = 'Front Desk';
const RESPONSE_STATUS_DEFAULT = 'Flyer dropped';

type RouteDrop = {
  routePlanDropId: number;
  campaignId?: number | null;
  campaignName?: string | null;
  flyerTitle?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  matchedSpecialityCode?: string | null;
  status?: string | null;
};

type RouteStopDoctor = {
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

type RouteStop = {
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

type RoutePlan = {
  routePlanId: number;
  routeName: string;
  status?: string | null;
  campaignName?: string | null;
  planDate?: string | null;
  stops: RouteStop[];
};

type MyPlansResponse = {
  date: string;
  plans: RoutePlan[];
};

type CoverageInfo = {
  total: number;
  covered: number;
  remaining: number;
  frequencyInDays: number | null;
};

type RepCampaign = {
  campaignId: number;
  campaignName?: string | null;
  flyerTitle?: string | null;
  frequencyInDays?: number | null;
  total: number;
  covered: number;
  remaining: number;
};

type CheckInSession = {
  checkInId: number;
  coverage: CoverageInfo | null;
  stopCount: number;
  skippedHeldCount?: number;
  radiusMiles?: number | null;
};

type V2Flyer = {
  key: string;
  campaignId: number;
  campaignName?: string | null;
  flyerTitle?: string | null;
  dropIds: number[];
  doctorCount: number;
  doctorLabel: string;
};

type V2Location = {
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
};

type PhoneGroup = {
  phoneKey: string;
  phoneLabel: string;
  locations: V2Location[];
};

type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function stopDrops(stop: RouteStop): RouteDrop[] {
  if (stop.drops?.length) return stop.drops;
  return (stop.doctors || []).filter(
    (d): d is RouteDrop => typeof d.routePlanDropId === 'number' && d.routePlanDropId > 0,
  );
}

function buildFlyersForStop(stop: RouteStop): V2Flyer[] {
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

function groupLocationsByPhone(locations: V2Location[], plan: RoutePlan | null): PhoneGroup[] {
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

function planToLocations(plan: RoutePlan | null): V2Location[] {
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

function initialCompletedFlyers(plan: RoutePlan | null): Record<string, boolean> {
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

function addressLine(loc?: V2Location | null) {
  if (!loc) return '';
  const line1 = loc.addressStreet || '';
  const cityState = [loc.addressCity, loc.addressState].filter(Boolean).join(', ');
  const line2 = [cityState, loc.addressZip].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

function oneLineAddress(loc?: V2Location | null) {
  return addressLine(loc).replace(/\n/g, ', ');
}

function locationTitle(loc?: V2Location | null) {
  if (!loc) return '';
  if (loc.stopLabel) return loc.stopLabel;
  if (loc.addressStreet) return loc.addressStreet;
  return 'Location';
}

function flyerLabel(flyer: V2Flyer) {
  return flyer.flyerTitle || flyer.campaignName || 'Assigned flyer';
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function milesBetween(
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

function formatDistance(miles: number | null, driving = false) {
  if (miles === null) return 'GPS needed';
  if (miles < 0.1) return driving ? 'At location' : 'At location';
  return `${miles.toFixed(1)} mi${driving ? ' driving' : ''}`;
}

function formatCoordinates(latitude?: number | null, longitude?: number | null) {
  const lat = numberValue(latitude);
  const lng = numberValue(longitude);
  if (lat === null || lng === null) return 'Lat/Lng: pending';
  return `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
}

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatRouteDateLabel(value?: string | null) {
  const key = value?.trim().slice(0, 10);
  const date =
    key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? parseDateKey(key) : parseDateKey(localDateKey());
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function RoutePlannerV2Screen() {
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [routeDate, setRouteDate] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [repCampaigns, setRepCampaigns] = useState<RepCampaign[]>([]);
  const [session, setSession] = useState<CheckInSession | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  const [proofByFlyer, setProofByFlyer] = useState<Record<string, string>>({});
  const [completedFlyers, setCompletedFlyers] = useState<Record<string, boolean>>({});
  const [checkedInByLocation, setCheckedInByLocation] = useState<Record<string, boolean>>({});
  const [lastLocation, setLastLocation] = useState<LocationSnapshot | null>(null);

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [drivingDistanceMiles, setDrivingDistanceMiles] = useState<number | null>(null);
  const [distanceChecking, setDistanceChecking] = useState(false);
  const [distanceError, setDistanceError] = useState('');

  const CHECK_IN_RADIUS_MILES = useCheckInRadiusMiles();
  const locations = useMemo(() => planToLocations(plan), [plan]);
  const phoneGroups = useMemo(() => groupLocationsByPhone(locations, plan), [locations, plan]);
  const displayLocations = useMemo(
    () => phoneGroups.flatMap((group) => group.locations),
    [phoneGroups],
  );
  const locationIndexByKey = useMemo(
    () => new Map(displayLocations.map((loc, index) => [loc.locationKey, index])),
    [displayLocations],
  );

  const activeLocation = displayLocations[activeIndex] || null;
  const activePhoneGroup = useMemo(() => {
    if (!activeLocation) return null;
    return phoneGroups.find((group) =>
      group.locations.some((loc) => loc.locationKey === activeLocation.locationKey),
    ) ?? null;
  }, [phoneGroups, activeLocation]);
  const checkedIn = activeLocation ? Boolean(checkedInByLocation[activeLocation.locationKey]) : false;
  const withinCheckInRadius = distanceMiles !== null && distanceMiles <= CHECK_IN_RADIUS_MILES;

  const isFlyerDone = useCallback(
    (flyer: V2Flyer) => Boolean(completedFlyers[flyer.key]),
    [completedFlyers],
  );
  const isLocationDone = useCallback(
    (loc: V2Location | null) =>
      Boolean(loc && loc.flyers.length > 0 && loc.flyers.every((f) => completedFlyers[f.key])),
    [completedFlyers],
  );
  const completedLocationCount = useMemo(
    () => locations.filter((loc) => isLocationDone(loc)).length,
    [locations, isLocationDone],
  );
  const configuredCount = useMemo(
    () => locations.filter((loc) => loc.isConfigured).length,
    [locations],
  );
  const unconfiguredCount = locations.length - configuredCount;
  const activeLocationDone = isLocationDone(activeLocation);
  const canCheckIn = Boolean(activeLocation && !checkedIn && withinCheckInRadius && !distanceChecking && !busy);

  const routeName = plan?.routeName || 'Routes List';
  const displayDate = formatRouteDateLabel(routeDate || plan?.planDate || localDateKey());
  const progressPercent = locations.length
    ? Math.max(6, (completedLocationCount / locations.length) * 100)
    : 0;
  const routeBuilding = Boolean(session && session.stopCount > 0 && !plan);

  function applyLoadedPlan(nextPlan: RoutePlan | null, date?: string) {
    setPlan(nextPlan);
    setRouteDate(date || nextPlan?.planDate || '');
    setCompletedFlyers(initialCompletedFlyers(nextPlan));
  }

  async function load() {
    setError('');
    const res = await api.get<MyPlansResponse>('/route-planner/my/plans');
    const nextPlan = res.data.plans?.[0] || null;
    applyLoadedPlan(nextPlan, res.data.date || '');
    return nextPlan;
  }

  const loadRepCampaigns = useCallback(async () => {
    setError('');
    const res = await api.get<{ campaigns: RepCampaign[] }>('/route-planner/my/campaigns');
    const list = res.data?.campaigns || [];
    setRepCampaigns(list);
    return list;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const alreadyLoaded = repCampaigns.length > 0;
      if (!alreadyLoaded) setLoading(true);
      loadRepCampaigns()
        .catch((e) => {
          setError(e?.response?.data?.message || 'Could not load your assigned campaigns.');
        })
        .finally(() => mounted && setLoading(false));
      return () => {
        mounted = false;
      };
    }, [loadRepCampaigns, repCampaigns.length]),
  );

  async function checkInSession() {
    setSessionBusy(true);
    setError('');
    try {
      const loc = await getCurrentLocation();
      const res = await api.post(
        '/route-planner/my/checkin',
        {
          lat: loc.latitude,
          lng: loc.longitude,
        },
        { timeout: 120000 },
      );
      const data = res.data || {};
      const sessionData = {
        checkInId: data.checkInId,
        coverage: data.coverage || null,
        stopCount: data.stopCount ?? 0,
        skippedHeldCount: data.skippedHeldCount ?? 0,
        radiusMiles: data.radiusMiles ?? null,
      };

      if (!sessionData.stopCount) {
        setSession(sessionData);
        setPlan(null);
        setRouteDate('');
        setCompletedFlyers({});
        setActiveIndex(0);
        setCheckedInByLocation({});
        Alert.alert(
          'Checked in',
          data.coverage && data.coverage.remaining === 0
            ? 'All doctors are covered for this cycle. Nothing to drop right now.'
            : 'No due offices within 5 miles. Move closer to your territory and check in again.',
        );
        return;
      }

      const inlinePlan = (data.plan as RoutePlan | null | undefined) ?? null;
      if (inlinePlan) {
        applyLoadedPlan(inlinePlan, inlinePlan.planDate || '');
      } else {
        await load();
      }

      setSession(sessionData);
      setActiveIndex(0);
      setCheckedInByLocation({});
      const skipped = Number(data.skippedHeldCount ?? 0);
      const skipNote =
        skipped > 0
          ? ` ${skipped} location(s) were skipped because another rep is working them or they were recently visited.`
          : '';
      Alert.alert(
        'Checked in',
        `Route ready: ${sessionData.stopCount} location(s) within ${sessionData.radiusMiles} miles (configured + unconfigured, closest first).${skipNote}`,
      );
    } catch (e: any) {
      const message =
        e?.code === 'ECONNABORTED'
          ? 'Check-in is taking longer than expected. Wait a moment, then try again once.'
          : e?.response?.data?.message || e?.message || 'Check-in failed.';
      setError(message);
      Alert.alert('Check-in failed', message);
    } finally {
      setSessionBusy(false);
    }
  }

  async function checkOutSession() {
    if (!session) return;
    setSessionBusy(true);
    try {
      await api.post('/route-planner/my/checkout', { checkInId: session.checkInId });
    } catch {
      /* end the session locally even if the call fails */
    } finally {
      setSession(null);
      setPlan(null);
      setActiveIndex(0);
      setCheckedInByLocation({});
      setProofByFlyer({});
      setSessionBusy(false);
      loadRepCampaigns().catch(() => {});
    }
  }

  useEffect(() => {
    if (activeIndex > Math.max(displayLocations.length - 1, 0)) {
      setActiveIndex(Math.max(displayLocations.length - 1, 0));
    }
  }, [activeIndex, displayLocations.length]);

  useEffect(() => {
    setDistanceMiles(null);
    setDrivingDistanceMiles(null);
    setDistanceError('');
    if (activeLocation) {
      refreshDistance(false).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation?.locationKey]);

  async function refresh() {
    setRefreshing(true);
    try {
      if (session) await load();
      else await loadRepCampaigns();
    } catch (e: any) {
      Alert.alert('Refresh failed', e?.response?.data?.message || 'Try again.');
    }
    setRefreshing(false);
  }

  async function getCurrentLocation(): Promise<LocationSnapshot> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission is required to check in and complete the stop.');
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const snapshot = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
    setLastLocation(snapshot);
    return snapshot;
  }

  async function refreshDistance(showAlert = true) {
    if (!activeLocation) return null;

    const targetLatitude = numberValue(activeLocation.latitude);
    const targetLongitude = numberValue(activeLocation.longitude);

    if (targetLatitude === null || targetLongitude === null) {
      setDistanceMiles(null);
      setDistanceError('Target GPS is missing for this stop.');
      if (showAlert) {
        Alert.alert('Target GPS missing', 'This stop does not have latitude/longitude saved.');
      }
      return null;
    }

    setDistanceChecking(true);
    setDistanceError('');

    try {
      const location = await getCurrentLocation();
      const straightMiles = milesBetween(
        { latitude: location.latitude, longitude: location.longitude },
        { latitude: targetLatitude, longitude: targetLongitude },
      );
      setDistanceMiles(straightMiles);

      let drivingMiles = straightMiles;
      try {
        const distRes = await api.post<{ drivingMiles?: number; straightMiles?: number }>(
          '/route-planner/driving-distance',
          {
            from: { lat: location.latitude, lng: location.longitude },
            to: { lat: targetLatitude, lng: targetLongitude },
          },
          { timeout: 20000 },
        );
        drivingMiles = Number(distRes.data?.drivingMiles ?? straightMiles);
      } catch {
        drivingMiles = straightMiles;
      }
      setDrivingDistanceMiles(drivingMiles);

      if (showAlert) {
        Alert.alert(
          'GPS updated',
          straightMiles <= CHECK_IN_RADIUS_MILES
            ? `You are within ${CHECK_IN_RADIUS_MILES} miles. Check-in is enabled.`
            : `About ${drivingMiles.toFixed(1)} mi driving (${straightMiles.toFixed(1)} mi straight). Check-in unlocks within ${CHECK_IN_RADIUS_MILES} miles.`,
        );
      }
      return { location, miles: straightMiles, drivingMiles };
    } catch (e: any) {
      setDistanceMiles(null);
      setDistanceError(e?.message || 'Could not read GPS location.');
      if (showAlert) Alert.alert('GPS failed', e?.message || 'Could not read GPS location.');
      return null;
    } finally {
      setDistanceChecking(false);
    }
  }

  async function navigateToStop() {
    if (!activeLocation) return;
    const lat = numberValue(activeLocation.latitude);
    const lng = numberValue(activeLocation.longitude);
    const query =
      lat !== null && lng !== null
        ? `${lat},${lng}`
        : oneLineAddress(activeLocation) || locationTitle(activeLocation);
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('Cannot open maps', 'Open your maps app and search the address manually.');
      return;
    }
    await Linking.openURL(url);
  }

  async function checkIn() {
    if (!activeLocation) return;

    setBusy('checkin');
    setError('');
    try {
      const distanceResult = await refreshDistance(false);
      if (!distanceResult) {
        Alert.alert('Check-in unavailable', 'Could not verify your distance from this stop.');
        return;
      }
      if (distanceResult.miles > CHECK_IN_RADIUS_MILES) {
        Alert.alert(
          'Too far to check in',
          `You are ${distanceResult.miles.toFixed(1)} miles away. Check-in is allowed only within ${CHECK_IN_RADIUS_MILES} miles.`,
        );
        return;
      }
      setCheckedInByLocation((prev) => ({ ...prev, [activeLocation.locationKey]: true }));
      Alert.alert('Checked in', 'Arrival recorded. Drop each flyer below and capture a proof photo for each.');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Check-in failed.');
    } finally {
      setBusy('');
    }
  }

  async function takeProofPhoto(flyer: V2Flyer) {
    if (!activeLocation || !plan) return;
    if (!checkedIn) {
      Alert.alert('Check-in required', 'Check in before taking the proof photo.');
      return;
    }

    setBusy(`proof-${flyer.key}`);
    setError('');
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libraryPermission.granted) {
          Alert.alert('Permission needed', 'Allow camera or photo library access to upload proof.');
          return;
        }
      }
      const picked = await ImagePicker.launchCameraAsync({
        quality: 0.72,
        allowsEditing: false,
      }).catch(() =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.72,
        }),
      );
      if (picked.canceled || !picked.assets?.[0]) return;
      const uri = picked.assets[0].uri;
      setProofByFlyer((prev) => ({ ...prev, [flyer.key]: uri }));
      await completeFlyer(flyer, uri);
    } catch (e: any) {
      setError(e?.message || 'Could not capture proof photo.');
    } finally {
      setBusy('');
    }
  }

  async function completeFlyer(flyer: V2Flyer, overrideProofUri?: string) {
    if (!activeLocation || !plan) return;
    if (!checkedIn) {
      Alert.alert('Check-in required', 'Check in at the location before marking a flyer complete.');
      return;
    }
    const proofUri = overrideProofUri ?? proofByFlyer[flyer.key];
    if (!proofUri) {
      Alert.alert('Proof required', 'Take a proof photo of this flyer drop before completing it.');
      return;
    }

    setBusy(`complete-${flyer.key}`);
    setError('');
    try {
      const location = lastLocation || (await getCurrentLocation());
      const stopDropsForFlyer = stopDrops(
        plan.stops.find((s) => s.routePlanStopId === activeLocation.routePlanStopId) || {
          routePlanStopId: activeLocation.routePlanStopId,
          stopOrder: activeLocation.stopOrder,
          stopLabel: activeLocation.stopLabel,
          drops: [],
        },
      ).filter((d) => Number(d.campaignId) === flyer.campaignId);
      const primaryDoctorId = stopDropsForFlyer.find((d) => d.doctorId)?.doctorId ?? null;

      for (const dropId of flyer.dropIds) {
        await api.post(`/route-planner/drops/${dropId}/complete`, {});
      }

      const form = new FormData();

      form.append('campaignId', String(flyer.campaignId));
      form.append('locationKey', activeLocation.locationKey);
      if (primaryDoctorId) form.append('doctorId', String(primaryDoctorId));
      form.append('proofRequired', 'true');
      form.append('doctorName', flyer.doctorLabel || activeLocation.stopLabel || 'Route stop');
      form.append('clinicName', activeLocation.stopLabel || '');
      form.append('doctorAddressStreet', activeLocation.addressStreet || '');
      form.append('doctorAddressCity', activeLocation.addressCity || '');
      form.append('doctorAddressState', activeLocation.addressState || '');
      form.append('doctorAddressZip', activeLocation.addressZip || '');
      form.append('personMet', PERSON_MET_DEFAULT);
      form.append('flyerDelivered', 'true');
      form.append('responseStatus', RESPONSE_STATUS_DEFAULT);
      form.append('latitude', String(location.latitude));
      form.append('longitude', String(location.longitude));
      form.append('gpsAccuracyMeters', String(location.accuracy || ''));
      form.append(
        'notes',
        `Completed from Routes List plan ${plan.routePlanId}. Flyer: ${flyerLabel(flyer)}`,
      );
      form.append('followUpRequired', 'false');
      form.append('photo', {
        uri: proofUri,
        name: `route-v2-proof-${flyer.key}-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);

      await api.post('/deliveries', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const nextDone = { ...completedFlyers, [flyer.key]: true };
      setCompletedFlyers(nextDone);

      const loc = activeLocation;
      const locationNowDone = loc.flyers.every((f) => nextDone[f.key]);
      if (locationNowDone) {
        Alert.alert('Location complete', 'All flyers at this location are done. Jump to any other stop when ready.');
      } else {
        Alert.alert('Flyer completed', 'Drop the remaining flyer(s) at this location.');
      }
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not complete this flyer.';
      setError(message);
      if (e?.response?.status === 409) {
        Alert.alert('Location unavailable', message);
        await load().catch(() => {});
      }
    } finally {
      setBusy('');
    }
  }

  function goNext() {
    if (activeIndex < displayLocations.length - 1) setActiveIndex(activeIndex + 1);
  }

  function goPrevious() {
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  }

  function jumpToStop(index: number) {
    if (index < 0 || index >= displayLocations.length) return;
    setActiveIndex(index);
  }

  return (
    <View style={styles.screen}>
      <DistributorNav />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <Text style={styles.title}>{routeName}</Text>
            {session ? (
              <Pressable style={styles.checkoutBtn} onPress={checkOutSession} disabled={sessionBusy}>
                <Text style={styles.checkoutBtnText}>{sessionBusy ? '…' : 'Check Out'}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.subtitle}>
            {session
              ? `${displayDate} · Stop ${activeLocation ? activeIndex + 1 : 0} of ${displayLocations.length}${
                  displayLocations.length
                    ? ` · ${phoneGroups.length} phone group(s) · ${configuredCount} configured · ${unconfiguredCount} unconfigured · ${completedLocationCount} done`
                    : ''
                }`
              : `${displayDate} · Check in to start your route`}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!session ? (
          <View style={styles.checkInPanel}>
            <Text style={styles.panelTitle}>Start your route</Text>
            <Text style={styles.panelText}>
              Check in at your current GPS. Your route lists every nearby location — configured
              (mapped) and unconfigured (unmapped) — sorted closest first. Tap any stop to jump
              directly to it.
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
            ) : repCampaigns.length === 0 ? (
              <Text style={styles.panelWarn}>
                No active campaigns are available right now. Ask your admin to publish a campaign.
              </Text>
            ) : (
              <>
                <Pressable
                  style={[styles.bigCheckIn, sessionBusy && styles.disabledButton]}
                  onPress={checkInSession}
                  disabled={sessionBusy}
                >
                  <Text style={styles.bigCheckInText}>
                    {sessionBusy ? 'Starting navigation...' : '📍 Check In & Build My Route'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        <View style={!session ? styles.lockedBody : undefined} pointerEvents={session ? 'auto' : 'none'}>
        {routeBuilding ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.emptyTitle}>Building your route…</Text>
            <Text style={styles.emptyText}>
              Loading nearby stops sorted by distance from your check-in.
            </Text>
          </View>
        ) : !activeLocation ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🗺️</Text>
            <Text style={styles.emptyTitle}>
              {session ? 'No stops to drop right now' : 'Check in to load your route'}
            </Text>
            <Text style={styles.emptyText}>
              {session
                ? 'No uncovered doctors are within range here. Move to a new area and check in again, or check out for now.'
                : 'Your route appears here after you check in.'}
            </Text>
            {session ? (
              <Pressable style={styles.secondaryButton} onPress={refresh}>
                <Text style={styles.secondaryButtonText}>Refresh route</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.stopPicker}>
              <Text style={styles.stopPickerHint}>Grouped by phone · tap any stop to jump</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stopPickerRow}>
                {phoneGroups.map((group) => (
                  <View key={group.phoneKey} style={styles.phoneGroupColumn}>
                    <Text style={styles.phoneGroupLabel} numberOfLines={1}>
                      {group.phoneLabel}
                    </Text>
                    <Text style={styles.phoneGroupMeta}>
                      {group.locations.length} stop{group.locations.length === 1 ? '' : 's'}
                    </Text>
                    <View style={styles.phoneGroupChips}>
                      {group.locations.map((loc) => {
                        const index = locationIndexByKey.get(loc.locationKey) ?? 0;
                        const done = isLocationDone(loc);
                        const isCurrent = index === activeIndex;
                        return (
                          <Pressable
                            key={loc.locationKey}
                            onPress={() => jumpToStop(index)}
                            style={[
                              styles.stopChip,
                              loc.isConfigured ? styles.stopChipConfigured : styles.stopChipUnconfigured,
                              isCurrent && styles.stopChipActive,
                              done && styles.stopChipDone,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stopChipText,
                                isCurrent && styles.stopChipTextActive,
                                done && styles.stopChipDoneText,
                              ]}
                            >
                              {done ? '✓' : `#${index + 1}`}
                            </Text>
                            <Text
                              style={[
                                styles.stopChipMeta,
                                isCurrent && styles.stopChipMetaActive,
                              ]}
                            >
                              {loc.isConfigured ? 'Cfg' : 'New'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.flashCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.stopNumberBadge}>
                  <Text style={styles.stopNumberText}>Stop #{activeIndex + 1}</Text>
                </View>
                <View style={styles.cardBadgeRow}>
                  <View
                    style={[
                      styles.configBadge,
                      activeLocation.isConfigured ? styles.configBadgeOn : styles.configBadgeOff,
                    ]}
                  >
                    <Text style={styles.configBadgeText}>
                      {activeLocation.isConfigured ? 'Configured' : 'Unconfigured'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, activeLocationDone || checkedIn ? styles.toneGreen : styles.toneGray]}>
                    <Text style={styles.statusBadgeText}>
                      {activeLocationDone ? 'Completed' : checkedIn ? 'Checked in' : 'Not checked in'}
                    </Text>
                  </View>
                </View>
              </View>

              {activePhoneGroup ? (
                <View style={styles.phoneGroupBanner}>
                  <Text style={styles.phoneGroupBannerLabel}>Phone group</Text>
                  <Text style={styles.phoneGroupBannerValue}>
                    {activePhoneGroup.phoneLabel} · {activePhoneGroup.locations.length} stop
                    {activePhoneGroup.locations.length === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.targetName}>{locationTitle(activeLocation)}</Text>
              <Text style={styles.targetMeta}>
                {activeLocation.flyers.reduce((sum, f) => sum + f.doctorCount, 0)} doctor(s) here ·{' '}
                {activeLocation.flyers.length} flyer(s) to drop
                {activeLocation.distanceMiles != null
                  ? ` · ${formatDistance(activeLocation.distanceMiles, true)} from check-in`
                  : ''}
              </Text>

              <View style={styles.infoBoxLight}>
                <Text style={styles.infoLabel}>Location</Text>
                <Text style={styles.addressText}>{addressLine(activeLocation) || 'Address pending'}</Text>
                <Text style={styles.coordsText}>{formatCoordinates(activeLocation.latitude, activeLocation.longitude)}</Text>
                {activeLocation.phone ? (
                  <Text style={styles.infoMeta}>Phone: {activeLocation.phone}</Text>
                ) : null}
                {plan?.campaignName ? <Text style={styles.infoMeta}>Campaign: {plan.campaignName}</Text> : null}
              </View>

              <View
                style={[
                  styles.distanceCard,
                  withinCheckInRadius && styles.distanceCardGood,
                  distanceMiles !== null && !withinCheckInRadius && styles.distanceCardBad,
                ]}
              >
                <View style={styles.distanceLeft}>
                  <Text style={styles.distanceLabel}>Check-in radius</Text>
                  <Text
                    style={[
                      styles.distanceValue,
                      withinCheckInRadius && styles.distanceValueGood,
                      distanceMiles !== null && !withinCheckInRadius && styles.distanceValueBad,
                    ]}
                  >
                    {distanceChecking
                      ? 'Checking GPS…'
                      : withinCheckInRadius
                        ? `✓ ${formatDistance(distanceMiles)}`
                        : drivingDistanceMiles !== null
                          ? `Too far · ${formatDistance(drivingDistanceMiles, true)}`
                          : distanceMiles !== null
                            ? `Too far · ${formatDistance(distanceMiles)} straight`
                            : 'GPS required'}
                  </Text>
                  <Text style={styles.distanceHint}>Check-in unlocks within {CHECK_IN_RADIUS_MILES} miles.</Text>
                  {distanceError ? <Text style={styles.distanceError}>{distanceError}</Text> : null}
                </View>
                <Pressable
                  style={styles.refreshGpsButton}
                  onPress={() => refreshDistance(true)}
                  disabled={!!busy || distanceChecking}
                >
                  <Text style={styles.refreshGpsButtonText}>{distanceChecking ? 'Checking…' : 'Refresh GPS'}</Text>
                </Pressable>
              </View>

              <View style={styles.actionGrid}>
                <Pressable style={styles.secondaryActionButton} onPress={navigateToStop} disabled={!!busy}>
                  <Text style={styles.actionIcon}>🧭</Text>
                  <Text style={styles.secondaryButtonText}>Navigate</Text>
                </Pressable>
              </View>

              <Pressable
                style={[
                  styles.checkInButton,
                  checkedIn && styles.checkInButtonDone,
                  !checkedIn && !canCheckIn && styles.disabledButton,
                ]}
                onPress={checkIn}
                disabled={!canCheckIn}
              >
                <Text style={[styles.stepCircle, checkedIn && styles.stepCircleDone]}>{checkedIn ? '✓' : '1'}</Text>
                <View style={styles.stepButtonTextWrap}>
                  <Text style={styles.stepButtonTitle}>
                    {checkedIn ? 'Checked in' : busy === 'checkin' ? 'Checking in…' : 'Check in at this location'}
                  </Text>
                  <Text style={styles.stepButtonSubText}>
                    {checkedIn
                      ? 'Now drop each flyer below'
                      : withinCheckInRadius
                        ? `Inside ${CHECK_IN_RADIUS_MILES}-mile radius`
                        : `Unlocks within ${CHECK_IN_RADIUS_MILES} miles`}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.flyersHeader}>
                <Text style={styles.flyersHeaderText}>Flyers to drop here</Text>
                <View style={styles.flyersHeaderBadge}>
                  <Text style={styles.flyersHeaderBadgeText}>{activeLocation.flyers.length}</Text>
                </View>
              </View>

              {activeLocation.flyers.map((flyer, fi) => {
                const proofUri = proofByFlyer[flyer.key];
                const completing = busy === `complete-${flyer.key}`;
                const takingProof = busy === `proof-${flyer.key}`;
                const flyerDone = isFlyerDone(flyer);
                return (
                  <View key={flyer.key} style={[styles.dropCard, flyerDone && styles.dropCardDone]}>
                    <View style={styles.dropTopRow}>
                      <View style={[styles.dropNumber, flyerDone && styles.dropNumberDone]}>
                        <Text style={[styles.dropNumberText, flyerDone && styles.dropNumberTextDone]}>
                          {flyerDone ? '✓' : fi + 1}
                        </Text>
                      </View>
                      <View style={styles.dropTextWrap}>
                        <Text style={styles.dropName}>{flyerLabel(flyer)}</Text>
                        <Text style={styles.dropMeta}>
                          {flyer.campaignName || 'Campaign'}
                          {flyer.doctorCount > 1 ? ` · covers ${flyer.doctorCount} doctors` : ''}
                          {flyer.doctorLabel ? ` · ${flyer.doctorLabel}` : ''}
                        </Text>
                      </View>
                    </View>

                    {proofUri ? (
                      <View style={styles.proofWrap}>
                        <Image source={{ uri: proofUri }} style={styles.proofPreview} />
                        <View style={styles.proofBadge}>
                          <Text style={styles.proofBadgeText}>{flyerDone ? '✓ Completed' : '✓ Proof ready'}</Text>
                        </View>
                      </View>
                    ) : null}

                    {flyerDone ? (
                      <View style={styles.dropDoneRow}>
                        <Text style={styles.dropDoneText}>✓ Flyer dropped and proof submitted</Text>
                      </View>
                    ) : (
                      <View style={styles.dropActions}>
                        <Pressable
                          style={[styles.dropProofButton, (!checkedIn || !!busy) && styles.disabledButton]}
                          onPress={() => takeProofPhoto(flyer)}
                          disabled={!checkedIn || !!busy}
                        >
                          <Text style={styles.dropProofButtonText}>
                            {takingProof ? 'Opening camera…' : completing ? 'Submitting…' : '📷 Take proof & complete'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.nextRow}>
              <Pressable
                style={[styles.navButton, activeIndex === 0 && styles.disabledButton]}
                onPress={goPrevious}
                disabled={activeIndex === 0}
              >
                <Text style={styles.navButtonText}>Previous</Text>
              </Pressable>
              <Pressable
                style={[styles.navButton, activeIndex >= displayLocations.length - 1 && styles.disabledButton]}
                onPress={goNext}
                disabled={activeIndex >= displayLocations.length - 1}
              >
                <Text style={styles.navButtonText}>Next location</Text>
              </Pressable>
            </View>
          </>
        )}
        </View>
      </ScrollView>
    </View>
  );
}

const colors = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#3f5b76',
  primarySoft: '#e8eef3',
  accent: '#e86a92',
  success: '#16a34a',
  successSoft: '#dcfce7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  warning: '#b45309',
  warningSoft: '#fff7ed',
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  loadingText: { marginTop: 10, color: colors.muted, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 36 },
  hero: {
    borderRadius: 26,
    padding: 20,
    marginBottom: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 8, fontWeight: '700' },
  progressTrack: { height: 9, borderRadius: 999, backgroundColor: '#e2e8f0', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 9, borderRadius: 999, backgroundColor: colors.primary },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: '700', lineHeight: 19 },
  emptyCard: { backgroundColor: colors.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  emptyEmoji: { fontSize: 34, marginBottom: 8 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  emptyText: { color: colors.muted, marginTop: 8, lineHeight: 20, textAlign: 'center' },
  stopPicker: { marginBottom: 12 },
  stopPickerHint: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  stopPickerRow: { gap: 12, paddingRight: 12 },
  phoneGroupColumn: {
    minWidth: 120,
    maxWidth: 220,
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  phoneGroupLabel: { color: colors.text, fontSize: 13, fontWeight: '900' },
  phoneGroupMeta: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2, marginBottom: 8 },
  phoneGroupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  phoneGroupBanner: {
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#99f6e4',
  },
  phoneGroupBannerLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  phoneGroupBannerValue: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 4 },
  stopChip: {
    minWidth: 52,
    height: 52,
    paddingHorizontal: 10,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stopChipConfigured: { borderColor: '#86efac' },
  stopChipUnconfigured: { borderColor: '#fdba74' },
  stopChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stopChipDone: { backgroundColor: colors.successSoft, borderWidth: 2, borderColor: '#86efac' },
  stopChipText: { color: colors.text, fontWeight: '900', fontSize: 13 },
  stopChipTextActive: { color: '#fff' },
  stopChipDoneText: { color: colors.success },
  stopChipMeta: { color: colors.muted, fontSize: 9, fontWeight: '900', marginTop: 1, textTransform: 'uppercase' },
  stopChipMetaActive: { color: 'rgba(255,255,255,0.85)' },
  flashCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 30,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.11,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 },
  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  configBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  configBadgeOn: { backgroundColor: colors.successSoft },
  configBadgeOff: { backgroundColor: colors.warningSoft },
  configBadgeText: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', color: colors.text },
  stopNumberBadge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  stopNumberText: { color: '#fff', fontWeight: '900' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusBadgeText: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', color: colors.text },
  toneGreen: { backgroundColor: colors.successSoft },
  toneGray: { backgroundColor: '#f1f5f9' },
  targetName: { color: colors.text, fontSize: 23, fontWeight: '900', letterSpacing: -0.4 },
  targetMeta: { color: colors.muted, fontSize: 14, marginTop: 6, lineHeight: 20, fontWeight: '600' },
  infoBoxLight: { backgroundColor: '#f8fafc', borderRadius: 20, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  infoLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  infoMeta: { color: colors.muted, fontSize: 13, marginTop: 5, lineHeight: 18 },
  addressText: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 6, lineHeight: 23 },
  coordsText: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 6, lineHeight: 17 },
  distanceCard: { marginTop: 12, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 12 },
  distanceCardGood: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  distanceCardBad: { backgroundColor: colors.warningSoft, borderColor: '#fed7aa' },
  distanceLeft: { flex: 1 },
  distanceLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  distanceValue: { color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 4 },
  distanceValueGood: { color: colors.success },
  distanceValueBad: { color: colors.warning },
  distanceHint: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  distanceError: { color: colors.danger, fontSize: 12, marginTop: 5, fontWeight: '700', lineHeight: 17 },
  refreshGpsButton: { borderRadius: 14, backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 12 },
  refreshGpsButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  proofWrap: { marginTop: 12, position: 'relative' },
  proofPreview: { width: '100%', height: 160, borderRadius: 16, backgroundColor: '#e2e8f0' },
  proofBadge: { position: 'absolute', right: 10, top: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(4, 120, 87, 0.92)' },
  proofBadgeText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  secondaryActionButton: { flexGrow: 1, minWidth: '45%', backgroundColor: '#e2e8f0', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionIcon: { fontSize: 19 },
  secondaryButton: { backgroundColor: '#e2e8f0', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', marginTop: 16 },
  secondaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '900' },
  checkInButton: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primary, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 },
  checkInButtonDone: { backgroundColor: colors.success },
  stepCircle: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', lineHeight: 30, backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: '900' },
  stepCircleDone: { backgroundColor: '#fff', color: colors.success },
  stepButtonTextWrap: { flex: 1 },
  stepButtonTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  stepButtonSubText: { color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 2, fontWeight: '700' },
  flyersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 4 },
  flyersHeaderText: { color: colors.text, fontSize: 16, fontWeight: '900' },
  flyersHeaderBadge: { backgroundColor: colors.primarySoft, borderRadius: 999, minWidth: 24, paddingHorizontal: 8, paddingVertical: 2, alignItems: 'center' },
  flyersHeaderBadgeText: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  dropCard: { backgroundColor: '#fbfaff', borderRadius: 20, borderWidth: 1, borderColor: '#e4e0fb', padding: 14, marginTop: 10 },
  dropCardDone: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  dropTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dropNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dropNumberDone: { backgroundColor: '#16a34a' },
  dropNumberText: { color: colors.primary, fontWeight: '900' },
  dropNumberTextDone: { color: '#fff' },
  dropTextWrap: { flex: 1 },
  dropName: { color: colors.text, fontSize: 17, fontWeight: '900' },
  dropMeta: { color: colors.muted, fontSize: 12, marginTop: 3, fontWeight: '600', lineHeight: 17 },
  dropDoneRow: { marginTop: 12, backgroundColor: '#dcfce7', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12, alignItems: 'center' },
  dropDoneText: { color: '#166534', fontWeight: '900', fontSize: 13 },
  dropActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  dropProofButton: { flex: 1, backgroundColor: '#e2e8f0', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  dropProofButtonText: { color: colors.text, fontWeight: '900', fontSize: 13 },
  disabledButton: { opacity: 0.45 },
  nextRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  navButton: { flex: 1, backgroundColor: '#e86a92', borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  navButtonText: { color: '#fff', fontWeight: '900' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  checkoutBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  checkoutBtnText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  checkInPanel: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  panelTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  panelText: { color: colors.muted, marginTop: 8, lineHeight: 20, fontWeight: '600' },
  panelWarn: { color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: 14, padding: 12, marginTop: 14, fontWeight: '800', lineHeight: 19 },
  panelCampaign: { color: colors.primary, fontWeight: '900', fontSize: 16, marginTop: 14 },
  campaignPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  campaignChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#e2e8f0' },
  campaignChipActive: { backgroundColor: colors.primary },
  campaignChipText: { color: colors.text, fontWeight: '800' },
  campaignChipTextActive: { color: '#fff' },
  bigCheckIn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  bigCheckInText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  lockedBody: { opacity: 0.4 },
});
