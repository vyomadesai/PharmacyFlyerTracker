import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthUser, getUserDisplayName } from '../types/auth';

const LINKS = [
  { href: '/calendar', label: 'Calendar', icon: 'calendar-outline' as const },
  // Hidden for now:
  // { href: '/assignments', label: 'Assignments' },
  { href: '/deliveries', label: 'Deliveries', icon: 'cube-outline' as const },
  // { href: '/route', label: 'Today Route' },
  // { href: '/route-planner-v2', label: 'Routes List' },
  // { href: '/new-entry', label: 'Add New' },
  { href: '/route-three', label: 'Route', icon: 'navigate-outline' as const },
  // { href: '/flyer-drops', label: 'Drops', icon: 'document-text-outline' as const },
  // { href: '/campaigns', label: 'Manual Delivery' },
] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts[0] === '—') return '•';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
}

/** Stable, pleasant avatar colour per person so two reps are told apart at a glance. */
const AVATAR_PALETTE = [
  { bg: '#fde68a', fg: '#92400e' }, // amber
  { bg: '#bfdbfe', fg: '#1e3a8a' }, // blue
  { bg: '#fbcfe8', fg: '#9d174d' }, // pink
  { bg: '#c7d2fe', fg: '#3730a3' }, // indigo
  { bg: '#bbf7d0', fg: '#065f46' }, // green
  { bg: '#fed7aa', fg: '#9a3412' }, // orange
];

function avatarColors(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function dateAndTime(now: Date) {
  const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}  ·  ${time}`;
}

export default function DistributorNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      AsyncStorage.getItem('user')
        .then((raw) => {
          if (!mounted) return;
          if (!raw) {
            setUser(null);
            return;
          }
          try {
            setUser(JSON.parse(raw) as AuthUser);
          } catch {
            setUser(null);
          }
        })
        .catch(() => setUser(null));

      return () => {
        mounted = false;
      };
    }, [])
  );

  async function logout() {
    await AsyncStorage.multiRemove(['token', 'user']);
    router.replace('/login');
  }

  function confirmLogout() {
    Alert.alert('Log out?', `You are signed in as ${displayName}.`, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  const displayName = getUserDisplayName(user);
  const palette = avatarColors(displayName);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      {/* Identity band: who is on shift, in brand colour so the app is recognisable at a glance. */}
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: palette.bg }]}>
          <Text style={[styles.avatarText, { color: palette.fg }]}>{initials(displayName)}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.userMeta} numberOfLines={1}>{dateAndTime(now)}</Text>
        </View>
        <Pressable style={styles.logoutButton} onPress={confirmLogout} hitSlop={8} accessibilityLabel="Log out">
          <Ionicons name="log-out-outline" size={18} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Pressable
              key={link.href}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => {
                if (pathname === link.href || pathname.startsWith(`${link.href}/`)) return;
                router.replace(link.href);
              }}
            >
              <Ionicons name={link.icon} size={15} color={active ? '#e86a92' : '#fff'} />
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{link.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#e86a92',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarText: { fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  identityText: { flex: 1, minWidth: 0 },
  greeting: { color: '#fff', fontSize: 12, fontWeight: '700' },
  userName: { color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 1 },
  userMeta: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 2 },
  logoutButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 14,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 11,
    paddingVertical: 9,
  },
  tabActive: { backgroundColor: '#fff' },
  tabText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: '#e86a92', fontWeight: '900' },
});
