import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/services/api';

type RouteSummary = {
  RouteId: number;
  RouteName: string;
  RouteDate: string;
  Status: string;
  StartType: string;
  StartAddress?: string | null;
  StopCount: number;
  CompletedStopCount: number;
  MarketName?: string | null;
};


export default function RoutesScreen() {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/routes/today');
      setRoutes(res.data.routes || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load today\'s routes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today's Routes</Text>
      <View style={styles.actions}>
        <Button title="Refresh" onPress={load} />
        <Button title="My Flyers" onPress={() => router.push('/my-flyers')} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={routes}
        keyExtractor={(item) => String(item.RouteId)}
        ListEmptyComponent={<Text>No routes assigned for today.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/routes/${item.RouteId}`)}>
            <Text style={styles.cardTitle}>{item.RouteName}</Text>
            <Text>{item.Status} · {item.CompletedStopCount}/{item.StopCount} stops completed</Text>
            <Text style={styles.meta}>
              Start: {item.StartType}{item.StartAddress ? ` · ${item.StartAddress}` : ''}
            </Text>
            {item.MarketName ? <Text style={styles.meta}>Market: {item.MarketName}</Text> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 },
  card: { padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  meta: { color: '#64748b', marginTop: 4 },
  error: { color: '#b91c1c', marginBottom: 12 },
});
