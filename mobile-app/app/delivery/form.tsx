import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import { api } from '../../src/services/api';
import {
  DEFAULT_PERSON_MET,
  DEFAULT_RESPONSE_STATUS,
  FOLLOW_UP_STATUSES,
  PERSON_MET_OPTIONS,
  PersonMetOption,
  RESPONSE_STATUS_OPTIONS,
  ResponseStatusOption
} from '../../src/constants/deliveryForm';
import { AssignmentStop, Campaign, Doctor } from '../../src/types/types';
import { useCheckInRadiusMiles } from '../../src/config';

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              style={[styles.optionChip, selected && styles.optionChipSelected]}
              onPress={() => onChange(option)}
            >
              <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function formatDoctorAddress(doctor: Doctor | null) {
  if (!doctor) return '';
  const line1 = doctor.Doctor_AddressStreet?.trim();
  const city = doctor.Doctor_AddressCity?.trim();
  const state = doctor.Doctor_AddressState?.trim();
  const zip = doctor.Doctor_AddressZip?.trim();
  const line2 = [city, state].filter(Boolean).join(', ');
  const line2WithZip = [line2, zip].filter(Boolean).join(' ');
  return [line1, line2WithZip].filter(Boolean).join('\n');
}

type Coordinates = { latitude: number; longitude: number };

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getAssignmentDropoffCoordinates(assignment: AssignmentStop | null): Coordinates | null {
  if (!assignment) return null;
  const latitude = toNumber(assignment.Latitude);
  const longitude = toNumber(assignment.Longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function getDoctorDropoffCoordinates(doctor: Doctor | null): Coordinates | null {
  if (!doctor) return null;

  const latitude =
    toNumber(doctor.DropoffLatitude) ??
    toNumber(doctor.Latitude) ??
    toNumber(doctor.Doctor_Latitude) ??
    toNumber(doctor.Practice_Latitude);

  const longitude =
    toNumber(doctor.DropoffLongitude) ??
    toNumber(doctor.Longitude) ??
    toNumber(doctor.Doctor_Longitude) ??
    toNumber(doctor.Practice_Longitude);

  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function milesBetween(a: Coordinates, b: Coordinates) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatMiles(value: number | null) {
  if (value === null) return 'Unknown';
  return `${value.toFixed(value < 10 ? 2 : 1)} miles`;
}

export default function DeliveryFormScreen() {
  const CHECK_IN_RADIUS_MILES = useCheckInRadiusMiles();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [assignment, setAssignment] = useState<AssignmentStop | null>(null);
  const [doctorName, setDoctorName] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [personMet, setPersonMet] = useState<PersonMetOption>(DEFAULT_PERSON_MET);
  const [personMetOther, setPersonMetOther] = useState('');
  const [responseStatus, setResponseStatus] = useState<ResponseStatusOption>(DEFAULT_RESPONSE_STATUS);
  const [flyerDelivered, setFlyerDelivered] = useState(true);
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInDeliveryId, setCheckInDeliveryId] = useState<number | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<'not_started' | 'confirmed'>('not_started');
  const [submitting, setSubmitting] = useState(false);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    async function load() {
      const c = await AsyncStorage.getItem('selectedCampaign');
      const d = await AsyncStorage.getItem('selectedDoctor');
      const a = await AsyncStorage.getItem('selectedAssignment');
      const parsedCampaign = c ? JSON.parse(c) : null;
      const parsedDoctor: Doctor | null = d ? JSON.parse(d) : null;
      const parsedAssignment: AssignmentStop | null = a ? JSON.parse(a) : null;
      setCampaign(parsedCampaign);
      setDoctor(parsedDoctor);
      setAssignment(parsedAssignment);

      if (parsedAssignment) {
        setDoctorName(parsedAssignment.TargetName || '');
        setClinicName(parsedAssignment.PracticeName?.trim() || parsedAssignment.TargetType || '');
      } else if (parsedDoctor) {
        const name = `Dr. ${parsedDoctor.Doctor_FirstName || ''} ${parsedDoctor.Doctor_LastName || ''}`.trim();
        setDoctorName(name);
        setClinicName(parsedDoctor.Practice_Name?.trim() || '');
      }
    }
    load();
  }, []);

  const dropoffCoordinates = useMemo(() => getAssignmentDropoffCoordinates(assignment) || getDoctorDropoffCoordinates(doctor), [assignment, doctor]);
  const currentCoordinates = location
    ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
    : null;
  const isWithinCheckInRadius = distanceMiles !== null && distanceMiles <= CHECK_IN_RADIUS_MILES;
  const canCheckIn = Boolean(dropoffCoordinates && currentCoordinates && isWithinCheckInRadius && checkInStatus !== 'confirmed');

  useEffect(() => {
    setFollowUpRequired(FOLLOW_UP_STATUSES.includes(responseStatus));
  }, [responseStatus]);

  useEffect(() => {
    if (!dropoffCoordinates) {
      setDistanceMiles(null);
      return;
    }
    if (!currentCoordinates) return;
    setDistanceMiles(milesBetween(currentCoordinates, dropoffCoordinates));
  }, [currentCoordinates?.latitude, currentCoordinates?.longitude, dropoffCoordinates?.latitude, dropoffCoordinates?.longitude]);

  useEffect(() => {
    let mounted = true;

    async function startLiveLocationWatch() {
      if (!dropoffCoordinates) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const firstLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (!mounted) return;
      setLocation(firstLocation);

      locationWatchRef.current?.remove();
      locationWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 25,
          timeInterval: 10000
        },
        (nextLocation) => {
          setLocation(nextLocation);
        }
      );
    }

    startLiveLocationWatch();

    return () => {
      mounted = false;
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, [dropoffCoordinates?.latitude, dropoffCoordinates?.longitude]);

  async function captureLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location permission denied');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLocation(loc);
  }

  async function checkInAtDropoff() {
    if (!doctor && !assignment) return Alert.alert('Stop missing', 'Select a doctor/pharmacy drop-off first.');
    if (!dropoffCoordinates) {
      return Alert.alert(
        'Drop-off GPS missing',
        'This doctor/pharmacy drop-off does not have usable latitude and longitude. Pinellas Park and St. Petersburg targets can receive derived coordinates from the backend based on city/ZIP.'
      );
    }
    if (!currentCoordinates) return Alert.alert('Current GPS missing', 'Wait for GPS or tap Capture GPS location.');
    if (!isWithinCheckInRadius) {
      return Alert.alert(
        'Too far from destination',
        `You are ${formatMiles(distanceMiles)} away. Check-in is enabled only within ${CHECK_IN_RADIUS_MILES} miles.`
      );
    }

    try {
      setCheckingIn(true);
      const checkInPayload = {
        userLatitude: currentCoordinates.latitude,
        userLongitude: currentCoordinates.longitude,
        locationLatitude: dropoffCoordinates.latitude,
        locationLongitude: dropoffCoordinates.longitude,
        gpsAccuracyMeters: location?.coords.accuracy || null,
        doctorId: doctor?.ID,
        doctorName: doctorName.trim(),
        clinicName: clinicName.trim(),
        priSpec: assignment?.Specialty || doctor?.PriSpec || doctor?.Doctor_Type,
        autoConfirm: true
      };
      const response = assignment?.AssignmentId
        ? await api.post(`/client-workflow/assignments/${assignment.AssignmentId}/checkin`, checkInPayload)
        : await api.post('/workflow/checkin', checkInPayload);

      setCheckInDeliveryId(response.data.deliveryId || assignment?.AssignmentId || null);
      setCheckInStatus('confirmed');
      Alert.alert('Checked in', `You are checked in for this drop-off. ${response.data.deliveryId ? `DeliveryId: ${response.data.deliveryId}` : `AssignmentId: ${assignment?.AssignmentId}`}`);
    } catch (e: any) {
      Alert.alert('Check-in failed', e?.response?.data?.message || 'Please try again');
    } finally {
      setCheckingIn(false);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission denied');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhotoUri(manipulated.uri);
    }
  }

  function resolvedPersonMet() {
    if (personMet === 'Other') {
      return personMetOther.trim() || 'Other';
    }
    return personMet;
  }

  async function submit() {
    if (!campaign) return Alert.alert('Campaign missing', 'Go back and select a campaign first.');
    if (!doctorName.trim()) return Alert.alert('Doctor name is required');
    if (personMet === 'Other' && !personMetOther.trim()) {
      return Alert.alert('Person met is required', 'Enter who you spoke with.');
    }
    if (!photoUri) return Alert.alert('Photo is required', 'Take a flyer or clinic photo before submitting.');
    if (!location) return Alert.alert('GPS location is required', 'Capture your current location before submitting.');
    if (checkInStatus !== 'confirmed' || !checkInDeliveryId) {
      return Alert.alert('Check-in required', 'You must reach the drop-off address and check in before submitting this delivery.');
    }

    try {
      setSubmitting(true);
      const form = new FormData();
      form.append('campaignId', String(campaign.CampaignId));
      if (assignment?.AssignmentId) form.append('assignmentId', String(assignment.AssignmentId));
      if (assignment?.RouteId) form.append('routeId', String(assignment.RouteId));
      if (assignment?.TargetId) form.append('targetId', String(assignment.TargetId));
      form.append('proofRequired', 'true');
      if (doctor?.ID) form.append('doctorId', String(doctor.ID));
      form.append('doctorName', doctorName.trim());
      form.append('clinicName', clinicName.trim());
      form.append('doctorAddressStreet', assignment?.AddressStreet?.trim() || doctor?.Doctor_AddressStreet?.trim() || '');
      form.append('doctorAddressCity', assignment?.AddressCity?.trim() || doctor?.Doctor_AddressCity?.trim() || '');
      form.append('doctorAddressState', assignment?.AddressState?.trim() || doctor?.Doctor_AddressState?.trim() || '');
      form.append('doctorAddressZip', assignment?.AddressZip?.trim() || doctor?.Doctor_AddressZip?.trim() || '');
      form.append('personMet', resolvedPersonMet());
      form.append('flyerDelivered', flyerDelivered ? 'true' : 'false');
      form.append('responseStatus', responseStatus);
      form.append('latitude', String(location.coords.latitude));
      form.append('longitude', String(location.coords.longitude));
      form.append('gpsAccuracyMeters', String(location.coords.accuracy || ''));
      form.append('notes', notes.trim());
      form.append('followUpRequired', followUpRequired ? 'true' : 'false');
      form.append('photo', {
        uri: photoUri,
        name: `delivery-${Date.now()}.jpg`,
        type: 'image/jpeg'
      } as any);

      await api.post('/deliveries', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      Alert.alert('Success', 'Delivery submitted', [
        { text: assignment ? 'Back to Route' : 'Add Next Doctor', onPress: () => router.replace(assignment ? '/route' : '/doctors/search') }
      ]);
    } catch (e: any) {
      Alert.alert('Submit failed', e?.response?.data?.message || 'Please try again');
    } finally {
      setSubmitting(false);
    }
  }

  const doctorAddress = formatDoctorAddress(doctor);

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Flyer Delivery</Text>
      <Text style={styles.subtitle}>Record the visit, outcome, and proof for this doctor/pharmacy stop.</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Visit context</Text>
        <Text style={styles.label}>Campaign / assigned flyer</Text>
        <Text style={styles.readonly}>{campaign?.CampaignName || 'Not selected'}{campaign?.FlyerTitle ? `\nFlyer: ${campaign.FlyerTitle}` : ''}{campaign?.FlyerIdentifier ? `\nCode: ${campaign.FlyerIdentifier}` : ''}</Text>

        {assignment ? (
          <>
            <Text style={styles.label}>Route assignment</Text>
            <Text style={styles.readonly}>Stop #{assignment.StopOrder || assignment.RouteStopOrder || '-'} • {assignment.TargetType}\nStatus: {assignment.AssignmentStatus || 'approved'}\nFrequency: {assignment.VisitFrequencyDays || '-'} days</Text>
          </>
        ) : null}

        {doctor ? (
          <>
            <Text style={styles.label}>Selected drop-off</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{doctorName}</Text>
              {clinicName ? <Text style={styles.summaryText}>{clinicName}</Text> : null}
              {doctorAddress ? <Text style={styles.summaryText}>{doctorAddress}</Text> : null}
              {(doctor.Doctor_Phone || doctor.Doctor_MobileNo) && (
                <Text style={styles.summaryText}>{doctor.Doctor_Phone || doctor.Doctor_MobileNo}</Text>
              )}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Doctor name</Text>
        <TextInput style={styles.input} value={doctorName} onChangeText={setDoctorName} placeholder="Dr. Jane Smith" />

        <Text style={styles.label}>Clinic / practice name</Text>
        <TextInput
          style={styles.input}
          value={clinicName}
          onChangeText={setClinicName}
          placeholder="Practice or clinic name"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Drop-off check-in</Text>
        <Text style={styles.helper}>
          Check-in unlocks only when your live GPS is within {CHECK_IN_RADIUS_MILES} miles of the selected doctor/drop-off address.
        </Text>

        <Text style={styles.label}>Drop-off GPS</Text>
        {dropoffCoordinates ? (
          <Text style={styles.readonly}>
            Lat: {dropoffCoordinates.latitude}{'\n'}
            Long: {dropoffCoordinates.longitude}
          </Text>
        ) : (
          <Text style={styles.warningBox}>
            Missing drop-off latitude/longitude for this stop. Pinellas Park and St. Petersburg targets can receive derived coordinates from the backend based on city/ZIP.
          </Text>
        )}

        <Text style={styles.label}>Your current distance</Text>
        <Text style={[styles.readonly, isWithinCheckInRadius ? styles.okBox : styles.warningSoft]}>
          {formatMiles(distanceMiles)}
        </Text>

        <Text style={styles.helper}>
          {checkInStatus === 'confirmed'
            ? `Checked in successfully. ${assignment ? `AssignmentId: ${checkInDeliveryId}` : `DeliveryId: ${checkInDeliveryId}`}`
            : canCheckIn
              ? 'You are close enough. Check-in is enabled.'
              : 'Check-in is disabled until you reach the drop-off radius.'}
        </Text>

        <View style={{ height: 10 }} />
        <Button title="Refresh GPS" onPress={captureLocation} />
        <View style={{ height: 10 }} />
        <Button
          title={checkingIn ? 'Checking in...' : checkInStatus === 'confirmed' ? 'Checked In' : 'Check In at Drop-Off'}
          onPress={checkInAtDropoff}
          disabled={!canCheckIn || checkingIn}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Who did you meet?</Text>
        <Text style={styles.helper}>Choose the staff role you spoke with at the clinic.</Text>
        <OptionGroup
          label="Person met"
          options={PERSON_MET_OPTIONS}
          value={personMet}
          onChange={setPersonMet}
        />
        {personMet === 'Other' && (
          <>
            <Text style={styles.label}>Other contact name / role</Text>
            <TextInput
              style={styles.input}
              value={personMetOther}
              onChangeText={setPersonMetOther}
              placeholder="e.g. Front desk, Medical assistant"
            />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Visit outcome</Text>
        <Text style={styles.helper}>These values are saved to the delivery record and used in admin reports.</Text>
        <OptionGroup
          label="Response status"
          options={RESPONSE_STATUS_OPTIONS}
          value={responseStatus}
          onChange={setResponseStatus}
        />

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Flyer delivered</Text>
            <Text style={styles.helper}>Turn off if no flyer was physically left.</Text>
          </View>
          <Switch value={flyerDelivered} onValueChange={setFlyerDelivered} />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Follow up required</Text>
            <Text style={styles.helper}>Auto-suggested from response status; override if needed.</Text>
          </View>
          <Switch value={followUpRequired} onValueChange={setFollowUpRequired} />
        </View>

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional details about the visit"
          multiline
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Proof</Text>
        <Button title="Take flyer / clinic photo" onPress={takePhoto} />
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : null}

        <View style={{ height: 12 }} />
        <Button title="Capture GPS location" onPress={captureLocation} />
        {location ? (
          <Text style={styles.readonly}>
            Lat: {location.coords.latitude}{'\n'}
            Long: {location.coords.longitude}{'\n'}
            Accuracy: {location.coords.accuracy}m
          </Text>
        ) : (
          <Text style={styles.helper}>GPS is required before submit.</Text>
        )}
      </View>

      <View style={{ height: 20 }} />
      <Button title={submitting ? 'Submitting...' : assignment ? 'Submit and return to route' : 'Submit and add next doctor'} onPress={submit} disabled={submitting || checkInStatus !== 'confirmed'} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#555', marginTop: 6, marginBottom: 16 },
  section: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#fff'
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  fieldBlock: { marginTop: 4 },
  label: { fontWeight: '700', marginTop: 12, marginBottom: 4 },
  helper: { color: '#666', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, backgroundColor: '#fff' },
  notesInput: { height: 90, textAlignVertical: 'top' },
  readonly: { backgroundColor: '#f3f3f3', padding: 12, borderRadius: 8 },
  warningBox: { backgroundColor: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8 },
  warningSoft: { backgroundColor: '#fff7ed' },
  okBox: { backgroundColor: '#ecfdf5' },
  summaryCard: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbeafe', padding: 12, borderRadius: 8 },
  summaryTitle: { fontSize: 16, fontWeight: '700' },
  summaryText: { color: '#444', marginTop: 4 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  optionChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff'
  },
  optionChipSelected: { backgroundColor: '#3f5b76', borderColor: '#3f5b76' },
  optionChipText: { color: '#334155' },
  optionChipTextSelected: { color: '#fff', fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 },
  switchCopy: { flex: 1 },
  photo: { width: '100%', height: 240, marginTop: 12, borderRadius: 8 }
});
