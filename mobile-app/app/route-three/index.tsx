import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteStopsMap, StopEnrichmentPanel } from '../../src/features/route-three';
import FrontDeskCard, { type FrontDeskOutcome } from '../../src/features/route-three/FrontDeskCard';
import {
  addressLine,
  formatDistance,
  inferStopKind,
  initialCompletedFlyers,
  locationTitle,
  flyerLabel,
  mergeRecommendedFlyers,
  milesBetween,
  numberValue,
  oneLineAddress,
  planToLocations,
  resolveMappedPracticeName,
  sortLocationsByGps,
  stopDrops,
} from '../../src/features/route-three/routeHelpers';
import {
  clearRouteThreeSession,
  clearStopSelections,
  countPresentAtLocation,
  exportRouteThreeStores,
  getEnrichmentSavePayload,
  getStopEnrichment,
  getStopSelections,
  importRouteThreeStores,
  markEnrichmentSaved,
  setStopEnrichment,
  syncStopSelectionsFromEnrichment,
  updateVisitMeta,
  type RouteThreeStoresSnapshot,
} from '../../src/features/route-three/session';
import type { OrgSelection, ProviderSelection, RoutePlan, StopEnrichment, V2Flyer, V2Location } from '../../src/features/route-three/types';
import { api, API_BASE_URL, describeApiError } from '../../src/services/api';
import { useCheckInRadiusMiles } from '../../src/config';
import { DEV_TEST_LOCATIONS, type DevGpsLocation } from '../../src/config/devLocation';
import {
  alertLocationPermissionError,
  getCurrentLocationSnapshot,
  LocationPermissionError,
} from '../../src/utils/location';
import { getIdleMs } from '../../src/utils/activity';

const PERSON_MET_DEFAULT = 'Front Desk';
const RESPONSE_STATUS_DEFAULT = 'Flyer dropped';

/** Route stays open until the user has not touched the app for this long. */
const ROUTE_IDLE_LIMIT_MS = 5 * 60 * 1000;
const ROUTE_IDLE_CHECK_MS = 15 * 1000;
const ROUTE_SESSION_STORAGE_KEY = 'routeThree.openSession.v1';

type MyPlansResponse = { date: string; plans: RoutePlan[] };
type RepCampaign = { campaignId: number; campaignName?: string | null; flyerTitle?: string | null; remaining: number };
type CheckInSession = {
  checkInId: number;
  stopCount: number;
  skippedHeldCount?: number;
  radiusMiles?: number | null;
  /** When this route was started on the device (drives the "on route" timer). */
  startedAt?: string;
};

type LocationSnapshot = { latitude: number; longitude: number; accuracy: number | null };

type PersistedRouteSession = {
  savedAt: number;
  session: CheckInSession;
  plan: RoutePlan | null;
  routeDate: string;
  activeLocationKey: string | null;
  checkedInByLocation: Record<string, boolean>;
  completedFlyers: Record<string, boolean>;
  proofByFlyer: Record<string, string>;
  closedStopKeys?: Record<string, boolean>;
  lastLocation: LocationSnapshot | null;
  devTestLocation: DevGpsLocation | null;
  stores: RouteThreeStoresSnapshot;
  shift?: {
    completedStops: number;
    totalStops: number;
    flyers: number;
    doctors: number;
    startedAt?: string;
  };
};

async function readPersistedRouteSession(): Promise<PersistedRouteSession | null> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRouteSession;
    if (!parsed || !parsed.session || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedRouteSession() {
  AsyncStorage.removeItem(ROUTE_SESSION_STORAGE_KEY).catch(() => {});
}

function locationErrorMessage(error: unknown) {
  if (error instanceof LocationPermissionError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Could not read GPS location.';
}

function handleLocationError(error: unknown, showAlert = false) {
  if (error instanceof LocationPermissionError) {
    if (showAlert) alertLocationPermissionError(error);
    return error.message;
  }
  return locationErrorMessage(error);
}

export default function RouteThreeScreen() {
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [routeDate, setRouteDate] = useState('');
  const [activeLocationKey, setActiveLocationKey] = useState<string | null>(null);
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
  const [selectionTick, setSelectionTick] = useState(0);
  const [stopSummary, setStopSummary] = useState<
    { locationKey: string; providersAdded: number; orgsConfirmed: number } | null
  >(null);
  const [devTestLocation, setDevTestLocation] = useState<DevGpsLocation | null>(null);
  const [routeView, setRouteView] = useState<'map' | 'detail'>('detail');
  const [closedStopKeys, setClosedStopKeys] = useState<Record<string, boolean>>({});
  const insets = useSafeAreaInsets();
  const [flyerPhotoUri, setFlyerPhotoUri] = useState<string | null>(null);
  const listRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (!session || routeView === 'detail') {
      listRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [session, routeView, activeLocationKey]);
  const [hydrated, setHydrated] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [practiceNameByStop, setPracticeNameByStop] = useState<Record<number, string>>({});
  const [practiceNameLoading, setPracticeNameLoading] = useState(false);
  const [editingPracticeName, setEditingPracticeName] = useState(false);
  const [practiceNameDraft, setPracticeNameDraft] = useState('');
  const [practiceNameSaving, setPracticeNameSaving] = useState(false);
  const [practiceNameSavedNote, setPracticeNameSavedNote] = useState('');

  const CHECK_IN_RADIUS_MILES = useCheckInRadiusMiles();
  const locations = useMemo(() => planToLocations(plan), [plan]);
  const displayLocations = useMemo(
    () => sortLocationsByGps(locations, lastLocation),
    [locations, lastLocation],
  );
  const activeIndex = useMemo(() => {
    if (!activeLocationKey) return 0;
    const idx = displayLocations.findIndex((loc) => loc.locationKey === activeLocationKey);
    return idx >= 0 ? idx : 0;
  }, [displayLocations, activeLocationKey]);
  const activeLocation = displayLocations[activeIndex] || null;
  const activeEnrichment = activeLocation ? getStopEnrichment(activeLocation.routePlanStopId) : null;
  const activeFlyers = useMemo(
    () => mergeRecommendedFlyers(
      activeLocation?.flyers || [],
      activeEnrichment?.recommendedFlyers,
      activeLocation?.routePlanStopId || 0,
    ),
    [activeLocation, activeEnrichment],
  );
  const activeStopKind = activeLocation ? inferStopKind(activeLocation, activeEnrichment) : 'discovery';
  const stopVisitMeta = activeLocation ? getStopSelections(activeLocation.routePlanStopId).visitMeta : null;
  const mappedPracticeName = resolveMappedPracticeName(activeLocation, activeEnrichment);
  const practiceIsMapped = activeStopKind === 'mapped' || Boolean(activeLocation?.isConfigured);
  const lookedUpPracticeName = activeLocation ? practiceNameByStop[activeLocation.routePlanStopId] || '' : '';
  // Only a real practice name: typed by the user, or from Master_Practice. Never a stop label.
  const practiceDisplayName = (
    stopVisitMeta?.practiceName
    || mappedPracticeName
    || lookedUpPracticeName
    || ''
  ).trim();
  void selectionTick;
  const checkedIn = activeLocation ? Boolean(checkedInByLocation[activeLocation.locationKey]) : false;
  const [dropOutcome, setDropOutcome] = useState<FrontDeskOutcome | null>(null);
  const [flyerJobDone, setFlyerJobDone] = useState(false);
  const [flyersOpen, setFlyersOpen] = useState(true);
  const [doctorsOpen, setDoctorsOpen] = useState(false);
  useEffect(() => {
    setFlyerJobDone(false);
    setFlyersOpen(true);
    setDoctorsOpen(false);
  }, [activeLocation?.routePlanStopId]);
  const onDropOutcome = useCallback((outcome: FrontDeskOutcome | null) => {
    setDropOutcome(outcome);
  }, []);
  const withinCheckInRadius = distanceMiles !== null && distanceMiles <= CHECK_IN_RADIUS_MILES;
  // Displayed distance: straight-line from the current GPS fix (same number as the stop chips).
  const liveDistanceMiles = distanceMiles ?? activeLocation?.liveDistanceMiles ?? activeLocation?.distanceMiles ?? null;

  const isFlyerDone = useCallback((flyer: V2Flyer) => Boolean(completedFlyers[flyer.key]), [completedFlyers]);
  const isLocationDone = useCallback(
    (loc: V2Location | null) => {
      if (!loc) return false;
      if (loc.status === 'completed' || loc.status === 'skipped') return true;
      const flyers = mergeRecommendedFlyers(
        loc.flyers,
        getStopEnrichment(loc.routePlanStopId)?.recommendedFlyers,
        loc.routePlanStopId,
      );
      return flyers.length > 0 && flyers.every((f) => completedFlyers[f.key]);
    },
    [completedFlyers],
  );
  const completedLocationCount = useMemo(() => locations.filter((loc) => isLocationDone(loc)).length, [locations, isLocationDone]);
  const canCheckIn = Boolean(activeLocation && !checkedIn && withinCheckInRadius && !distanceChecking && !busy);
  // Set when the user taps "Check in" while too far; the button then turns into "Navigate" for this stop.
  const [checkInTriedKey, setCheckInTriedKey] = useState<string | null>(null);
  const checkInTried = Boolean(activeLocation && checkInTriedKey === activeLocation.locationKey);
  const showNavigate = !checkedIn && checkInTried && !withinCheckInRadius;

  function onCheckInPress() {
    if (!activeLocation) return;
    if (canCheckIn) {
      void checkIn();
      return;
    }
    setCheckInTriedKey(activeLocation.locationKey);
    if (!distanceChecking) void refreshDistance(false);
  }

  const flyersDroppedCount = useMemo(
    () => Object.values(completedFlyers).filter(Boolean).length,
    [completedFlyers],
  );
  const doctorsConfirmedCount = useMemo(
    () => locations.reduce((sum, loc) => sum + countPresentAtLocation(loc.routePlanStopId).total, 0),
    // selectionTick changes whenever a doctor is toggled; locations when the plan changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locations, selectionTick],
  );

  function applyLoadedPlan(nextPlan: RoutePlan | null, date?: string) {
    setPlan(nextPlan);
    setRouteDate(date || nextPlan?.planDate || '');
    setCompletedFlyers((prev) => ({ ...prev, ...initialCompletedFlyers(nextPlan) }));
  }

  async function load() {
    setError('');
    const res = await api.get<MyPlansResponse>('/route-planner/my/plans');
    const nextPlan = res.data.plans?.[0] || null;
    applyLoadedPlan(nextPlan, res.data.date || '');
    return nextPlan;
  }

  const loadRepCampaigns = useCallback(async () => {
    const res = await api.get<{ campaigns: RepCampaign[] }>('/route-planner/my/campaigns');
    setRepCampaigns(res.data?.campaigns || []);
  }, []);

  const loadStopEnrichment = useCallback(async (loc: V2Location) => {
    const existing = getStopEnrichment(loc.routePlanStopId);
    if (existing?.loading) return;

    clearStopSelections(loc.routePlanStopId);

    setStopEnrichment(loc.routePlanStopId, {
      ...(existing || {
        routePlanStopId: loc.routePlanStopId,
        configuredDoctors: [],
        unmappedDoctors: [],
        organizations: [],
        allProviders: [],
        newProviders: [],
        stats: {
          configuredDoctorCount: 0,
          unmappedDoctorCount: 0,
          organizationCount: 0,
          allProviderCount: 0,
          newProviderCount: 0,
          alreadyKnownProviderCount: 0,
          prescriberCount: 0,
          atAddressOrgCount: 0,
        },
        lookupHint: null,
        highDensity: false,
      }),
      loading: true,
      error: undefined,
    });
    setSelectionTick((value) => value + 1);

    try {
      const res = await api.get<StopEnrichment>(`/route-three/stops/${loc.routePlanStopId}/enrichment`);
      const loaded = { ...res.data, loading: false } satisfies StopEnrichment;
      setStopEnrichment(loc.routePlanStopId, loaded);
      syncStopSelectionsFromEnrichment(loc.routePlanStopId, loaded);
      const typedName = getStopSelections(loc.routePlanStopId).visitMeta.practiceName?.trim();
      const dbName = (loaded.practiceName || '').trim();
      updateVisitMeta(loc.routePlanStopId, { practiceName: typedName || dbName });
    } catch (e: any) {
      setStopEnrichment(loc.routePlanStopId, {
        routePlanStopId: loc.routePlanStopId,
        configuredDoctors: [],
        unmappedDoctors: [],
        organizations: [],
        allProviders: [],
        newProviders: [],
        stats: {
          configuredDoctorCount: 0,
          unmappedDoctorCount: 0,
          organizationCount: 0,
          allProviderCount: 0,
          newProviderCount: 0,
          alreadyKnownProviderCount: 0,
          prescriberCount: 0,
          atAddressOrgCount: 0,
        },
        lookupHint: null,
        highDensity: false,
        loading: false,
        error: e?.response?.data?.message || 'Could not load location data.',
      });
    }
    setSelectionTick((value) => value + 1);
  }, []);

  const closeRouteSession = useCallback((notice: string) => {
    setSession(null);
    setPlan(null);
    setRouteDate('');
    setActiveLocationKey(null);
    setCheckedInByLocation({});
    setCompletedFlyers({});
    setProofByFlyer({});
    setStopSummary(null);
    clearRouteThreeSession();
    clearPersistedRouteSession();
    setSessionNotice(notice);
  }, []);

  function endRouteManually() {
    const pendingStops = Math.max(0, locations.length - completedLocationCount);
    Alert.alert(
      'End route?',
      pendingStops
        ? `${pendingStops} stop(s) are not finished. When you start again today, finished stops stay finished and the route opens on the next one.`
        : 'When you start again today, the route opens where you left off.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'End route',
          style: 'destructive',
          onPress: () => closeRouteSession('Route ended. Check in again when you are ready for the next one.'),
        },
      ],
    );
  }

  // Restore an open route (if the app has been used within the idle limit).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await readPersistedRouteSession();
      if (!mounted) return;
      if (!saved) {
        setHydrated(true);
        return;
      }
      const idleMs = await getIdleMs();
      if (!mounted) return;
      const sinceSave = Date.now() - saved.savedAt;
      if (Math.min(idleMs, sinceSave) > ROUTE_IDLE_LIMIT_MS) {
        clearRouteThreeSession();
        clearPersistedRouteSession();
        setSessionNotice('Your route closed after 5 minutes of inactivity. Check in again to rebuild it.');
        setHydrated(true);
        return;
      }
      importRouteThreeStores(saved.stores);
      setSession(saved.session);
      setPlan(saved.plan);
      setRouteDate(saved.routeDate || '');
      setCompletedFlyers(saved.completedFlyers || {});
      setProofByFlyer(saved.proofByFlyer || {});
      setCheckedInByLocation(saved.checkedInByLocation || {});
      setLastLocation(saved.lastLocation || null);
      setDevTestLocation(saved.devTestLocation || null);
      setClosedStopKeys(saved.closedStopKeys || {});
      setActiveLocationKey(saved.activeLocationKey || null);
      setSelectionTick((value) => value + 1);
      setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  // Save the open route whenever it changes.
  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      clearPersistedRouteSession();
      return;
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const snapshot: PersistedRouteSession = {
        savedAt: Date.now(),
        session,
        plan,
        routeDate,
        activeLocationKey,
        checkedInByLocation,
        completedFlyers,
        proofByFlyer,
        closedStopKeys,
        lastLocation,
        devTestLocation,
        stores: exportRouteThreeStores(),
        shift: {
          completedStops: completedLocationCount,
          totalStops: displayLocations.length,
          flyers: flyersDroppedCount,
          doctors: doctorsConfirmedCount,
          startedAt: session.startedAt,
        },
      };
      AsyncStorage.setItem(ROUTE_SESSION_STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {});
    }, 300);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [
    hydrated,
    session,
    plan,
    routeDate,
    activeLocationKey,
    checkedInByLocation,
    completedFlyers,
    proofByFlyer,
    closedStopKeys,
    lastLocation,
    devTestLocation,
    selectionTick,
    completedLocationCount,
    displayLocations.length,
    flyersDroppedCount,
    doctorsConfirmedCount,
  ]);

  // While this screen is open, close the route after the idle limit.
  useFocusEffect(
    useCallback(() => {
      if (!session) return undefined;
      let cancelled = false;
      const check = async () => {
        const idleMs = await getIdleMs();
        if (cancelled) return;
        if (idleMs > ROUTE_IDLE_LIMIT_MS) {
          closeRouteSession('Your route closed after 5 minutes of inactivity. Check in again to rebuild it.');
        }
      };
      check();
      const timer = setInterval(check, ROUTE_IDLE_CHECK_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [session, closeRouteSession]),
  );

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      loadRepCampaigns()
        .catch(() => setError('Could not load your assigned campaigns.'))
        .finally(() => mounted && setLoading(false));
      return () => { mounted = false; };
    }, [loadRepCampaigns]),
  );

  useEffect(() => {
    if (!session || !activeLocation || !checkedIn) return;
    const existing = getStopEnrichment(activeLocation.routePlanStopId);
    // Keep what the user already confirmed at this stop (restored or revisited).
    if (existing && !existing.loading && !existing.error) {
      setSelectionTick((value) => value + 1);
      return;
    }
    loadStopEnrichment(activeLocation);
  }, [session, activeLocation?.routePlanStopId, checkedIn, loadStopEnrichment]);

  useEffect(() => {
    if (!session || !plan) return;
    getCurrentLocation().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, plan?.routePlanId]);

  useEffect(() => {
    setDistanceMiles(null);
    setDrivingDistanceMiles(null);
    setDistanceError('');
    setEditingPracticeName(false);
    setPracticeNameSavedNote('');
    if (activeLocation) refreshDistance(false).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation?.locationKey]);

  // Look up the practice name from the database as soon as a stop is opened.
  useEffect(() => {
    if (!session || !activeLocation) return;
    const stopId = activeLocation.routePlanStopId;
    const known = (getStopSelections(stopId).visitMeta.practiceName || '').trim()
      || resolveMappedPracticeName(activeLocation, getStopEnrichment(stopId))
      || practiceNameByStop[stopId];
    if (known) return;
    let cancelled = false;
    setPracticeNameLoading(true);
    api.get<{ practiceName: string | null }>(`/route-three/stops/${stopId}/practice-name`)
      .then((res) => {
        if (cancelled) return;
        const name = (res.data?.practiceName || '').trim();
        setPracticeNameByStop((prev) => ({ ...prev, [stopId]: name }));
      })
      .catch(() => {
        if (!cancelled) setPracticeNameByStop((prev) => ({ ...prev, [stopId]: '' }));
      })
      .finally(() => {
        if (!cancelled) setPracticeNameLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeLocation?.routePlanStopId]);

  function startEditingPracticeName() {
    setPracticeNameDraft(practiceDisplayName);
    setPracticeNameSavedNote('');
    setEditingPracticeName(true);
  }

  async function savePracticeName() {
    if (!activeLocation) return;
    const name = practiceNameDraft.trim();
    if (!name) return;
    const stopId = activeLocation.routePlanStopId;
    setPracticeNameSaving(true);
    setError('');
    try {
      await api.patch(`/route-three/stops/${stopId}/practice-name`, { practiceName: name });
      updateVisitMeta(stopId, { practiceName: name });
      setPracticeNameByStop((prev) => ({ ...prev, [stopId]: name }));
      const existing = getStopEnrichment(stopId);
      if (existing && !existing.loading) {
        setStopEnrichment(stopId, { ...existing, practiceName: name });
      }
      setSelectionTick((tick) => tick + 1);
      setEditingPracticeName(false);
      setPracticeNameSavedNote('Saved to this stop.');
    } catch (e: unknown) {
      const message = describeApiError(e, 'Could not save the practice name.');
      setError(message);
      Alert.alert('Save failed', message);
    } finally {
      setPracticeNameSaving(false);
    }
  }

  async function getCurrentLocation(): Promise<LocationSnapshot> {
    if (devTestLocation) {
      const snapshot = {
        latitude: devTestLocation.latitude,
        longitude: devTestLocation.longitude,
        accuracy: 5,
      };
      setLastLocation(snapshot);
      return snapshot;
    }
    const snapshot = await getCurrentLocationSnapshot();
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
        const distRes = await api.post<{ drivingMiles?: number }>('/route-planner/driving-distance', {
          from: { lat: location.latitude, lng: location.longitude },
          to: { lat: targetLatitude, lng: targetLongitude },
        });
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
            : `About ${drivingMiles.toFixed(1)} mi driving. Check-in unlocks within ${CHECK_IN_RADIUS_MILES} miles.`,
        );
      }
      return { location, miles: straightMiles, drivingMiles };
    } catch (e: unknown) {
      setDistanceMiles(null);
      const message = handleLocationError(e, true);
      setDistanceError(message);
      return null;
    } finally {
      setDistanceChecking(false);
    }
  }

  async function checkInSession() {
    setSessionBusy(true);
    setError('');
    setSessionNotice('');
    clearRouteThreeSession();
    try {
      const loc = await getCurrentLocation();
      try {
        await api.get('/health', { timeout: 8000 });
      } catch {
        const message = `Cannot reach the server at ${API_BASE_URL}. Confirm the backend is running and this phone is on the same Wi-Fi.`;
        setError(message);
        Alert.alert('Check-in failed', message);
        return;
      }
      const res = await api.post('/route-planner/my/checkin', { lat: loc.latitude, lng: loc.longitude }, { timeout: 180000 });
      const data = res.data || {};
      const sessionData: CheckInSession = {
        checkInId: data.checkInId,
        stopCount: data.stopCount ?? 0,
        skippedHeldCount: data.skippedHeldCount ?? 0,
        radiusMiles: data.radiusMiles ?? null,
        startedAt: new Date().toISOString(),
      };

      if (!sessionData.stopCount) {
        setSession(sessionData);
        setPlan(null);
        setCompletedFlyers({});
        return;
      }

      const inlinePlan = data.plan as RoutePlan | null | undefined;
      let loadedPlan: RoutePlan | null = inlinePlan || null;
      setCompletedFlyers({});
      setClosedStopKeys({});
      if (inlinePlan) applyLoadedPlan(inlinePlan, inlinePlan.planDate || '');
      else loadedPlan = await load();

      setSession(sessionData);
      setActiveLocationKey(null);
      setCheckedInByLocation({});
      const nextLocs = sortLocationsByGps(planToLocations(loadedPlan), loc);
      const resumeAt = nextLocs.find((item) => item.status !== 'completed' && item.status !== 'skipped');
      if (resumeAt) setActiveLocationKey(resumeAt.locationKey);
      else if (nextLocs[0]) setActiveLocationKey(nextLocs[0].locationKey);
      setRouteView('detail');
    } catch (e: unknown) {
      if (e instanceof LocationPermissionError) {
        const message = handleLocationError(e, true);
        setError(message);
        return;
      }
      const apiMessage = describeApiError(e, 'Check-in failed.');
      const message = apiMessage || locationErrorMessage(e) || 'Check-in failed.';
      setError(message);
      Alert.alert('Check-in failed', message);
    } finally {
      setSessionBusy(false);
    }
  }

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

  async function checkIn() {
    if (!activeLocation) return;
    setBusy('checkin');
    try {
      const distanceResult = await refreshDistance(false);
      if (!distanceResult || distanceResult.miles > CHECK_IN_RADIUS_MILES) {
        Alert.alert('Too far to check in', `Move within ${CHECK_IN_RADIUS_MILES} miles of this stop.`);
        return;
      }
      setCheckedInByLocation((prev) => ({ ...prev, [activeLocation.locationKey]: true }));
      await loadStopEnrichment(activeLocation);
    } finally {
      setBusy('');
    }
  }

  async function saveEnrichmentForStop(
    loc: V2Location,
    flyer: V2Flyer,
    proofUri: string,
    dropIds: number[],
  ) {
    const { linkedOrgs, providers, discovered, discoverProviders, practiceName, discoverLocation } =
      getEnrichmentSavePayload(loc.routePlanStopId);
    const mappedPracticeName = resolveMappedPracticeName(loc, getStopEnrichment(loc.routePlanStopId));
    const location = lastLocation || (await getCurrentLocation());
    const effectiveAddress = discoverLocation?.locationAddress || oneLineAddress(loc);
    const effectiveLat = discoverLocation?.latitude ?? location.latitude;
    const effectiveLng = discoverLocation?.longitude ?? location.longitude;
    const addressParts = discoverLocation?.addressParts;
    const form = new FormData();

    form.append('practiceName', practiceName || mappedPracticeName || '');
    form.append('locationAddress', effectiveAddress);
    form.append('street', addressParts?.street || loc.addressStreet || '');
    form.append('city', addressParts?.city || loc.addressCity || '');
    form.append('state', addressParts?.state || loc.addressState || 'FL');
    form.append('postalCode', addressParts?.postalCode || loc.addressZip || '');
    form.append('latitude', String(effectiveLat));
    form.append('longitude', String(effectiveLng));
    form.append(
      'physicalDropJson',
      JSON.stringify({
        dropStatus: 'dropped',
        stopType: loc.isConfigured ? 'clinic_office' : 'unknown',
        campaignId: flyer.campaignId,
        flyerTitle: flyerLabel(flyer),
        flyerQuantity: 1,
        notes: `Route Three stop ${loc.routePlanStopId}`,
        droppedAt: new Date().toISOString(),
      }),
    );
    form.append(
      'orgLinksJson',
      JSON.stringify(
        linkedOrgs.map((org: OrgSelection) => ({
          organizationNpi: org.organizationNpi,
          organizationName: org.organizationName,
          organizationAddress: org.organizationAddress,
          taxonomyCode: org.taxonomyCode || '',
          taxonomyDescription: org.taxonomyDescription || '',
          distanceMiles: org.distanceMiles,
          suiteLabel: org.suiteLabel || '',
          verificationStatus: org.verificationStatus,
        })),
      ),
    );
    form.append(
      'providersJson',
      JSON.stringify([
        ...providers.map((provider: ProviderSelection) => ({
          npi: provider.npi,
          providerName: provider.providerName,
          providerAddress: provider.providerAddress,
          phone: provider.phone.replace(/\D/g, '') || '',
          taxonomyCode: provider.taxonomyCode || '',
          taxonomyDesc: provider.taxonomyDescription || '',
          verificationStatus: provider.verificationStatus,
          selectedForReview: true,
        })),
        ...discovered.map((entry) => ({
          npi: '',
          providerName: entry.name,
          providerAddress: effectiveAddress,
          phone: entry.phone.replace(/\D/g, '') || '',
          taxonomyCode: '',
          taxonomyDesc: entry.specialty,
          verificationStatus: 'selected_for_review',
          selectedForReview: true,
        })),
        ...discoverProviders.map((entry) => ({
          npi: '',
          providerName: entry.providerName,
          providerAddress: entry.providerAddress || effectiveAddress,
          phone: entry.phone.replace(/\D/g, '') || '',
          taxonomyCode: '',
          taxonomyDesc: entry.specialty,
          verificationStatus: 'selected_for_review',
          selectedForReview: true,
        })),
      ]),
    );
    form.append('routePlanDropIdsJson', JSON.stringify(dropIds));
    form.append('photo', {
      uri: proofUri,
      name: `route-three-${loc.routePlanStopId}-${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as any);

    await api.post(`/route-three/stops/${loc.routePlanStopId}/save-enrichment`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    markEnrichmentSaved(loc.routePlanStopId);
  }

  async function completeFlyer(
    flyer: V2Flyer,
    overrideProofUri?: string,
    options?: { skipEnrichment?: boolean; sameStopBatch?: boolean; note?: string },
  ) {
    if (!activeLocation || !plan || !checkedIn) return;
    const proofUri = overrideProofUri ?? proofByFlyer[flyer.key];
    if (!proofUri) {
      Alert.alert('Proof required', 'Take a proof photo before completing this flyer.');
      return;
    }

    setBusy(`complete-${flyer.key}`);
    setError('');
    try {
      const payload = getEnrichmentSavePayload(activeLocation.routePlanStopId);
      const effectivePractice = (payload.practiceName || resolveMappedPracticeName(activeLocation, activeEnrichment)).trim();

      const location = lastLocation || (await getCurrentLocation());
      const stop = plan.stops.find((s) => s.routePlanStopId === activeLocation.routePlanStopId);
      const stopDropsForFlyer = stop
        ? stopDrops(stop).filter((d) => Number(d.campaignId) === flyer.campaignId)
        : [];
      const primaryDoctorId = stopDropsForFlyer.find((d) => d.doctorId)?.doctorId ?? null;

      if (!options?.skipEnrichment) {
        await saveEnrichmentForStop(activeLocation, flyer, proofUri, flyer.dropIds);
      }

      const form = new FormData();
      form.append('campaignId', String(flyer.campaignId));
      form.append('locationKey', activeLocation.locationKey);
      if (primaryDoctorId) form.append('doctorId', String(primaryDoctorId));
      form.append('proofRequired', 'true');
      form.append('doctorName', flyer.doctorLabel || effectivePractice || 'Route stop');
      form.append('clinicName', effectivePractice);
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
      form.append('notes', options?.note || `Route Three plan ${plan.routePlanId}. Flyer: ${flyerLabel(flyer)}`);
      form.append('followUpRequired', 'false');
      if (options?.sameStopBatch) form.append('sameStopBatch', 'true');
      form.append('photo', {
        uri: proofUri,
        name: `route-three-proof-${flyer.key}-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);

      await api.post('/deliveries', form, { headers: { 'Content-Type': 'multipart/form-data' } });

      let nextDone: Record<string, boolean> = {};
      setCompletedFlyers((prev) => {
        nextDone = { ...prev, [flyer.key]: true };
        return nextDone;
      });

      const stopFlyers = mergeRecommendedFlyers(
        activeLocation.flyers,
        getStopEnrichment(activeLocation.routePlanStopId)?.recommendedFlyers,
        activeLocation.routePlanStopId,
      );
      const stopDone = stopFlyers.length > 0 && stopFlyers.every((f) => nextDone[f.key]);
      if (stopDone) {
        const payload = getEnrichmentSavePayload(activeLocation.routePlanStopId);
        setStopSummary({
          locationKey: activeLocation.locationKey,
          providersAdded: payload.providers.length,
          orgsConfirmed: payload.linkedOrgs.filter((o: OrgSelection) => o.verificationStatus === 'confirmed_on_site').length,
        });
      }
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not complete this flyer.';
      setError(message);
      if (e?.response?.status === 409) await load().catch(() => {});
    } finally {
      setBusy('');
    }
  }

  async function takeStopProof() {
    if (!activeLocation || !checkedIn) return;
    if (dropOutcome !== 'accepted' && dropOutcome !== 'left_at_desk') {
      Alert.alert('Where did you leave the flyers?', 'Tap Accepted or Left at desk, then take one proof photo.');
      return;
    }
    setBusy('proof-stop');
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libraryPermission.granted) {
          Alert.alert('Permission needed', 'Allow camera or photo library access.');
          return;
        }
      }
      const proofOptions = { quality: 0.4, allowsEditing: false, exif: false };
      const picked = await ImagePicker.launchCameraAsync(proofOptions).catch(() =>
        ImagePicker.launchImageLibraryAsync({ ...proofOptions, mediaTypes: ImagePicker.MediaTypeOptions.Images }),
      );
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const longEdge = Math.max(asset.width || 0, asset.height || 0);
      const resized = await manipulateAsync(
        asset.uri,
        longEdge > 1280
          ? [{ resize: (asset.width || 0) >= (asset.height || 0) ? { width: 1280 } : { height: 1280 } }]
          : [],
        { compress: 0.45, format: SaveFormat.JPEG },
      );
      const uri = resized.uri;
      const stopKey = `stop-proof:${activeLocation.routePlanStopId}`;
      const allDropIds = [...new Set(activeFlyers.flatMap((flyer) => flyer.dropIds || []))];
      setProofByFlyer((prev) => {
        const next = { ...prev, [stopKey]: uri };
        for (const flyer of activeFlyers) next[flyer.key] = uri;
        return next;
      });
      setCompletedFlyers((prev) => {
        const next = { ...prev };
        for (const flyer of activeFlyers) next[flyer.key] = true;
        return next;
      });
      if (activeFlyers.length) {
        await saveEnrichmentForStop(activeLocation, activeFlyers[0], uri, allDropIds);
        const names = activeFlyers.map((flyer) => flyerLabel(flyer)).join(', ');
        await completeFlyer(activeFlyers[0], uri, {
          skipEnrichment: true,
          sameStopBatch: true,
          note: `One photo for every flyer left at this desk: ${names}`,
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Could not capture proof photo.');
    } finally {
      setBusy('');
    }
  }

  async function navigateToLocation(loc: V2Location) {
    const lat = numberValue(loc.latitude);
    const lng = numberValue(loc.longitude);
    const address = oneLineAddress(loc) || locationTitle(loc) || '';
    const destination = lat !== null && lng !== null ? `${lat},${lng}` : address;
    if (!destination) return;
    const url = Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    await Linking.openURL(url);
  }

  function navigateToStop() {
    if (!activeLocation) return;
    void navigateToLocation(activeLocation);
  }

  const stopComplete = activeFlyers.length > 0 && activeFlyers.every((flyer) => isFlyerDone(flyer));
  const stopProofUri = activeLocation
    ? (proofByFlyer[`stop-proof:${activeLocation.routePlanStopId}`]
      || activeFlyers.map((flyer) => proofByFlyer[flyer.key]).find(Boolean)
      || '')
    : '';
  const positiveDrop = dropOutcome === 'accepted' || dropOutcome === 'left_at_desk';
  const showDoctors = flyerJobDone;
  const negativeDrop = dropOutcome === 'refused' || dropOutcome === 'closed' || dropOutcome === 'wrong_address';
  const canAdvanceStop = checkedIn && (negativeDrop || Boolean(stopProofUri));
  const nextStopDisabled = !canAdvanceStop;
  const stopProgressLabel = displayLocations.length
    ? `Stop ${activeIndex + 1} of ${displayLocations.length}`
    : '';
  const showStopSummary = stopSummary && activeLocation && stopSummary.locationKey === activeLocation.locationKey;

  function goToLocation(loc: V2Location) {
    setActiveLocationKey(loc.locationKey);
    setStopSummary(null);
  }

  function isStopClosed(loc: V2Location) {
    if (closedStopKeys[loc.locationKey]) return true;
    if (loc.locationKey === activeLocation?.locationKey) return false;
    return isLocationDone(loc);
  }

  function nextPendingStop() {
    for (let step = 1; step < displayLocations.length; step += 1) {
      const loc = displayLocations[(activeIndex + step) % displayLocations.length];
      if (loc && !isStopClosed(loc)) return loc;
    }
    return null;
  }

  function openStop(loc: V2Location) {
    goToLocation(loc);
    setRouteView('detail');
  }

  async function finishStopAndContinue() {
    if (!activeLocation || !canAdvanceStop || busy) return;
    const current = activeLocation;
    const next = nextPendingStop();
    setBusy('finish-stop');
    setError('');
    try {
      await api.post(`/route-planner/stops/${current.routePlanStopId}/complete`);
      setPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stops: prev.stops.map((stop) => (
            stop.routePlanStopId === current.routePlanStopId
              ? {
                  ...stop,
                  status: 'completed',
                  drops: (stop.drops || []).map((drop) => ({ ...drop, status: 'completed' })),
                }
              : stop
          )),
        };
      });
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status !== 409) {
        const message = describeApiError(e, 'Could not save this stop.');
        setError(message);
        Alert.alert('Stop not saved', 'This stop is still open, so the route would start here again. Try once more.');
        return;
      }
    } finally {
      setBusy('');
    }
    setClosedStopKeys((prev) => ({ ...prev, [current.locationKey]: true }));
    if (!next) return;
    openStop(next);
  }

  const upcomingStop = activeLocation ? nextPendingStop() : null;
  const routeComplete = Boolean(
    activeLocation && closedStopKeys[activeLocation.locationKey] && !upcomingStop,
  );

  return (
    <View style={styles.screen}>
      {session && activeLocation && routeView === 'map' ? (
        <View style={styles.mapPane}>
        <RouteStopsMap
          stops={displayLocations}
          activeLocationKey={activeLocationKey}
          userLatitude={lastLocation?.latitude}
          userLongitude={lastLocation?.longitude}
          radiusMiles={numberValue(plan?.radiusMiles) ?? session.radiusMiles ?? 5}
          radiusLatitude={numberValue(plan?.startLatitude)}
          radiusLongitude={numberValue(plan?.startLongitude)}
          isStopDone={isLocationDone}
          onSelectStop={goToLocation}
          onOpenStop={openStop}
          onNavigate={navigateToStop}
        />
        </View>
      ) : (
      <ScrollView
        ref={listRef}
        style={styles.routeScroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!session && sessionNotice ? <Text style={styles.notice}>{sessionNotice}</Text> : null}

        {!hydrated ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : !session ? (
          <View>
            <View style={styles.startCard}>
              <View style={styles.startIconWrap}>
                <Ionicons name="map" size={28} color="#3f5b76" />
              </View>
              <Text style={styles.startTitle}>Start today's route</Text>
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
              ) : repCampaigns.length === 0 ? (
                <Text style={styles.panelWarn}>No active campaigns available right now.</Text>
              ) : (
                <Pressable style={[styles.bigCheckIn, sessionBusy && styles.disabledButton]} onPress={checkInSession} disabled={sessionBusy}>
                  <Text style={styles.bigCheckInText}>{sessionBusy ? 'Building your route…' : 'Start to navigate'}</Text>
                </Pressable>
              )}
              {__DEV__ ? (
                <View style={styles.devLocationCard}>
                  <Text style={styles.devLocationTitle}>Developer test GPS</Text>
                  <Text style={styles.devLocationSub}>
                    Optional: pretend you are in St Pete when testing per-stop GPS arrival or local NPI radius. Not required for basic route testing from Austin.
                  </Text>
                  {DEV_TEST_LOCATIONS.map((location) => {
                    const active = devTestLocation?.label === location.label;
                    return (
                      <Pressable
                        key={location.label}
                        style={[styles.devLocationBtn, active && styles.devLocationBtnActive]}
                        onPress={() => {
                          setDevTestLocation(active ? null : location);
                          setLastLocation(active ? null : {
                            latitude: location.latitude,
                            longitude: location.longitude,
                            accuracy: 5,
                          });
                        }}
                      >
                        <Text style={[styles.devLocationBtnText, active && styles.devLocationBtnTextActive]}>
                          {active ? 'Using ' : 'Use '}{location.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.devLocationHint}>
                    {devTestLocation
                      ? `Check-in uses ${devTestLocation.label} (${devTestLocation.latitude.toFixed(4)}, ${devTestLocation.longitude.toFixed(4)}). Re-check-in after switching.`
                      : 'Using your real GPS. Pick Brian Bill Foundation for ~1 mi to downtown MLK; Downtown for dense nearby NPI.'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : !activeLocation ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No stops to drop right now</Text>
            <Text style={styles.emptySub}>Move to a new area and pull to refresh, or check in again.</Text>
            <Pressable style={styles.endRouteBtn} onPress={endRouteManually} hitSlop={8}>
              <Ionicons name="flag-outline" size={15} color={colors.danger} />
              <Text style={styles.endRouteText}>End today's route</Text>
            </Pressable>
          </View>
        ) : routeComplete ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle" size={36} color={colors.success} />
            <Text style={styles.emptyTitle}>Route complete</Text>
            <Text style={styles.emptySub}>Every stop is done. You can end today's route.</Text>
          </View>
        ) : (
          <>
            {checkedIn ? (
              <View style={styles.checkedInStrip}>
                <Text style={styles.checkedInProgress}>{stopProgressLabel}</Text>
                <View style={styles.checkedInRow}>
                  <Text style={styles.checkedInName} numberOfLines={1}>
                    {practiceDisplayName || 'This stop'}
                  </Text>
                  <Text style={styles.checkedInAddress} numberOfLines={1}>
                    {oneLineAddress(activeLocation) || 'Address pending'}
                  </Text>
                  <View style={styles.checkedInBadge}>
                    <Ionicons name="checkmark-circle" size={15} color="#16a34a" />
                    <Text style={styles.checkedInBadgeText}>Checked in</Text>
                  </View>
                </View>
              </View>
            ) : (
            <View style={styles.heroCard}>
              <View style={[styles.heroAccent, showNavigate ? styles.heroAccentFar : null]} />
              <View style={styles.practiceHeader}>
                <Text style={styles.eyebrow}>{stopProgressLabel || 'Current stop'}</Text>
                {!editingPracticeName && !practiceNameLoading ? (
                  <Pressable style={styles.editPill} onPress={startEditingPracticeName} hitSlop={8}>
                    <Ionicons name={practiceDisplayName ? 'pencil' : 'add'} size={13} color={colors.primary} />
                    <Text style={styles.practiceEditLink}>{practiceDisplayName ? 'Edit' : 'Add name'}</Text>
                  </Pressable>
                ) : null}
              </View>

              {editingPracticeName ? (
                <>
                  <TextInput
                    value={practiceNameDraft}
                    onChangeText={setPracticeNameDraft}
                    style={styles.practiceInput}
                    placeholder="Practice name on the door"
                    placeholderTextColor="#94a3b8"
                    autoFocus
                    autoCapitalize="words"
                    editable={!practiceNameSaving}
                  />
                  <View style={styles.practiceActions}>
                    <Pressable
                      style={styles.practiceCancelBtn}
                      onPress={() => setEditingPracticeName(false)}
                      disabled={practiceNameSaving}
                    >
                      <Text style={styles.practiceCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.practiceSaveBtn, (!practiceNameDraft.trim() || practiceNameSaving) && styles.disabledButton]}
                      onPress={savePracticeName}
                      disabled={!practiceNameDraft.trim() || practiceNameSaving}
                    >
                      {practiceNameSaving ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.practiceSaveText}>Save name</Text>
                      )}
                    </Pressable>
                  </View>
                </>
              ) : practiceDisplayName ? (
                <Text style={styles.currentStopName}>{practiceDisplayName}</Text>
              ) : practiceNameLoading ? (
                <Text style={styles.practicePending}>Looking up practice…</Text>
              ) : (
                <Text style={styles.practicePending}>Add the practice name</Text>
              )}
              {practiceNameSavedNote ? <Text style={styles.practiceSavedNote}>{practiceNameSavedNote}</Text> : null}

              <View style={styles.addressBlock}>
                <View style={styles.addressIcon}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                </View>
                <Text style={styles.addressText}>{addressLine(activeLocation) || 'Address pending'}</Text>
              </View>

              <View style={[styles.arriveRow, withinCheckInRadius ? styles.arriveRowReady : styles.arriveRowFar]}>
                <Ionicons
                  name={withinCheckInRadius ? 'radio-button-on' : 'navigate-outline'}
                  size={16}
                  color={withinCheckInRadius ? '#3f5b76' : '#b45309'}
                />
                <Text style={styles.arriveText} numberOfLines={2}>
                  {distanceChecking
                    ? 'Checking your location…'
                    : withinCheckInRadius
                      ? 'You are at this stop. Check in to drop the flyers.'
                      : `${formatDistance(liveDistanceMiles)} away. Navigate, then check in when you arrive.`}
                </Text>
              </View>
              <Pressable style={styles.navGo} onPress={navigateToStop}>
                <Ionicons name="navigate" size={18} color="#fff" />
                <Text style={styles.bigCheckInText}>Navigate</Text>
              </Pressable>
              {withinCheckInRadius ? (
                <Pressable
                  style={[styles.checkInBelow, (Boolean(busy) || distanceChecking) && styles.disabledButton]}
                  onPress={onCheckInPress}
                  disabled={Boolean(busy) || distanceChecking}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.bigCheckInText}>{busy ? 'Checking in…' : 'Check in'}</Text>
                </Pressable>
              ) : (
                <View style={styles.checkInWait}>
                  <Ionicons name="lock-closed-outline" size={15} color={colors.muted} />
                  <Text style={styles.checkInWaitText}>Check in when you arrive</Text>
                </View>
              )}
              {distanceError ? <Text style={styles.gpsError}>{distanceError}</Text> : null}
            </View>
            )}

            {checkedIn ? (
            <>
            <TaskSection
              step="2"
              title="Flyers to drop"
              hint={stopComplete ? 'One photo covers every flyer left at this desk.' : 'Take these from the car, leave them all at the desk, then take one photo.'}
              state={stopComplete ? 'done' : 'now'}
              expanded={flyersOpen}
              onToggle={() => setFlyersOpen((open) => !open)}
            >
              {activeFlyers.length === 0 ? (
                <Text style={styles.mutedNote}>No flyers are assigned to this stop.</Text>
              ) : activeFlyers.map((flyer) => {
                const flyerDone = isFlyerDone(flyer);
                const flyerPhoto = proofByFlyer[flyer.key];
                return (
                  <View key={flyer.key} style={styles.flyerLine}>
                    <Text style={styles.dropName} numberOfLines={2}>{flyerLabel(flyer)}</Text>
                    {flyerPhoto ? (
                      <Pressable style={styles.viewPhotoBtn} onPress={() => setFlyerPhotoUri(flyerPhoto)} hitSlop={6}>
                        <Ionicons name="image-outline" size={15} color={colors.primary} />
                        <Text style={styles.viewPhotoText}>View</Text>
                      </Pressable>
                    ) : null}
                    <View style={[styles.statusPill, flyerDone ? styles.statusPillDone : styles.statusPillPending]}>
                      <Text style={[styles.statusPillText, flyerDone ? styles.statusPillTextDone : styles.statusPillTextPending]}>
                        {flyerDone ? 'Completed' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                );
              })}

              <FrontDeskCard
                routePlanStopId={activeLocation.routePlanStopId}
                enabled={checkedIn}
                onOutcomeChange={onDropOutcome}
                proofUri={stopProofUri}
                proofBusy={busy === 'proof-stop'}
                onTakeProof={() => void takeStopProof()}
                onNext={() => {
                  setFlyerJobDone(true);
                  setFlyersOpen(false);
                  setDoctorsOpen(true);
                }}
              />

              {/* Completion summary */}
              {showStopSummary ? (
                <View style={styles.completeCard}>
                  <Text style={styles.completeTitle}>Stop complete</Text>
                  <Text style={styles.completeLine}>✓ Proof photo uploaded</Text>
                  <Text style={styles.completeLine}>✓ {stopSummary!.providersAdded} new provider(s) added for review</Text>
                  <Text style={styles.completeLine}>✓ {stopSummary!.orgsConfirmed} organization(s) confirmed</Text>
                  <View style={styles.completeActions}>
                    <Pressable style={styles.completeSecondary} onPress={() => setStopSummary(null)}>
                      <Text style={styles.completeSecondaryText}>Stay on this stop</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.completePrimary, nextStopDisabled && styles.disabledButton]}
                      onPress={finishStopAndContinue}
                      disabled={nextStopDisabled}
                    >
                      <Text style={styles.completePrimaryText}>{upcomingStop ? 'Next stop' : 'Finish route'}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </TaskSection>

            {showDoctors ? (
            <TaskSection
              step="3"
              title={practiceDisplayName ? `Doctors at ${practiceDisplayName}` : 'Doctors at this practice'}
              hint="Confirm which providers are here."
              corner={activeEnrichment?.standardizedAddress || oneLineAddress(activeLocation) || ''}
              state="now"
              expanded={doctorsOpen}
              onToggle={() => setDoctorsOpen((open) => !open)}
            >
                <StopEnrichmentPanel
                  routePlanStopId={activeLocation.routePlanStopId}
                  enrichment={activeEnrichment}
                  checkedIn={checkedIn}
                  stopKind={activeStopKind}
                  stopLocation={activeLocation}
                  refreshKey={selectionTick}
                  onSelectionsChange={() => setSelectionTick((value) => value + 1)}
                />
            </TaskSection>
            ) : null}
            </>
            ) : null}

            <View style={styles.stopMove}>
              {canAdvanceStop ? (
                <Pressable style={styles.doneStopBtn} onPress={finishStopAndContinue}>
                  <Text style={styles.doneStopText}>{upcomingStop ? 'Done at this stop' : 'Done — finish route'}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </Pressable>
              ) : (
                <Text style={styles.stopMoveLabel}>
                  {checkedIn
                    ? 'Drop the flyers here. When you are done, the next stop opens.'
                    : 'Navigate to this stop. Check in turns on when you arrive.'}
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
      )}
      {session && displayLocations.length ? (
        <View style={[styles.routeFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Text style={styles.footerProgress}>{stopProgressLabel}</Text>
          {routeView === 'map' ? null : (
          <View style={styles.viewSwitch}>
            <Pressable
              style={[styles.viewSegment, styles.viewSegmentOn]}
              onPress={() => setRouteView('detail')}
            >
              <Ionicons name="location" size={16} color="#fff" />
              <Text style={[styles.viewSegmentText, styles.viewSegmentTextOn]}>This stop</Text>
            </Pressable>
            <Pressable
              style={styles.viewSegment}
              onPress={() => setRouteView('map')}
            >
              <Ionicons name="map" size={16} color={colors.muted} />
              <Text style={styles.viewSegmentText}>Map</Text>
            </Pressable>
          </View>
          )}
          <Pressable style={styles.endRouteBtn} onPress={endRouteManually} hitSlop={6}>
            <Ionicons name="flag-outline" size={15} color={colors.danger} />
            <Text style={styles.endRouteText}>End today's route</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={Boolean(flyerPhotoUri)} transparent animationType="fade" onRequestClose={() => setFlyerPhotoUri(null)}>
        <Pressable style={styles.photoBackdrop} onPress={() => setFlyerPhotoUri(null)}>
          <Pressable style={styles.photoSheet} onPress={() => {}}>
            {flyerPhotoUri ? <Image source={{ uri: flyerPhotoUri }} style={styles.photoFull} resizeMode="contain" /> : null}
            <Pressable style={styles.photoClose} onPress={() => setFlyerPhotoUri(null)}>
              <Text style={styles.photoCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TaskSection({
  step,
  title,
  hint,
  corner,
  state,
  expanded = true,
  onToggle,
  children,
}: {
  step: string;
  title: string;
  hint: string;
  corner?: string;
  state: 'now' | 'ready' | 'done' | 'later';
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={[
      styles.task,
      state === 'now' && styles.taskNow,
      state === 'done' && styles.taskDone,
      state === 'later' && styles.taskLater,
    ]}>
      <Pressable style={styles.taskHead} onPress={onToggle} disabled={!onToggle}>
        <View style={[styles.taskNum, state === 'done' && styles.taskNumDone]}>
          <Text style={[styles.taskNumText, state === 'done' && styles.taskNumTextOn]}>
            {state === 'done' ? '✓' : step}
          </Text>
        </View>
        <View style={styles.taskHeadCopy}>
          <Text style={styles.taskTitle}>{title}</Text>
          {expanded ? <Text style={styles.taskHint}>{hint}</Text> : null}
        </View>
        {corner ? (
          <Text style={styles.taskCorner} numberOfLines={2}>{corner}</Text>
        ) : null}
        {onToggle ? (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
        ) : null}
      </Pressable>
      {expanded ? <View style={styles.taskBody}>{children}</View> : null}
    </View>
  );
}

const colors = {
  bg: '#f3f4f6',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  primary: '#3f5b76',
  accent: '#e86a92',
  primarySoft: '#e8eef3',
  success: '#16a34a',
  successSoft: '#ecfdf5',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  warning: '#b45309',
  warningSoft: '#fffbeb',
};

const cardShadow = {
  shadowColor: '#111827',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  routeScroll: { flex: 1 },
  mapPane: { flex: 1 },
  routeFooter: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 6,
  },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  viewSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  viewSegmentOn: { backgroundColor: colors.primary },
  viewSegmentText: { color: colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  viewSegmentTextOn: { color: '#fff' },
  footerProgress: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  stopsList: { backgroundColor: colors.card, borderRadius: 22, ...cardShadow },
  stopListRow: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stopListName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  stopListAddress: { color: colors.muted, fontSize: 14, fontWeight: '500', marginTop: 3, lineHeight: 20 },
  viewToggleSticky: { marginTop: 0 },
  content: { padding: 16, paddingBottom: 48 },

  endRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  endRouteText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  navGo: {
    marginTop: 16,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  checkInWait: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  checkInWaitText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  checkInBelow: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  checkInBelowAlt: {
    marginTop: 16,
    backgroundColor: '#b45309',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  viewToggle: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 3,
  },
  viewToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.card,
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  viewToggleText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  viewToggleTextActive: { color: colors.text },

  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: '700' },
  notice: { color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: '700', lineHeight: 19 },

  // Start screen
  startCard: { backgroundColor: colors.card, borderRadius: 22, padding: 22, ...cardShadow },
  startIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  startTitle: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  startSub: { color: colors.muted, marginTop: 8, lineHeight: 22, fontSize: 15, fontWeight: '500' },
  panelWarn: { color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: 14, padding: 12, marginTop: 16, fontWeight: '800' },
  bigCheckIn: { marginTop: 18, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  bigCheckInText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  startNote: { color: colors.text, fontWeight: '600', marginTop: 20, fontSize: 14 },
  devLocationCard: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  devLocationTitle: { color: '#92400e', fontWeight: '900', fontSize: 13 },
  devLocationSub: { color: '#92400e', fontSize: 12, lineHeight: 17 },
  devLocationBtn: {
    borderWidth: 1,
    borderColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  devLocationBtnActive: { backgroundColor: '#d97706' },
  devLocationBtnText: { color: '#92400e', fontWeight: '800', fontSize: 12 },
  devLocationBtnTextActive: { color: '#fff' },
  devLocationHint: { color: '#b45309', fontSize: 11, lineHeight: 16 },
  startBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  startBullet: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  previewCard: { backgroundColor: colors.card, borderRadius: 22, padding: 20, marginTop: 14, alignItems: 'center', ...cardShadow },
  previewTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  previewText: { color: colors.muted, fontSize: 13, marginTop: 6, fontWeight: '600' },

  emptyCard: { backgroundColor: colors.card, borderRadius: 22, padding: 24, alignItems: 'center', ...cardShadow },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  emptySub: { color: colors.muted, fontSize: 14, marginTop: 6, marginBottom: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20 },

  checkedInStrip: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 6,
    ...cardShadow,
  },
  checkedInProgress: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  checkedInRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkedInName: { flexShrink: 1, maxWidth: '42%', color: colors.text, fontSize: 15, fontWeight: '700' },
  checkedInAddress: { flex: 1, color: colors.muted, fontSize: 13, fontWeight: '500' },
  checkedInBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successSoft,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  checkedInBadgeText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 18,
    marginBottom: 14,
    overflow: 'hidden',
    ...cardShadow,
  },
  heroAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.primary,
  },
  heroAccentDone: { backgroundColor: colors.success },
  heroAccentFar: { backgroundColor: '#d97706' },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  task: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    ...cardShadow,
  },
  taskNow: {},
  taskDone: {},
  taskLater: {},
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  taskNumReady: {},
  taskNumNow: {},
  taskNumDone: { backgroundColor: colors.successSoft },
  taskNumLater: {},
  taskNumText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  taskNumTextReady: {},
  taskNumTextOn: { color: colors.success },
  taskHeadCopy: { flex: 1, minWidth: 0, paddingTop: 1 },
  taskTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  taskHint: { color: colors.muted, fontSize: 13, fontWeight: '500', marginTop: 2, lineHeight: 18 },
  taskCorner: { maxWidth: 130, color: colors.muted, fontSize: 12, fontWeight: '500', textAlign: 'right', lineHeight: 16 },
  taskBody: { marginTop: 14 },
  lockedNote: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 18 },

  // Stop navigator
  stopPicker: {},
  stopPickerRowLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  stopPickerRowLabelFollow: { marginTop: 14 },
  stopPickerRow: { gap: 10, paddingRight: 12, paddingBottom: 4 },
  stopChip: { minWidth: 72, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: 'transparent' },
  stopChipPractice: { minWidth: 120, maxWidth: 160, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 10, backgroundColor: '#e8eef3', borderWidth: 1.5, borderColor: '#c5d0dc' },
  stopChipPracticeText: { color: colors.text, fontWeight: '900', fontSize: 11, textAlign: 'center', lineHeight: 14 },
  stopChipKnown: { borderColor: '#c5d0dc' },
  stopChipNeedsMapping: { borderColor: '#fed7aa' },
  stopChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stopChipDone: { backgroundColor: colors.successSoft, borderColor: '#86efac' },
  stopChipText: { color: colors.text, fontWeight: '900', fontSize: 14 },
  stopChipTextActive: { color: '#fff' },
  stopChipDoneText: { color: colors.success },
  stopChipMeta: { color: colors.muted, fontSize: 8.5, fontWeight: '900', marginTop: 2, textTransform: 'uppercase' },
  stopChipDist: { color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: 2 },
  stopChipMetaActive: { color: 'rgba(255,255,255,0.9)' },

  // Current stop card
  stopCard: { backgroundColor: colors.card, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 18 },
  stopEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  currentStopTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  currentStopName: { color: colors.text, fontSize: 30, fontWeight: '700', marginTop: 12, lineHeight: 36, letterSpacing: -0.6 },
  targetName: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 4 },
  practiceInput: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#c5d0dc',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: '#f8fffe',
  },
  practicePending: { color: colors.muted, fontSize: 22, fontWeight: '600', marginTop: 12, lineHeight: 28 },
  practiceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  practiceEditLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  practiceActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  practiceCancelBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  practiceCancelText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  practiceSaveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  practiceSaveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  practiceSavedNote: { color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 6 },
  addressBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  addressIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressText: { flex: 1, color: '#374151', fontSize: 15, fontWeight: '500', lineHeight: 21, paddingTop: 4 },
  distanceInline: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 4 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  miniBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  miniBadgeKnown: { backgroundColor: '#eef2ff' },
  miniBadgeNewProvider: { backgroundColor: '#ecfeff' },
  miniBadgeText: { fontSize: 11, fontWeight: '900' },
  miniBadgeNeutral: { backgroundColor: '#f1f5f9', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  miniBadgeTextNeutral: { color: '#475569', fontSize: 11, fontWeight: '800' },

  // GPS / arrival
  arriveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  arriveRowReady: { backgroundColor: colors.primarySoft },
  arriveRowFar: { backgroundColor: colors.warningSoft },
  arriveRowDone: { backgroundColor: colors.successSoft },
  arriveText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  arriveRetry: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  gpsError: { color: colors.danger, fontSize: 12, marginBottom: 10, fontWeight: '700' },

  mutedNote: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  dropCard: { backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  dropCardDone: { backgroundColor: colors.successSoft, borderColor: '#86efac' },
  flyerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dropName: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, lineHeight: 21 },
  viewPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 2 },
  viewPhotoText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.72)', justifyContent: 'center', padding: 20 },
  photoSheet: { backgroundColor: '#fff', borderRadius: 18, padding: 12 },
  photoFull: { width: '100%', height: 420, backgroundColor: '#f1f5f9', borderRadius: 12 },
  photoClose: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  photoCloseText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillPending: { backgroundColor: '#fef3c7' },
  statusPillDone: { backgroundColor: colors.successSoft },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusPillTextPending: { color: '#92400e' },
  statusPillTextDone: { color: colors.success },
  dropMeta: { color: colors.muted, fontSize: 12, marginTop: 3, fontWeight: '600' },
  dropStatus: { color: colors.warning, fontSize: 12, marginTop: 8, fontWeight: '800' },
  dropSaveHint: { color: colors.muted, fontSize: 11, marginTop: 6, lineHeight: 16, fontWeight: '600' },
  dropDoneText: { color: '#16a34a', fontWeight: '900', marginTop: 10 },
  dropProofButton: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dropProofButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  proofPreview: { width: '100%', height: 180, borderRadius: 16, marginTop: 14, backgroundColor: '#e5e7eb' },

  // Completion summary
  completeCard: { marginTop: 16, backgroundColor: colors.successSoft, borderRadius: 18, borderWidth: 1, borderColor: '#86efac', padding: 16 },
  completeTitle: { color: '#16a34a', fontSize: 16, fontWeight: '900' },
  completeLine: { color: '#16a34a', fontSize: 13, marginTop: 6, fontWeight: '700' },
  completeActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  completeSecondary: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#86efac', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  completeSecondaryText: { color: '#16a34a', fontWeight: '900' },
  completePrimary: { flex: 1, backgroundColor: colors.success, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  completePrimaryText: { color: '#fff', fontWeight: '900' },

  disabledButton: { opacity: 0.45 },
  stopMove: { marginTop: 18 },
  stopMoveLabel: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  doneStopBtn: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  doneStopText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  nextRow: { flexDirection: 'row', gap: 10 },
  navButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  navButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  navButtonPrimary: { flex: 1.4, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  navButtonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
