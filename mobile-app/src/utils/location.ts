import * as Location from 'expo-location';
import { Alert, Linking } from 'react-native';

export type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export class LocationPermissionError extends Error {
  canAskAgain: boolean;

  constructor(message: string, canAskAgain: boolean) {
    super(message);
    this.name = 'LocationPermissionError';
    this.canAskAgain = canAskAgain;
  }
}

export async function requestLocationPermission(): Promise<void> {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.status === 'granted') return;

  const requested = await Location.requestForegroundPermissionsAsync();
  if (requested.status === 'granted') return;

  throw new LocationPermissionError(
    requested.canAskAgain
      ? 'Location permission is required. Tap Check In again and choose Allow when prompted.'
      : 'Location permission is blocked. Open Settings and allow location for this app.',
    requested.canAskAgain,
  );
}

export function alertLocationPermissionError(error: LocationPermissionError) {
  const buttons = error.canAskAgain
    ? [{ text: 'OK' }]
    : [
        { text: 'Cancel', style: 'cancel' as const },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ];
  Alert.alert('Location permission required', error.message, buttons);
}

export async function getCurrentLocationSnapshot(): Promise<LocationSnapshot> {
  await requestLocationPermission();
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
  };
}
