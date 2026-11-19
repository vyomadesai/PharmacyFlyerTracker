import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import { setNewEntrySession } from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import type { LocationHints, OrgListItem, ResolveAddressResponse, SavedCoords } from '../../src/features/new-entry/types';
import {
  formatDeviceAddress,
  formatDeviceParts,
  getCurrentLocation,
  orgMatchesPhoneFilter,
  parseTypedAddress,
  validateRequiredAddressParts,
} from '../../src/features/new-entry/utils';
import { api, isAuthError, validateStoredSession } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

export default function NewEntryScreen() {
  const [practiceName, setPracticeName] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [addressParts, setAddressParts] = useState<ReturnType<typeof parseTypedAddress>>(null);
  const [coords, setCoords] = useState<SavedCoords | null>(null);
  const [gpsBusy, setGpsBusy] = useState(true);
  const [addressBusy, setAddressBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState('');
  const [gpsWarning, setGpsWarning] = useState('');
  const [addressApplied, setAddressApplied] = useState(false);

  const loadGpsHints = useCallback(async () => {
    setGpsBusy(true);
    setError('');
    try {
      const nextCoords = await getCurrentLocation();
      setCoords(nextCoords);

      try {
        const res = await api.get<LocationHints>('/new-entries/location-hints', {
          params: { lat: nextCoords.latitude, lng: nextCoords.longitude },
        });
        const hints = res.data;
        if (hints.currentLocationAddress) setLocationAddress(hints.currentLocationAddress);
        if (hints.addressParts) setAddressParts(hints.addressParts);
        if (hints.mappedPractice?.practiceName) {
          setPracticeName(hints.mappedPractice.practiceName);
        } else {
          setPracticeName('');
        }
        if (hints.gpsMismatchWarning) setGpsWarning(hints.gpsMismatchWarning);
      } catch (e: any) {
        if (isAuthError(e)) {
          setError('Session expired. Sign in again, then return to Add New.');
          return;
        }
        const deviceRows = await Location.reverseGeocodeAsync(nextCoords);
        const address = formatDeviceAddress(deviceRows);
        if (address) setLocationAddress(address);
        setAddressParts(formatDeviceParts(deviceRows));
      }
    } catch (e: any) {
      setError(e?.message || 'Could not detect your location.');
    } finally {
      setGpsBusy(false);
    }
  }, []);

  useEffect(() => {
    validateStoredSession().then((valid) => {
      if (!valid) {
        setError('Session expired. Sign in again, then return to Add New.');
      }
    });
    loadGpsHints();
  }, [loadGpsHints]);

  async function applyTypedAddress(silent = false): Promise<{
    addressParts: NonNullable<ReturnType<typeof parseTypedAddress>>;
    latitude?: number | null;
    longitude?: number | null;
    practiceName: string;
  } | null> {
    const typed = locationAddress.trim();
    if (!typed) {
      if (!silent) Alert.alert('Address required', 'Type the full address first.');
      return null;
    }

    const preParsed = parseTypedAddress(typed);
    const preCheck = validateRequiredAddressParts(preParsed);
    if (!preCheck.ok) {
      if (!silent) Alert.alert('Address incomplete', preCheck.message || 'Street and ZIP are required.');
      return null;
    }

    setAddressBusy(true);
    setError('');
    try {
      const res = await api.get<ResolveAddressResponse>('/new-entries/resolve-address', {
        params: { address: typed },
      });
      const data = res.data;
      setLocationAddress(data.currentLocationAddress || typed);
      setAddressParts(data.addressParts);
      setAddressApplied(true);
      setGpsWarning('');
      const addressCheck = validateRequiredAddressParts(data.addressParts);
      if (!addressCheck.ok) {
        if (!silent) Alert.alert('Address incomplete', addressCheck.message || 'Street and ZIP are required.');
        return null;
      }
      if (data.mappedPractice?.practiceName) {
        setPracticeName(data.mappedPractice.practiceName);
      } else {
        setPracticeName('');
        if (!silent) {
          Alert.alert(
            'Practice not found',
            'Could not match a mapped practice for this address. You can type the practice name manually.',
          );
        }
      }
      if (data.latitude != null && data.longitude != null) {
        setCoords({ latitude: data.latitude, longitude: data.longitude });
      }
      return {
        addressParts: data.addressParts,
        latitude: data.latitude,
        longitude: data.longitude,
        practiceName: data.mappedPractice?.practiceName?.trim() || '',
      };
    } catch (e: any) {
      const parsed = parseTypedAddress(typed);
      const addressCheck = validateRequiredAddressParts(parsed);
      if (parsed && addressCheck.ok) {
        setAddressParts(parsed);
        setAddressApplied(true);
        setPracticeName('');
        if (!silent) {
          Alert.alert(
            'Address parsed',
            'City/ZIP parsed locally. Practice name was not found — enter it manually if needed.',
          );
        }
        return { addressParts: parsed, practiceName: '' };
      }
      if (parsed && !addressCheck.ok && !silent) {
        Alert.alert('Address incomplete', addressCheck.message || 'Street and ZIP are required.');
        return null;
      }
      const message = e?.response?.data?.message || e?.message || 'Could not parse address.';
      setError(message);
      if (!silent) Alert.alert('Address failed', message);
      return null;
    } finally {
      setAddressBusy(false);
    }
  }

  async function findNearbyOrganizations() {
    const typed = locationAddress.trim();
    if (!typed) {
      Alert.alert('Address required', 'Type the full address first, e.g. 5398 Park St N, St Petersburg, FL, 33709');
      return;
    }

    setLookupBusy(true);
    setError('');

    try {
      const resolved = await applyTypedAddress(true);
      const parts = resolved?.addressParts || addressParts || parseTypedAddress(typed);
      const addressCheck = validateRequiredAddressParts(parts);
      if (!addressCheck.ok || !parts) {
        Alert.alert('Address incomplete', addressCheck.message || 'Street and ZIP are required.');
        return;
      }

      let searchCoords = coords;
      if (resolved?.latitude != null && resolved?.longitude != null) {
        searchCoords = { latitude: resolved.latitude, longitude: resolved.longitude };
      }

      const res = await api.get<{
        organizations: OrgListItem[];
        hint?: string | null;
      }>('/new-entries/nearby-orgs', {
        params: {
          lat: searchCoords?.latitude,
          lng: searchCoords?.longitude,
          radiusMiles: 0.5,
          address: typed,
          street: parts.street || undefined,
          city: parts.city || undefined,
          state: parts.state || 'FL',
          postalCode: parts.postalCode || undefined,
        },
      });

      let organizations = res.data.organizations || [];
      if (phoneFilter.trim()) {
        organizations = organizations.filter((org) => orgMatchesPhoneFilter(org.phone, phoneFilter));
        if (!organizations.length) {
          Alert.alert(
            'No phone match',
            'No nearby organizations matched that phone number. Clear the phone filter or try a different number.',
          );
          return;
        }
      }
      if (!organizations.length) {
        Alert.alert('No organizations nearby', res.data.hint || 'No organizations found within 0.5 miles.');
        return;
      }

      setNewEntrySession({
        practiceName: (resolved?.practiceName ?? practiceName).trim(),
        locationAddress: locationAddress.trim(),
        addressParts: parts,
        phone: phoneFilter.trim(),
        coords: searchCoords,
        organizations,
        lookupHint: res.data.hint || null,
      });

      router.push('/new-entry/drop');
    } catch (e: any) {
      if (isAuthError(e)) return;
      const message = e?.response?.data?.message || e?.message || 'Could not search nearby organizations.';
      setError(message);
      Alert.alert('Search failed', message);
    } finally {
      setLookupBusy(false);
    }
  }

  const formLocked = gpsBusy || addressBusy || lookupBusy;

  return (
    <View style={shared.screen}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={shared.content}>
        <Text style={shared.title}>Add New</Text>
        <Text style={shared.subtitle}>
          Set your location, then find nearby organizations to drop a flyer and record new providers.
        </Text>

        {error ? <Text style={shared.error}>{error}</Text> : null}

        <View style={styles.card}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>1</Text>
            <Text style={styles.stepTitle}>Your location</Text>
            {gpsBusy ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          </View>
          <Text style={styles.helper}>
            Street and ZIP are required, e.g. 5398 Park St N, St Petersburg, FL, 33709
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="701 6th St S, St Petersburg, FL, 33701"
            value={locationAddress}
            onChangeText={(value) => {
              setLocationAddress(value);
              setAddressApplied(false);
              setPracticeName('');
            }}
            editable={!formLocked}
            multiline
          />
          {gpsWarning ? <Text style={styles.warningText}>{gpsWarning}</Text> : null}
          <View style={styles.locationActions}>
            <Pressable style={styles.linkBtn} onPress={loadGpsHints} disabled={formLocked}>
              <Text style={styles.linkBtnText}>Refresh GPS</Text>
            </Pressable>
            <Pressable
              style={[styles.applyBtn, addressBusy && styles.disabledButton]}
              onPress={() => applyTypedAddress(false)}
              disabled={formLocked}
            >
              {addressBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.applyBtnText}>Apply address</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>2</Text>
            <Text style={styles.stepTitle}>Practice name</Text>
          </View>
          <Text style={styles.helper}>Auto-detected from mapped locations near you.</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. PHC Saint Petersburg"
            value={practiceName}
            onChangeText={setPracticeName}
            editable={!formLocked}
          />

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>3</Text>
            <Text style={styles.stepTitle}>Phone (optional)</Text>
          </View>
          <Text style={styles.helper}>Filter nearby organizations by phone number.</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 7275551234"
            value={phoneFilter}
            onChangeText={setPhoneFilter}
            editable={!formLocked}
            keyboardType="phone-pad"
          />

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>4</Text>
            <Text style={styles.stepTitle}>Nearby organizations</Text>
          </View>
          {/* <Text style={styles.helper}>
            Uses your typed address (street, city, state, ZIP) to search NPI organizations within 0.5 miles.
          </Text> */}
          <Pressable
            style={[styles.searchBtn, lookupBusy && styles.disabledButton]}
            onPress={findNearbyOrganizations}
            disabled={formLocked}
          >
            {lookupBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.searchBtnText}>Find nearby organizations</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
