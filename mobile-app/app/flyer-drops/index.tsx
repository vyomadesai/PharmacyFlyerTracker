import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DistributorNav from '../../src/components/DistributorNav';
import { api } from '../../src/services/api';
import { useCheckInRadiusMiles } from '../../src/config';
import { DEV_TEST_LOCATIONS, type DevGpsLocation } from '../../src/config/devLocation';

const PERSON_MET_DEFAULT = 'Front Desk';
const RESPONSE_STATUS_DROPPED = 'Flyer dropped';

const COULDNT_REASONS = [
  { id: 'closed', label: 'Closed' },
  { id: 'no-access', label: 'No access' },
  { id: 'refused', label: 'Refused' },
] as const;

type CouldntReason = (typeof COULDNT_REASONS)[number]['id'];

type TodayFlyer = {
  CampaignId: number;
  CampaignName?: string | null;
  FlyerTitle?: string | null;
  FlyerIdentifier?: string | null;
  FlyerCategory?: string | null;
  FlyerFileUrl?: string | null;
  AssignmentId: number;
  assignmentIds: number[];
  doctorCount?: number;
  checkedIn?: boolean;
};

type TodayLocation = {
  LocationKey: string;
  StopOrder?: number;
  RouteId?: number | null;
  RouteName?: string | null;
  TargetName?: string | null;
  PracticeName?: string | null;
  TargetType?: string | null;
  AddressStreet?: string | null;
  AddressCity?: string | null;
  AddressState?: string | null;
  AddressZip?: string | null;
  Phone?: string | null;
  Latitude?: number | string | null;
  Longitude?: number | string | null;
  DoctorCount?: number;
  FlyerCount?: number;
  checkedIn?: boolean;
  flyers: TodayFlyer[];
};

type TodayWorkflowRoute = {
  date: string;
  routes: Array<{ RouteId?: number; RouteName?: string; RouteDate?: string; Status?: string }>;
  stops: TodayLocation[];
  message?: string;
  schemaMissing?: boolean;
};

type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type FlyerOutcome = 'dropped' | 'failed';
type Screen = 'stop' | 'drop' | 'itinerary' | 'done';

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function stopNumber(loc: TodayLocation, index: number) {
  return Number(loc.StopOrder || index + 1);
}

function streetLine(loc?: TodayLocation | null) {
  if (!loc) return 'Address pending';
  return loc.AddressStreet || loc.TargetName || 'Address pending';
}

function splitStreet(line: string) {
  const match = line.trim().match(/^(\d+[A-Za-z-]?)\s+(.+)$/);
  if (!match) return { number: '', name: line };
  return { number: match[1], name: match[2] };
}

function cityLine(loc?: TodayLocation | null) {
  if (!loc) return '';
  const cityState = [loc.AddressCity, loc.AddressState].filter(Boolean).join(', ');
  return [cityState, loc.AddressZip].filter(Boolean).join(' ');
}

function flyerLabel(flyer: TodayFlyer) {
  return flyer.FlyerTitle || flyer.FlyerIdentifier || flyer.CampaignName || 'Assigned flyer';
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function milesBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
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

function devTestStops(): TodayLocation[] {
  return DEV_TEST_LOCATIONS.map((location, index) => {
    const street = location.label.replace(/\s*\(test\)\s*$/i, '');
    const zip = street.match(/\b(\d{5})\b/)?.[1] || '';
    return {
      LocationKey: `dev:${index}`,
      TargetName: street,
      AddressStreet: street,
      AddressCity: 'St. Petersburg',
      AddressState: 'FL',
      AddressZip: zip,
      Latitude: location.latitude,
      Longitude: location.longitude,
      flyers: [{
        CampaignId: 0,
        CampaignName: 'Test route',
        FlyerTitle: 'Test flyer',
        AssignmentId: -(index + 1),
        assignmentIds: [-(index + 1)],
      }],
    };
  });
}

function isDevFlyer(flyer: TodayFlyer) {
  return flyer.AssignmentId < 0;
}

function formatMilesAway(miles: number | null, ready: boolean) {
  if (!ready) return 'Locating…';
  if (miles === null) return 'Miles away unavailable';
  if (miles < 0.1) return 'At the address';
  return `${miles.toFixed(1)} miles away`;
}

export default function FlyerDropsScreen() {
  const insets = useSafeAreaInsets();
  const CHECK_IN_RADIUS_MILES = useCheckInRadiusMiles();

  const [routeData, setRouteData] = useState<TodayWorkflowRoute | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [screen, setScreen] = useState<Screen>('stop');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notHere, setNotHere] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [ended, setEnded] = useState(false);
  const [started, setStarted] = useState(false);
  const [devTestLocation, setDevTestLocation] = useState<DevGpsLocation | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, FlyerOutcome>>({});
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [distanceReady, setDistanceReady] = useState(false);
  const [lastLocation, setLastLocation] = useState<LocationSnapshot | null>(null);

  const locations = useMemo(() => {
    const assigned = [...(routeData?.stops || [])]
      .filter((stop) => stop.flyers?.length)
      .sort((a, b) => stopNumber(a, 0) - stopNumber(b, 0));
    if (!__DEV__) return assigned;
    return [...assigned, ...devTestStops()];
  }, [routeData]);

  const activeLocation = locations[activeIndex] || null;

  const isLocationDone = useCallback(
    (loc: TodayLocation | null) =>
      Boolean(loc && loc.flyers.length > 0 && loc.flyers.every((flyer) => outcomes[flyer.AssignmentId])),
    [outcomes]
  );

  const completedStopCount = useMemo(
    () => locations.filter((loc) => isLocationDone(loc)).length,
    [locations, isLocationDone]
  );
  const droppedCount = useMemo(
    () => Object.values(outcomes).filter((outcome) => outcome === 'dropped').length,
    [outcomes]
  );
  const couldntCount = useMemo(
    () => Object.values(outcomes).filter((outcome) => outcome === 'failed').length,
    [outcomes]
  );
  const allDone = locations.length > 0 && completedStopCount === locations.length;
  const progressPercent = locations.length ? (completedStopCount / locations.length) * 100 : 0;
  const openFlyer = activeLocation?.flyers.find((flyer) => !outcomes[flyer.AssignmentId]) || null;

  const load = useCallback(async () => {
    setError('');
    const res = await api.get<TodayWorkflowRoute>('/client-workflow/routes/today');
    setRouteData(res.data);
    return res.data;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      load()
        .catch((e) => {
          if (!mounted) return;
          setError(e?.response?.data?.message || 'Could not load today\'s flyer drops.');
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
      return () => {
        mounted = false;
      };
    }, [load])
  );

  useEffect(() => {
    if (activeIndex > Math.max(locations.length - 1, 0)) {
      setActiveIndex(Math.max(locations.length - 1, 0));
    }
  }, [activeIndex, locations.length]);

  useEffect(() => {
    let cancelled = false;
    setDistanceMiles(null);
    setDistanceReady(false);
    if (!activeLocation || screen !== 'stop') return undefined;

    (async () => {
      try {
        const here = await readGps();
        const target = targetCoordinates(activeLocation);
        if (cancelled) return;
        if (!here || !target) {
          setDistanceReady(true);
          return;
        }
        setLastLocation(here);
        setDistanceMiles(milesBetween(here, target));
        setDistanceReady(true);
      } catch {
        if (!cancelled) setDistanceReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeLocation?.LocationKey, screen, devTestLocation?.label]);

  function targetCoordinates(loc: TodayLocation) {
    const latitude = numberValue(loc.Latitude);
    const longitude = numberValue(loc.Longitude);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude };
  }

  async function readGps(): Promise<LocationSnapshot> {
    if (__DEV__ && devTestLocation) {
      return {
        latitude: devTestLocation.latitude,
        longitude: devTestLocation.longitude,
        accuracy: 5,
      };
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('gps');
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not refresh flyer drops.');
    } finally {
      setRefreshing(false);
    }
  }

  function findNextOpenIndex(fromIndex: number, nextOutcomes: Record<number, FlyerOutcome>) {
    const open = (loc: TodayLocation) => loc.flyers.some((flyer) => !nextOutcomes[flyer.AssignmentId]);
    for (let i = fromIndex + 1; i < locations.length; i++) {
      if (open(locations[i])) return i;
    }
    for (let i = 0; i < fromIndex; i++) {
      if (open(locations[i])) return i;
    }
    return null;
  }

  function goToStop(index: number) {
    setActiveIndex(index);
    setNotHere(false);
    setShowReasons(false);
    setError('');
    setScreen('stop');
  }

  async function imHere() {
    if (!activeLocation || busy) return;
    const flyer = activeLocation.flyers.find((item) => !outcomes[item.AssignmentId]) || activeLocation.flyers[0];
    if (!flyer) return;

    setBusy('here');
    setNotHere(false);
    setError('');
    try {
      let here: LocationSnapshot;
      try {
        here = await readGps();
      } catch {
        setNotHere(true);
        return;
      }
      setLastLocation(here);
      const target = targetCoordinates(activeLocation);
      if (!target) {
        setNotHere(true);
        return;
      }
      const miles = milesBetween(here, target);
      setDistanceMiles(miles);
      if (miles > CHECK_IN_RADIUS_MILES) {
        setNotHere(true);
        return;
      }

      if (!isDevFlyer(flyer)) {
        try {
          await api.post(`/client-workflow/assignments/${flyer.AssignmentId}/checkin`, {
            userLatitude: here.latitude,
            userLongitude: here.longitude,
            latitude: here.latitude,
            longitude: here.longitude,
            gpsAccuracyMeters: here.accuracy,
          });
        } catch (e: any) {
          if (e?.response?.status === 403) {
            setNotHere(true);
            return;
          }
          setError(e?.response?.data?.message || 'Could not record arrival.');
          return;
        }
      }
      setShowReasons(false);
      setScreen('drop');
    } finally {
      setBusy('');
    }
  }

  async function takeProofPhoto(flyer: TodayFlyer) {
    if (!activeLocation || busy) return;
    setBusy(`proof-${flyer.AssignmentId}`);
    setError('');
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libraryPermission.granted) {
          Alert.alert('Permission needed', 'Allow camera access to photograph this flyer drop.');
          return;
        }
      }
      const picked = await ImagePicker.launchCameraAsync({
        quality: 0.72,
        allowsEditing: false,
      }).catch(() => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.72,
      }));
      if (picked.canceled || !picked.assets?.[0]) return;
      await completeFlyer(flyer, picked.assets[0].uri);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not capture proof photo.');
    } finally {
      setBusy('');
    }
  }

  async function completeFlyer(flyer: TodayFlyer, proofUri: string) {
    if (!activeLocation) return;
    if (isDevFlyer(flyer)) {
      const nextOutcomes = { ...outcomes, [flyer.AssignmentId]: 'dropped' as const };
      setOutcomes(nextOutcomes);
      if (activeLocation.flyers.every((item) => nextOutcomes[item.AssignmentId])) moveOn(nextOutcomes);
      return;
    }
    const location = lastLocation || await readGps();
    setLastLocation(location);
    const form = new FormData();
    form.append('campaignId', String(flyer.CampaignId));
    form.append('assignmentId', String(flyer.AssignmentId));
    form.append('assignmentIds', (flyer.assignmentIds || [flyer.AssignmentId]).join(','));
    if (activeLocation.RouteId) form.append('routeId', String(activeLocation.RouteId));
    form.append('proofRequired', 'true');
    form.append('doctorName', activeLocation.TargetName || 'Route stop');
    form.append('clinicName', activeLocation.PracticeName || activeLocation.TargetType || '');
    form.append('doctorAddressStreet', activeLocation.AddressStreet || '');
    form.append('doctorAddressCity', activeLocation.AddressCity || '');
    form.append('doctorAddressState', activeLocation.AddressState || '');
    form.append('doctorAddressZip', activeLocation.AddressZip || '');
    form.append('personMet', PERSON_MET_DEFAULT);
    form.append('flyerDelivered', 'true');
    form.append('responseStatus', RESPONSE_STATUS_DROPPED);
    form.append('latitude', String(location.latitude));
    form.append('longitude', String(location.longitude));
    form.append('gpsAccuracyMeters', String(location.accuracy || ''));
    form.append('notes', `Completed from Drops. Flyer: ${flyerLabel(flyer)}`);
    form.append('followUpRequired', 'false');
    form.append('photo', {
      uri: proofUri,
      name: `drops-proof-${flyer.AssignmentId}-${Date.now()}.jpg`,
      type: 'image/jpeg',
    } as any);

    await api.post('/deliveries', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const nextOutcomes = { ...outcomes, [flyer.AssignmentId]: 'dropped' as const };
    setOutcomes(nextOutcomes);
    const stopFinished = activeLocation.flyers.every((item) => nextOutcomes[item.AssignmentId]);
    if (stopFinished) moveOn(nextOutcomes);
  }

  async function couldntDrop(reason: CouldntReason) {
    if (!activeLocation || busy) return;
    const remaining = activeLocation.flyers.filter((flyer) => !outcomes[flyer.AssignmentId]);
    if (!remaining.length) return;
    const reasonLabel = COULDNT_REASONS.find((item) => item.id === reason)?.label || 'Could not drop';

    setBusy('couldnt');
    setError('');
    try {
      const location = lastLocation || await readGps();
      setLastLocation(location);
      const nextOutcomes = { ...outcomes };
      for (const flyer of remaining) {
        const form = new FormData();
        form.append('campaignId', String(flyer.CampaignId));
        form.append('assignmentId', String(flyer.AssignmentId));
        form.append('assignmentIds', (flyer.assignmentIds || [flyer.AssignmentId]).join(','));
        if (activeLocation.RouteId) form.append('routeId', String(activeLocation.RouteId));
        form.append('proofRequired', 'false');
        form.append('doctorName', activeLocation.TargetName || 'Route stop');
        form.append('clinicName', activeLocation.PracticeName || activeLocation.TargetType || '');
        form.append('doctorAddressStreet', activeLocation.AddressStreet || '');
        form.append('doctorAddressCity', activeLocation.AddressCity || '');
        form.append('doctorAddressState', activeLocation.AddressState || '');
        form.append('doctorAddressZip', activeLocation.AddressZip || '');
        form.append('personMet', 'No one available');
        form.append('flyerDelivered', 'false');
        form.append('responseStatus', reasonLabel);
        form.append('latitude', String(location.latitude));
        form.append('longitude', String(location.longitude));
        form.append('gpsAccuracyMeters', String(location.accuracy || ''));
        form.append('notes', `Couldn't drop (${reasonLabel}) from Drops.`);
        form.append('followUpRequired', 'false');
        if (!isDevFlyer(flyer)) {
          await api.post('/deliveries', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        }
        nextOutcomes[flyer.AssignmentId] = 'failed';
        setOutcomes({ ...nextOutcomes });
      }
      setShowReasons(false);
      moveOn(nextOutcomes);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not save this stop.');
    } finally {
      setBusy('');
    }
  }

  function moveOn(nextOutcomes: Record<number, FlyerOutcome>) {
    const nextIndex = findNextOpenIndex(activeIndex, nextOutcomes);
    setShowReasons(false);
    setNotHere(false);
    if (nextIndex === null) {
      setScreen('done');
      return;
    }
    setActiveIndex(nextIndex);
    setScreen('stop');
  }

  function selectDevGps(location: DevGpsLocation) {
    const next = devTestLocation?.label === location.label ? null : location;
    setDevTestLocation(next);
    setNotHere(false);
    setLastLocation(next ? { latitude: next.latitude, longitude: next.longitude, accuracy: 5 } : null);
  }

  function renderDevGps() {
    if (!__DEV__) return null;
    return (
      <View style={styles.devCard}>
        <Text style={styles.devTitle}>Developer test GPS</Text>
        <Text style={styles.devSub}>
          Pretend you are at one of these addresses. I&apos;m here uses that pin instead of the phone GPS.
        </Text>
        {DEV_TEST_LOCATIONS.map((location) => {
          const active = devTestLocation?.label === location.label;
          return (
            <Pressable
              key={location.label}
              style={[styles.devBtn, active && styles.devBtnActive]}
              onPress={() => selectDevGps(location)}
            >
              <Text style={[styles.devBtnText, active && styles.devBtnTextActive]}>
                {active ? 'Using ' : 'Use '}{location.label}
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.devHint}>
          {devTestLocation
            ? `I'm here uses ${devTestLocation.label} (${devTestLocation.latitude.toFixed(4)}, ${devTestLocation.longitude.toFixed(4)}).`
            : 'Using your real GPS. Pick a test address to arrive at that stop.'}
        </Text>
      </View>
    );
  }

  if (started && loading && !routeData) {
    return (
      <View style={styles.screen}>
        <DistributorNav />
        <View style={styles.center}>
          <ActivityIndicator color={orange} size="large" />
        </View>
      </View>
    );
  }

  const showDone = screen === 'done';

  return (
    <View style={styles.screen}>
      <DistributorNav />

      {!started ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.startWrap}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.startKicker}>Today&apos;s itinerary</Text>
            <Text style={styles.startTitle}>Start Drops today</Text>
            <Text style={styles.startSub}>
              One stop at a time. Pick a test address if you are not at the door, then tap I&apos;m here.
            </Text>
            {renderDevGps()}
          </ScrollView>
          <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable
              style={[styles.primaryButton, loading && styles.disabled]}
              onPress={() => {
                setStarted(true);
                setScreen('stop');
                setActiveIndex(0);
              }}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#0F1111" /> : <Text style={styles.primaryButtonText}>Start Drops today</Text>}
            </Pressable>
          </View>
        </View>
      ) : !locations.length ? (
        <ScrollView
          contentContainerStyle={styles.emptyWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.emptyTitle}>There are no flyer drops today.</Text>
        </ScrollView>
      ) : showDone ? (
        <View style={styles.flex}>
          <View style={styles.doneBody}>
            <View style={styles.doneMark}><Text style={styles.doneMarkText}>✓</Text></View>
            <Text style={styles.doneTitle}>{ended ? 'Ended' : 'Itinerary complete'}</Text>
            <Text style={styles.doneCount}>{droppedCount} dropped</Text>
            <Text style={styles.doneCountMuted}>{couldntCount} couldn&apos;t drop</Text>
          </View>
          <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {!ended ? (
              <Pressable style={styles.primaryButton} onPress={() => setEnded(true)}>
                <Text style={styles.primaryButtonText}>End</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setScreen('itinerary')} hitSlop={8}>
              <Text style={styles.problemLink}>Itinerary</Text>
            </Pressable>
          </View>
        </View>
      ) : screen === 'itinerary' ? (
        <View style={styles.flex}>
          <View style={styles.flexHead}>
            <Text style={styles.flexHeadTitle}>Itinerary</Text>
            <Pressable onPress={() => setScreen(allDone ? 'done' : 'stop')} hitSlop={8}>
              <Text style={styles.flexHeadLink}>Current stop</Text>
            </Pressable>
          </View>
          <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
            {locations.map((loc, index) => {
              const done = isLocationDone(loc);
              const failed = done && loc.flyers.some((flyer) => outcomes[flyer.AssignmentId] === 'failed');
              const current = index === activeIndex;
              const flyerCount = loc.flyers.length;
              return (
                <Pressable
                  key={loc.LocationKey}
                  onPress={() => goToStop(index)}
                  style={[styles.stopRow, current && styles.stopRowCurrent]}
                >
                  <View style={[styles.stopBadge, current && styles.stopBadgeCurrent, done && styles.stopBadgeDone]}>
                    <Text style={[styles.stopBadgeText, current && styles.stopBadgeTextCurrent]}>
                      {done ? '✓' : index + 1}
                    </Text>
                  </View>
                  <View style={styles.stopRowCopy}>
                    <Text style={[styles.stopRowStreet, done && styles.doneText]} numberOfLines={1}>
                      {streetLine(loc)}
                    </Text>
                    <Text style={styles.stopRowCity} numberOfLines={1}>
                      {cityLine(loc) || 'City pending'}
                      {` · ${flyerCount} flyer${flyerCount === 1 ? '' : 's'}`}
                      {failed ? ' · Couldn\'t drop' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : screen === 'drop' && activeLocation ? (
        <View style={styles.flex}>
          <View style={styles.flexHead}>
            <Text style={styles.flexHeadTitle}>Deliver</Text>
            <Text style={styles.flexHeadMeta}>Stop {activeIndex + 1} of {locations.length}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.stopScroll}>
            <Text style={styles.deliverStreet}>{streetLine(activeLocation)}</Text>
            {cityLine(activeLocation) ? <Text style={styles.city}>{cityLine(activeLocation)}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {activeLocation.flyers.map((flyer) => {
              const outcome = outcomes[flyer.AssignmentId];
              const current = openFlyer?.AssignmentId === flyer.AssignmentId;
              return (
                <View key={flyer.AssignmentId} style={[styles.packageCard, current && styles.packageCardCurrent]}>
                  <Text style={styles.packageEyebrow}>{outcome === 'dropped' ? 'Dropped' : outcome === 'failed' ? 'Couldn\'t drop' : 'Flyer'}</Text>
                  <Text style={[styles.packageTitle, outcome ? styles.doneText : null]}>{flyerLabel(flyer)}</Text>
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {showReasons ? (
              <View style={styles.reasonList}>
                {COULDNT_REASONS.map((reason) => (
                  <Pressable
                    key={reason.id}
                    style={[styles.reasonRow, !!busy && styles.disabled]}
                    onPress={() => couldntDrop(reason.id)}
                    disabled={!!busy}
                  >
                    <Text style={styles.reasonText}>{reason.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {openFlyer ? (
              <Pressable
                style={[styles.primaryButton, !!busy && styles.disabled]}
                onPress={() => takeProofPhoto(openFlyer)}
                disabled={!!busy}
              >
                {busy.startsWith('proof-') || busy === 'couldnt' ? (
                  <ActivityIndicator color="#0F1111" />
                ) : (
                  <Text style={styles.primaryButtonText}>Take proof photo</Text>
                )}
              </Pressable>
            ) : null}
            <Pressable onPress={() => setShowReasons((open) => !open)} disabled={!!busy} hitSlop={8}>
              <Text style={styles.problemLink}>{showReasons ? 'Cancel' : 'Couldn\'t drop'}</Text>
            </Pressable>
          </View>
        </View>
      ) : activeLocation ? (
        <View style={styles.flex}>
          <View style={styles.flexHead}>
            <Text style={styles.flexHeadTitle}>Stop {activeIndex + 1} of {locations.length}</Text>
            <Pressable onPress={() => setScreen('itinerary')} hitSlop={8}>
              <Text style={styles.flexHeadLink}>Itinerary</Text>
            </Pressable>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(progressPercent, completedStopCount ? 4 : 0)}%` }]} />
          </View>
          <ScrollView
            contentContainerStyle={styles.stopScroll}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          >
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {(() => {
              const parts = splitStreet(streetLine(activeLocation));
              return parts.number ? (
                <>
                  <Text style={styles.houseNumber}>{parts.number}</Text>
                  <Text style={styles.streetName}>{parts.name}</Text>
                </>
              ) : (
                <Text style={styles.streetName}>{parts.name}</Text>
              );
            })()}
            {cityLine(activeLocation) ? <Text style={styles.city}>{cityLine(activeLocation)}</Text> : null}
            <Text style={styles.miles}>{formatMilesAway(distanceMiles, distanceReady)}</Text>
            <View style={styles.packageCard}>
              <Text style={styles.packageEyebrow}>
                {activeLocation.flyers.length} flyer{activeLocation.flyers.length === 1 ? '' : 's'}
              </Text>
              {activeLocation.flyers.map((flyer) => (
                <Text key={flyer.AssignmentId} style={styles.packageTitle}>{flyerLabel(flyer)}</Text>
              ))}
            </View>
            {isLocationDone(activeLocation) ? (
              <Text style={styles.doneInline}>
                {activeLocation.flyers.some((flyer) => outcomes[flyer.AssignmentId] === 'failed')
                  ? 'Couldn\'t drop'
                  : 'Dropped'}
              </Text>
            ) : null}
            {renderDevGps()}
          </ScrollView>
          <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {notHere ? <Text style={styles.notHere}>You are not located here.</Text> : null}
            {!isLocationDone(activeLocation) ? (
              <Pressable
                style={[styles.primaryButton, !!busy && styles.disabled]}
                onPress={imHere}
                disabled={!!busy}
              >
                {busy === 'here' ? <ActivityIndicator color="#0F1111" /> : <Text style={styles.primaryButtonText}>I&apos;m here</Text>}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const ink = '#0F1111';
const muted = '#565959';
const orange = '#FF9900';
const line = '#D5D9D9';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyTitle: { color: ink, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  flexHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
  },
  flexHeadTitle: { color: ink, fontSize: 20, fontWeight: '700' },
  flexHeadMeta: { color: muted, fontSize: 14, fontWeight: '600' },
  flexHeadLink: { color: '#C45500', fontSize: 15, fontWeight: '700' },
  progressTrack: { height: 4, backgroundColor: '#EEEEEE' },
  progressFill: { height: 4, backgroundColor: orange },
  stopScroll: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 24 },
  houseNumber: { color: ink, fontSize: 64, fontWeight: '700', letterSpacing: -1, lineHeight: 68 },
  streetName: { color: ink, fontSize: 28, fontWeight: '400', lineHeight: 34, marginTop: 2 },
  deliverStreet: { color: ink, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  city: { color: muted, fontSize: 16, fontWeight: '400', marginTop: 8 },
  miles: { color: ink, fontSize: 15, fontWeight: '700', marginTop: 16 },
  packageCard: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: line,
    paddingTop: 14,
    paddingLeft: 12,
    borderLeftWidth: 4,
    borderLeftColor: line,
  },
  packageCardCurrent: { borderLeftColor: orange },
  packageEyebrow: { color: muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  packageTitle: { color: ink, fontSize: 20, fontWeight: '700', marginTop: 4, lineHeight: 26 },
  dock: {
    borderTopWidth: 1,
    borderTopColor: line,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
  },
  primaryButton: {
    backgroundColor: orange,
    borderRadius: 8,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: ink, fontSize: 18, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  problemLink: { color: '#C45500', fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 14, marginBottom: 4 },
  notHere: { color: '#B12704', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  error: { color: '#B12704', backgroundColor: '#FDE8E6', borderRadius: 8, padding: 12, marginTop: 16, fontWeight: '700' },
  doneInline: { color: '#16a34a', fontSize: 16, fontWeight: '700', marginTop: 16 },
  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  doneMark: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  doneMarkText: { color: '#fff', fontSize: 36, fontWeight: '700' },
  doneTitle: { color: ink, fontSize: 24, fontWeight: '700', marginTop: 16 },
  doneCount: { color: ink, fontSize: 20, fontWeight: '700', marginTop: 18 },
  doneCountMuted: { color: muted, fontSize: 18, fontWeight: '600', marginTop: 6 },
  reasonList: { marginBottom: 10, borderTopWidth: 1, borderTopColor: line },
  reasonRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: line },
  reasonText: { color: ink, fontSize: 16, fontWeight: '700' },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: line,
    backgroundColor: '#fff',
  },
  stopRowCurrent: { backgroundColor: '#FFF8E7' },
  stopBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#232F3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeCurrent: { backgroundColor: orange },
  stopBadgeDone: { backgroundColor: '#16a34a' },
  stopBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  stopBadgeTextCurrent: { color: ink },
  stopRowCopy: { flex: 1, minWidth: 0 },
  stopRowStreet: { color: ink, fontSize: 16, fontWeight: '700' },
  stopRowCity: { color: muted, fontSize: 13, fontWeight: '400', marginTop: 2 },
  doneText: { color: muted },
  startWrap: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 24 },
  startKicker: { color: muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  startTitle: { color: ink, fontSize: 32, fontWeight: '700', marginTop: 6 },
  startSub: { color: muted, fontSize: 16, fontWeight: '400', lineHeight: 22, marginTop: 8 },
  devCard: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  devTitle: { color: '#92400e', fontWeight: '900', fontSize: 13 },
  devSub: { color: '#92400e', fontSize: 12, lineHeight: 17 },
  devBtn: {
    borderWidth: 1,
    borderColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  devBtnActive: { backgroundColor: '#d97706' },
  devBtnText: { color: '#92400e', fontWeight: '800', fontSize: 12 },
  devBtnTextActive: { color: '#fff' },
  devHint: { color: '#b45309', fontSize: 11, lineHeight: 16 },
});
