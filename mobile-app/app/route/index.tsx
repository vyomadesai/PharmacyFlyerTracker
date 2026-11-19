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

const PERSON_MET_DEFAULT = 'Front Desk';
const RESPONSE_STATUS_DEFAULT = 'Flyer dropped';

// One flyer/campaign to drop at a location. A single flyer can cover several doctor
// assignments at the same address (one assignment per doctor × campaign), so it carries
// every underlying assignment id and is completed once for all of them.
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

// One physical location to visit. The route is navigated location-by-location.
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
  routes: Array<{
    RouteId?: number;
    RouteName?: string;
    RouteDate?: string;
    Status?: string;
  }>;
  stops: TodayLocation[];
  message?: string;
  schemaMissing?: boolean;
};

type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type DistanceResult = {
  location: LocationSnapshot;
  miles: number;
};

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function locationOrder(loc: TodayLocation, index: number) {
  return Number(loc.StopOrder || index + 1);
}

function addressLine(loc?: TodayLocation | null) {
  if (!loc) return '';
  const line1 = loc.AddressStreet || '';
  const cityState = [loc.AddressCity, loc.AddressState].filter(Boolean).join(', ');
  const line2 = [cityState, loc.AddressZip].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

function oneLineAddress(loc?: TodayLocation | null) {
  return addressLine(loc).replace(/\n/g, ', ');
}

function locationTitle(loc?: TodayLocation | null) {
  if (!loc) return '';
  if (loc.AddressStreet) return loc.AddressStreet;
  return loc.TargetName || 'Location';
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

function formatDistance(miles: number | null) {
  if (miles === null) return 'GPS needed';
  if (miles < 0.1) return 'At location';
  return `${miles.toFixed(1)} miles away`;
}

export default function TodayRouteFlashCardsScreen() {
  const [routeData, setRouteData] = useState<TodayWorkflowRoute | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Proof photos are taken per flyer (keyed by the flyer's representative assignment id).
  const [proofByFlyer, setProofByFlyer] = useState<Record<number, string>>({});
  // Flyers completed in this session (keyed by representative assignment id). Kept
  // locally so completed locations stay visible with a checkmark instead of
  // vanishing on reload, and so the active stop can advance to the next one.
  const [completedFlyers, setCompletedFlyers] = useState<Record<number, boolean>>({});
  // Arrival is recorded once per physical location (keyed by LocationKey).
  const [checkedInByLocation, setCheckedInByLocation] = useState<Record<string, boolean>>({});
  const [lastLocation, setLastLocation] = useState<LocationSnapshot | null>(null);

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [distanceChecking, setDistanceChecking] = useState(false);
  const [distanceError, setDistanceError] = useState('');

  const CHECK_IN_RADIUS_MILES = useCheckInRadiusMiles();

  const locations = useMemo(() => {
    return [...(routeData?.stops || [])].sort((a, b) => locationOrder(a, 0) - locationOrder(b, 0));
  }, [routeData]);

  const activeLocation = locations[activeIndex] || null;
  const checkedIn = activeLocation
    ? Boolean(checkedInByLocation[activeLocation.LocationKey] || activeLocation.checkedIn)
    : false;
  const withinCheckInRadius = distanceMiles !== null && distanceMiles <= CHECK_IN_RADIUS_MILES;

  const isFlyerDone = useCallback(
    (flyer: TodayFlyer) => Boolean(completedFlyers[flyer.AssignmentId]),
    [completedFlyers]
  );
  const isLocationDone = useCallback(
    (loc: TodayLocation | null) =>
      Boolean(loc && loc.flyers.length > 0 && loc.flyers.every((f) => completedFlyers[f.AssignmentId])),
    [completedFlyers]
  );
  const completedLocationCount = useMemo(
    () => locations.filter((loc) => isLocationDone(loc)).length,
    [locations, isLocationDone]
  );
  const activeLocationDone = isLocationDone(activeLocation);

  const canCheckIn = Boolean(
    activeLocation && !checkedIn && withinCheckInRadius && !distanceChecking && !busy
  );

  const routeName = routeData?.routes?.[0]?.RouteName || `Today's Route`;
  const routeDate = routeData?.date || new Date().toISOString().slice(0, 10);

  const progressPercent = locations.length
    ? Math.max(6, (completedLocationCount / locations.length) * 100)
    : 0;

  async function load() {
    setError('');
    const res = await api.get('/client-workflow/routes/today');
    setRouteData(res.data);
    return res.data as TodayWorkflowRoute;
  }

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      load()
        .catch((e) => {
          setError(
            e?.response?.data?.message ||
              'Ask admin to approve assignments and generate a route.'
          );
        })
        .finally(() => mounted && setLoading(false));
      return () => {
        mounted = false;
      };
    }, [])
  );

  useEffect(() => {
    if (activeIndex > Math.max(locations.length - 1, 0)) {
      setActiveIndex(Math.max(locations.length - 1, 0));
    }
  }, [activeIndex, locations.length]);

  useEffect(() => {
    setDistanceMiles(null);
    setDistanceError('');
    if (activeLocation) {
      refreshDistance(false).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation?.LocationKey]);

  async function refresh() {
    setRefreshing(true);
    await load().catch((e) => {
      Alert.alert('Refresh failed', e?.response?.data?.message || 'Try again.');
    });
    setRefreshing(false);
  }

  async function getCurrentLocation(): Promise<LocationSnapshot> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission is required to check in and complete the stop.');
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const snapshot = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
    setLastLocation(snapshot);
    return snapshot;
  }

  async function refreshDistance(showAlert = true): Promise<DistanceResult | null> {
    if (!activeLocation) return null;

    const targetLatitude = numberValue(activeLocation.Latitude);
    const targetLongitude = numberValue(activeLocation.Longitude);

    if (targetLatitude === null || targetLongitude === null) {
      setDistanceMiles(null);
      setDistanceError('Target GPS is missing. Ask admin to add latitude/longitude for this location.');
      if (showAlert) {
        Alert.alert('Target GPS missing', 'This stop does not have latitude/longitude, so check-in cannot be enabled safely.');
      }
      return null;
    }

    setDistanceChecking(true);
    setDistanceError('');

    try {
      const location = await getCurrentLocation();
      const miles = milesBetween(
        { latitude: location.latitude, longitude: location.longitude },
        { latitude: targetLatitude, longitude: targetLongitude }
      );
      setDistanceMiles(miles);
      if (showAlert) {
        Alert.alert(
          'GPS updated',
          miles <= CHECK_IN_RADIUS_MILES
            ? `You are within ${CHECK_IN_RADIUS_MILES} miles. Check-in is enabled.`
            : `You are ${miles.toFixed(1)} miles away. Check-in unlocks within ${CHECK_IN_RADIUS_MILES} miles.`
        );
      }
      return { location, miles };
    } catch (e: any) {
      setDistanceMiles(null);
      setDistanceError(e?.message || 'Could not read GPS location.');
      if (showAlert) {
        Alert.alert('GPS failed', e?.message || 'Could not read GPS location.');
      }
      return null;
    } finally {
      setDistanceChecking(false);
    }
  }

  async function navigateToStop() {
    if (!activeLocation) return;
    const lat = numberValue(activeLocation.Latitude);
    const lng = numberValue(activeLocation.Longitude);
    const query = lat !== null && lng !== null
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

  async function callStop() {
    if (!activeLocation?.Phone) return;
    const phone = String(activeLocation.Phone).replace(/[^0-9+]/g, '');
    if (!phone) return;
    await Linking.openURL(`tel:${phone}`);
  }

  async function checkIn() {
    if (!activeLocation) return;
    const representative = activeLocation.flyers?.[0]?.AssignmentId;
    if (!representative) return;

    setBusy('checkin');
    setError('');
    try {
      const distanceResult = await refreshDistance(false);
      if (!distanceResult) {
        Alert.alert('Check-in unavailable', 'Could not verify your distance from this stop.');
        return;
      }
      if (distanceResult.miles > CHECK_IN_RADIUS_MILES) {
        Alert.alert('Too far to check in', `You are ${distanceResult.miles.toFixed(1)} miles away. Check-in is allowed only within ${CHECK_IN_RADIUS_MILES} miles.`);
        return;
      }
      const location = distanceResult.location;
      await api.post(`/client-workflow/assignments/${representative}/checkin`, {
        userLatitude: location.latitude,
        userLongitude: location.longitude,
        latitude: location.latitude,
        longitude: location.longitude,
        gpsAccuracyMeters: location.accuracy,
      });
      setCheckedInByLocation((prev) => ({ ...prev, [activeLocation.LocationKey]: true }));
      Alert.alert('Checked in', 'Arrival recorded. Drop each flyer below and capture a proof photo for each.');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Check-in failed.');
    } finally {
      setBusy('');
    }
  }

  async function takeProofPhoto(flyer: TodayFlyer) {
    if (!activeLocation) return;
    if (!checkedIn) {
      Alert.alert('Check-in required', 'Check in before taking the proof photo.');
      return;
    }

    setBusy(`proof-${flyer.AssignmentId}`);
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
      }).catch(() => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.72,
      }));
      if (picked.canceled || !picked.assets?.[0]) return;
      const uri = picked.assets[0].uri;
      setProofByFlyer((prev) => ({ ...prev, [flyer.AssignmentId]: uri }));
      // Auto-complete: capturing the proof submits the drop, so the rep no longer
      // needs a separate "Complete" tap. Pass the fresh uri because the state set
      // above won't be visible to completeFlyer within this same tick.
      await completeFlyer(flyer, uri);
    } catch (e: any) {
      setError(e?.message || 'Could not capture proof photo.');
    } finally {
      setBusy('');
    }
  }

  async function completeFlyer(flyer: TodayFlyer, overrideProofUri?: string) {
    if (!activeLocation) return;
    if (!checkedIn) {
      Alert.alert('Check-in required', 'Check in at the location before marking a flyer complete.');
      return;
    }
    const proofUri = overrideProofUri ?? proofByFlyer[flyer.AssignmentId];
    if (!proofUri) {
      Alert.alert('Proof required', 'Take a proof photo of this flyer drop before completing it.');
      return;
    }

    setBusy(`complete-${flyer.AssignmentId}`);
    setError('');
    try {
      const location = lastLocation || await getCurrentLocation();
      const form = new FormData();

      form.append('campaignId', String(flyer.CampaignId));
      form.append('assignmentId', String(flyer.AssignmentId));
      // Every doctor assignment for this campaign at this location finishes together.
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
      form.append('responseStatus', RESPONSE_STATUS_DEFAULT);
      form.append('latitude', String(location.latitude));
      form.append('longitude', String(location.longitude));
      form.append('gpsAccuracyMeters', String(location.accuracy || ''));
      form.append('notes', `Completed from Today's Route. Flyer: ${flyerLabel(flyer)}`);
      form.append('followUpRequired', 'false');

      form.append('photo', {
        uri: proofUri,
        name: `route-proof-${flyer.AssignmentId}-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as any);

      await api.post('/deliveries', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Mark this flyer done locally so the location stays visible (with a
      // checkmark) instead of disappearing on reload. The proof thumbnail is
      // kept so the rep can still see what they submitted.
      const nextDone = { ...completedFlyers, [flyer.AssignmentId]: true };
      setCompletedFlyers(nextDone);

      const loc = activeLocation;
      const locationNowDone = loc.flyers.every((f) => nextDone[f.AssignmentId]);
      if (locationNowDone) {
        const nextIndex = findNextIncompleteIndex(activeIndex, nextDone);
        if (nextIndex !== activeIndex) {
          setActiveIndex(nextIndex);
          Alert.alert('Location complete', 'Moving on to the next location.');
        } else {
          Alert.alert('Route complete', 'Every location on today\u2019s route is done. Great work!');
        }
      } else {
        Alert.alert('Flyer completed', 'Drop the remaining flyer(s) at this location.');
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not complete this flyer.');
    } finally {
      setBusy('');
    }
  }

  // First location at or after `fromIndex + 1` whose flyers aren't all done,
  // wrapping to the start if needed. Returns `fromIndex` when everything is done.
  function findNextIncompleteIndex(fromIndex: number, doneSet: Record<number, boolean>): number {
    const isDone = (loc: TodayLocation) =>
      loc.flyers.length > 0 && loc.flyers.every((f) => doneSet[f.AssignmentId]);
    for (let i = fromIndex + 1; i < locations.length; i++) {
      if (!isDone(locations[i])) return i;
    }
    for (let i = 0; i <= fromIndex; i++) {
      if (!isDone(locations[i])) return i;
    }
    return fromIndex;
  }

  function goNext() {
    if (activeIndex < locations.length - 1) setActiveIndex(activeIndex + 1);
  }

  function goPrevious() {
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  }

  if (loading && !routeData) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading today's route…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <DistributorNav />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{routeName}</Text>
          <Text style={styles.subtitle}>
            {routeDate} · Location {activeLocation ? activeIndex + 1 : 0} of {locations.length}
            {locations.length ? ` · ${completedLocationCount} completed` : ''}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {routeData?.schemaMissing ? <Text style={styles.error}>{routeData.message}</Text> : null}

        {!activeLocation ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🗺️</Text>
            <Text style={styles.emptyTitle}>No locations to visit today</Text>
            <Text style={styles.emptyText}>
              Ask the admin to approve locations, assign them to you, and generate today's route.
            </Text>
            <Pressable style={styles.secondaryButton} onPress={refresh}>
              <Text style={styles.secondaryButtonText}>Refresh route</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.stopPicker}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stopPickerRow}
              >
                {locations.map((loc, index) => {
                  const done = isLocationDone(loc);
                  return (
                    <Pressable
                      key={loc.LocationKey}
                      style={[
                        styles.stopChip,
                        index === activeIndex && styles.stopChipActive,
                        done && styles.stopChipDone,
                      ]}
                      onPress={() => setActiveIndex(index)}
                    >
                      <Text
                        style={[
                          styles.stopChipText,
                          index === activeIndex && styles.stopChipTextActive,
                          done && styles.stopChipDoneText,
                        ]}
                      >
                        {done ? '✓' : `#${locationOrder(loc, index)}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.flashCard}>
              <View style={styles.cardTopRow}>
                <View style={styles.stopNumberBadge}>
                  <Text style={styles.stopNumberText}>Location #{locationOrder(activeLocation, activeIndex)}</Text>
                </View>
                <View style={[styles.statusBadge, (activeLocationDone || checkedIn) ? styles.toneGreen : styles.toneGray]}>
                  <Text style={styles.statusBadgeText}>
                    {activeLocationDone ? 'Completed' : checkedIn ? 'Checked in' : 'Not checked in'}
                  </Text>
                </View>
              </View>

              <Text style={styles.targetName}>{locationTitle(activeLocation)}</Text>
              <Text style={styles.targetMeta}>
                {activeLocation.DoctorCount || 1} doctor(s) here · {activeLocation.FlyerCount || activeLocation.flyers.length} flyer(s) to drop
              </Text>

              <View style={styles.infoBoxLight}>
                <Text style={styles.infoLabel}>Location</Text>
                <Text style={styles.addressText}>{addressLine(activeLocation) || 'Address pending'}</Text>
                {activeLocation.Phone ? (
                  <Text style={styles.infoMeta}>Phone: {activeLocation.Phone}</Text>
                ) : null}
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
                        : distanceMiles !== null
                          ? `Too far · ${formatDistance(distanceMiles)}`
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
                <Pressable
                  style={[styles.secondaryActionButton, (!activeLocation.Phone || !!busy) && styles.disabledButton]}
                  onPress={callStop}
                  disabled={!activeLocation.Phone || !!busy}
                >
                  <Text style={styles.actionIcon}>☎️</Text>
                  <Text style={styles.secondaryButtonText}>Call</Text>
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

              {/* Flyers to drop at this location — one per campaign */}
              <View style={styles.flyersHeader}>
                <Text style={styles.flyersHeaderText}>Flyers to drop here</Text>
                <View style={styles.flyersHeaderBadge}>
                  <Text style={styles.flyersHeaderBadgeText}>{activeLocation.flyers.length}</Text>
                </View>
              </View>

              {activeLocation.flyers.map((flyer, fi) => {
                const proofUri = proofByFlyer[flyer.AssignmentId];
                const completing = busy === `complete-${flyer.AssignmentId}`;
                const takingProof = busy === `proof-${flyer.AssignmentId}`;
                const flyerDone = isFlyerDone(flyer);
                return (
                  <View key={flyer.AssignmentId} style={[styles.dropCard, flyerDone && styles.dropCardDone]}>
                    <View style={styles.dropTopRow}>
                      <View style={[styles.dropNumber, flyerDone && styles.dropNumberDone]}>
                        <Text style={[styles.dropNumberText, flyerDone && styles.dropNumberTextDone]}>
                          {flyerDone ? '✓' : fi + 1}
                        </Text>
                      </View>
                      <View style={styles.dropTextWrap}>
                        <Text style={styles.dropName}>{flyerLabel(flyer)}</Text>
                        <Text style={styles.dropMeta}>
                          {flyer.CampaignName || 'Campaign'}
                          {flyer.FlyerCategory ? ` · ${flyer.FlyerCategory}` : ''}
                          {flyer.doctorCount && flyer.doctorCount > 1 ? ` · covers ${flyer.doctorCount} doctors` : ''}
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
                style={[styles.navButton, activeIndex >= locations.length - 1 && styles.disabledButton]}
                onPress={goNext}
                disabled={activeIndex >= locations.length - 1}
              >
                <Text style={styles.navButtonText}>Next location</Text>
              </Pressable>
            </View>
          </>
        )}
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
  blue: '#3f5b76',
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
  stopPickerRow: { gap: 8, paddingRight: 12 },
  stopChip: { minWidth: 44, height: 44, paddingHorizontal: 12, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0' },
  stopChipActive: { backgroundColor: colors.primary },
  stopChipDone: { backgroundColor: colors.successSoft, borderWidth: 1, borderColor: '#86efac' },
  stopChipText: { color: colors.text, fontWeight: '900' },
  stopChipTextActive: { color: '#fff' },
  stopChipDoneText: { color: colors.success },

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
  dropCompleteButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  dropCompleteButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },

  disabledButton: { opacity: 0.45 },

  nextRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  navButton: { flex: 1, backgroundColor: '#e86a92', borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  navButtonText: { color: '#fff', fontWeight: '900' },
});
