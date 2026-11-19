import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import { api } from '../../src/services/api';
import { colors, shared, statusBadgeStyle } from '../../src/styles/distributor';

type StopDetail = {
  RouteStopId: number;
  RouteId: number;
  StopOrder: number;
  StopLabel?: string | null;
  StopAddress?: string | null;
  AssignedFlyerName?: string | null;
  CampaignName?: string | null;
  TargetType?: string;
  NPI?: string | null;
  Specialty?: string | null;
  Phone?: string | null;
  City?: string | null;
  State?: string | null;
  Zip?: string | null;
  Status?: string;
  CheckInRequired?: boolean;
  ProofUploadRequired?: boolean;
  HasCheckIn?: boolean;
  HasProof?: boolean;
  LocationVerified?: boolean;
  CheckInDistanceMiles?: number | null;
  CheckedInAt?: string | null;
  ProofUploadedAt?: string | null;
  VerificationNote?: string | null;
  CanComplete?: { allowed: boolean; reason?: string | null };
  VisitFrequencyType?: string | null;
  TargetNextDueDate?: string | null;
};

export default function RouteStopDetailScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const routeStopId = Number(stopId);
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [showSkip, setShowSkip] = useState(false);

  async function load() {
    if (!Number.isFinite(routeStopId)) {
      setError('Invalid stop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/routes/stops/${routeStopId}`);
      setStop(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load stop.');
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, [routeStopId]));

  async function handleCheckIn() {
    setBusy('checkin');
    setError('');
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;
      let gpsAccuracyMeters: number | null = null;
      let verificationNote: string | null = null;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        gpsAccuracyMeters = position.coords.accuracy ?? null;
      } else {
        verificationNote = 'GPS permission denied; check-in recorded as location unverified.';
      }

      const res = await api.post(`/routes/stops/${routeStopId}/checkin`, {
        latitude,
        longitude,
        gpsAccuracyMeters,
        verificationNote,
      });
      setStop(res.data);
      Alert.alert('Checked in', verificationNote || 'Location captured successfully.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Check-in failed.');
    } finally {
      setBusy('');
    }
  }

  async function handleUploadProof() {
    setBusy('proof');
    setError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        const library = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!library.granted) {
          Alert.alert('Permission needed', 'Allow camera or photo library access to upload proof.');
          return;
        }
      }

      const picked = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: false,
      }).catch(async () => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      }));

      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      const formData = new FormData();
      formData.append('photo', {
        uri: asset.uri,
        name: asset.fileName || `proof-${Date.now}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      } as any);

      const res = await api.post(`/routes/stops/${routeStopId}/upload-proof`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setStop(res.data.stop);
      Alert.alert('Proof uploaded', 'Photo saved for this stop.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Proof upload failed.');
    } finally {
      setBusy('');
    }
  }

  async function handleComplete() {
    setBusy('complete');
    setError('');
    try {
      const res = await api.post(`/routes/stops/${routeStopId}/complete`);
      setStop(res.data.stop);
      Alert.alert('Stop completed', `Delivered ${res.data.stop?.AssignedFlyerName || 'flyer'}.`, [
        { text: 'Back to route', onPress: () => router.replace('/route') },
      ]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not complete stop.');
    } finally {
      setBusy('');
    }
  }

  async function handleSkip(failed = false) {
    if (!skipReason.trim()) {
      Alert.alert('Reason required', 'Enter why this stop was skipped or failed.');
      return;
    }
    setBusy('skip');
    setError('');
    try {
      await api.post(`/routes/stops/${routeStopId}/skip`, {
        reason: skipReason.trim(),
        status: failed ? 'failed' : 'skipped',
      });
      Alert.alert(failed ? 'Stop failed' : 'Stop skipped', skipReason.trim(), [
        { text: 'Back to route', onPress: () => router.replace('/route') },
      ]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not update stop.');
    } finally {
      setBusy('');
    }
  }

  if (loading && !stop) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const badge = statusBadgeStyle(stop?.Status);
  const canComplete = stop?.CanComplete?.allowed ?? false;
  const isDone = stop?.Status === 'completed' || stop?.Status === 'skipped' || stop?.Status === 'failed';

  return (
    <View style={shared.screen}>
      <DistributorNav />
      <KeyboardAwareScrollView contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Pressable onPress={() => router.back()}>
          <Text style={[shared.meta, { marginBottom: 8 }]}>← Back to route</Text>
        </Pressable>

        {stop ? (
          <>
            <Text style={shared.meta}>Stop #{stop.StopOrder}</Text>
            <Text style={shared.title}>{stop.StopLabel || 'Delivery stop'}</Text>
            <View style={[shared.badge, { backgroundColor: badge.backgroundColor }]}>
              <Text style={[shared.badgeText, { color: badge.color }]}>{stop.Status}</Text>
            </View>

            <View style={shared.card}>
              <Text style={shared.cardTitle}>Exact flyer to drop</Text>
              <Text style={shared.flyerHighlight}>{stop.AssignedFlyerName || '—'}</Text>
              <Text style={shared.meta}>Campaign: {stop.CampaignName || '—'}</Text>
              {stop.VisitFrequencyType ? (
                <Text style={shared.meta}>Visit schedule: {stop.VisitFrequencyType}{stop.TargetNextDueDate ? ` · due ${String(stop.TargetNextDueDate).slice(0, 10)}` : ''}</Text>
              ) : null}
            </View>

            <View style={shared.card}>
              <Text style={shared.cardTitle}>Target location</Text>
              {stop.TargetType === 'doctor' && stop.NPI ? <Text style={shared.meta}>NPI {stop.NPI}</Text> : null}
              {stop.Specialty ? <Text style={shared.meta}>{stop.Specialty}</Text> : null}
              <Text style={shared.meta}>{stop.StopAddress || 'Address pending'}</Text>
              <Text style={shared.meta}>{[stop.City, stop.State, stop.Zip].filter(Boolean).join(', ')}</Text>
              {stop.Phone ? <Text style={shared.meta}>Phone: {stop.Phone}</Text> : null}
            </View>

            <View style={shared.card}>
              <Text style={shared.cardTitle}>Requirements</Text>
              <Text style={shared.meta}>Check-in: {stop.CheckInRequired ? (stop.HasCheckIn ? 'Done' : 'Required') : 'Not required'}</Text>
              <Text style={shared.meta}>Proof photo: {stop.ProofUploadRequired ? (stop.HasProof ? 'Uploaded' : 'Required') : 'Not required'}</Text>
              {stop.HasCheckIn ? (
                <Text style={shared.meta}>
                  Checked in {stop.CheckedInAt ? String(stop.CheckedInAt).slice(0, 16).replace('T', ' ') : ''}
                  {stop.LocationVerified ? ' · location verified' : ' · location unverified'}
                  {stop.CheckInDistanceMiles != null ? ` · ${stop.CheckInDistanceMiles} mi from target` : ''}
                </Text>
              ) : null}
              {stop.VerificationNote ? <Text style={shared.meta}>{stop.VerificationNote}</Text> : null}
              {stop.HasProof && stop.ProofUploadedAt ? (
                <Text style={shared.meta}>Proof uploaded {String(stop.ProofUploadedAt).slice(0, 16).replace('T', ' ')}</Text>
              ) : null}
            </View>

            {error ? <Text style={shared.error}>{error}</Text> : null}
            {!stop.CanComplete?.allowed && stop.CanComplete?.reason && !isDone ? (
              <Text style={[shared.meta, { color: colors.warning }]}>{stop.CanComplete.reason}</Text>
            ) : null}

            {!isDone ? (
              <>
                {stop.CheckInRequired && !stop.HasCheckIn ? (
                  <Pressable style={shared.primaryButton} onPress={handleCheckIn} disabled={busy === 'checkin'}>
                    <Text style={shared.primaryButtonText}>{busy === 'checkin' ? 'Checking in...' : 'Check in with GPS'}</Text>
                  </Pressable>
                ) : null}

                {stop.ProofUploadRequired && !stop.HasProof ? (
                  <Pressable style={shared.primaryButton} onPress={handleUploadProof} disabled={busy === 'proof'}>
                    <Text style={shared.primaryButtonText}>{busy === 'proof' ? 'Uploading...' : 'Upload proof photo'}</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[shared.primaryButton, !canComplete && { opacity: 0.5 }]}
                  onPress={handleComplete}
                  disabled={!canComplete || busy === 'complete'}
                >
                  <Text style={shared.primaryButtonText}>{busy === 'complete' ? 'Completing...' : 'Complete stop'}</Text>
                </Pressable>

                <Pressable style={shared.secondaryButton} onPress={() => setShowSkip((v) => !v)}>
                  <Text style={shared.secondaryButtonText}>{showSkip ? 'Hide skip/fail' : 'Skip or fail stop'}</Text>
                </Pressable>

                {showSkip ? (
                  <View style={shared.card}>
                    <TextInput
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: 'top' }}
                      placeholder="Reason (required)"
                      value={skipReason}
                      onChangeText={setSkipReason}
                      multiline
                    />
                    <Pressable style={shared.secondaryButton} onPress={() => handleSkip(false)} disabled={busy === 'skip'}>
                      <Text style={shared.secondaryButtonText}>Mark skipped</Text>
                    </Pressable>
                    <Pressable style={[shared.secondaryButton, { backgroundColor: '#fee2e2' }]} onPress={() => handleSkip(true)} disabled={busy === 'skip'}>
                      <Text style={[shared.secondaryButtonText, { color: colors.danger }]}>Mark failed</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <Text style={shared.error}>{error || 'Stop not found.'}</Text>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
