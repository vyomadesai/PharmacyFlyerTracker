import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDistance, locationTitle, oneLineAddress } from './routeHelpers';
import type { V2Location } from './types';

type Props = {
  stops: V2Location[];
  activeLocationKey: string | null;
  userLatitude?: number | null;
  userLongitude?: number | null;
  isStopDone: (loc: V2Location) => boolean;
  onSelectStop: (loc: V2Location) => void;
  onOpenStop: (loc: V2Location) => void;
  onNavigate: () => void;
};

/** Web has no native map. Show the same stops as a list so Safari can open the app. */
export default function RouteStopsMap({
  stops,
  activeLocationKey,
  isStopDone,
  onSelectStop,
  onOpenStop,
  onNavigate,
}: Props) {
  const active = stops.find((loc) => loc.locationKey === activeLocationKey) || stops[0] || null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.note}>Map pins open in the phone app. Pick a stop here.</Text>
      <ScrollView style={styles.list}>
        {stops.map((loc, index) => {
          const current = loc.locationKey === active?.locationKey;
          const done = isStopDone(loc);
          return (
            <Pressable
              key={loc.locationKey}
              onPress={() => onSelectStop(loc)}
              style={[styles.row, current && styles.rowCurrent]}
            >
              <Text style={styles.num}>{done ? '✓' : index + 1}</Text>
              <View style={styles.copy}>
                <Text style={styles.title} numberOfLines={1}>{locationTitle(loc)}</Text>
                <Text style={styles.address} numberOfLines={1}>{oneLineAddress(loc) || 'Address pending'}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {active ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle} numberOfLines={2}>{locationTitle(active)}</Text>
          <Text style={styles.cardAddress} numberOfLines={2}>{oneLineAddress(active) || 'Address pending'}</Text>
          <Text style={styles.cardDist}>
            {formatDistance(active.liveDistanceMiles ?? active.distanceMiles ?? null)} away
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={onNavigate}>
              <Text style={styles.secondaryText}>Navigate</Text>
            </Pressable>
            <Pressable style={styles.primary} onPress={() => onOpenStop(active)}>
              <Text style={styles.primaryText}>Open stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f4f7f7' },
  note: { color: '#64748b', fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingTop: 12 },
  list: { flex: 1, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#fff' },
  rowCurrent: { backgroundColor: '#e8eef3' },
  num: { width: 28, color: '#3f5b76', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#0f172a', fontSize: 15, fontWeight: '800' },
  address: { color: '#64748b', fontSize: 12, fontWeight: '600', marginTop: 2 },
  card: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0', padding: 16 },
  cardTitle: { color: '#0f172a', fontSize: 18, fontWeight: '800' },
  cardAddress: { color: '#334155', fontSize: 14, fontWeight: '600', marginTop: 4 },
  cardDist: { color: '#64748b', fontSize: 13, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondary: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#0f172a', fontWeight: '800' },
  primary: { flex: 1, backgroundColor: '#3f5b76', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '800' },
});
