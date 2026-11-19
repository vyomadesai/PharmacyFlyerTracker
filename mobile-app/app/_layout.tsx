import { useEffect } from 'react';
import { Alert, AppState, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DistributorNav from '../src/components/DistributorNav';
import { setUnauthorizedHandler } from '../src/services/api';
import { flushActivity, touchActivity } from '../src/utils/activity';

const FIXED_TABS = ['calendar', 'deliveries', 'route-three'];

function isFixedTab(name: string) {
  return FIXED_TABS.some((tab) => name === tab || name.startsWith(`${tab}/`));
}

function ActivityTracker() {
  useEffect(() => {
    touchActivity();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') touchActivity();
      else flushActivity();
    });
    return () => sub.remove();
  }, []);

  return null;
}

function AuthSessionListener() {
  const router = useRouter();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      Alert.alert('Session expired', 'Please sign in again to continue.');
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  return null;
}

function AppShell() {
  const pathname = usePathname();
  const showNav = isFixedTab(pathname.replace(/^\//, ''));

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {showNav ? <DistributorNav /> : null}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={({ route }) => ({
            headerShown: false,
            animation: isFixedTab(route.name) ? 'none' : 'default',
          })}
        />
      </View>
    </View>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AuthSessionListener />
      <ActivityTracker />
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          touchActivity();
          return false;
        }}
      >
        <AppShell />
      </View>
    </SafeAreaProvider>
  );
}
