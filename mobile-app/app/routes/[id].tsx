import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/services/api';

type RouteStop = {
  RouteStopId: number;
  StopOrder: number;
  StopLabel?: string | null;
  StopAddress?: string | null;
  AssignedFlyerName?: string | null;
  TargetType: string;
  Status: string;
  CheckInRequired?: boolean;
  ProofUploadRequired?: boolean;
  VisitFrequencyType?: string | null;
  VisitFrequencyDays?: number | null;
  TargetLastVisitedAt?: string | null;
  TargetNextDueDate?: string | null;
  VisitDueStatus?: string | null;
};

type RouteDetail = {
  RouteId: number;
  RouteName: string;
  RouteDate: string;
  Status: string;
  StartType: string;
  StartAddress?: string | null;
  StartLatitude?: number | null;
  StartLongitude?: number | null;
  StopCount: number;
  CompletedStopCount: number;
  stops?: RouteStop[];
  mapData?: {
    start: { label: string; address?: string | null; latitude: number | null; longitude: number | null };
    stops: Array<{ stopOrder: number; label?: string | null; assignedFlyerName?: string | null; latitude: number | null; longitude: number | null }>;
  };
};

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = Number(id);
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!Number.isFinite(routeId)) {
      setError('Invalid route.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/routes/${routeId}`);
      setRoute(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load route.');
    } finally {
      setLoading(false);
    }
  }

  async function completeStop(stopId: number) {
    setError('');
    try {
      const res = await api.post(`/routes/${routeId}/stops/${stopId}/complete`, { status: 'completed' });
      setRoute(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not complete stop.');
    }
  }

  useEffect(() => { load(); }, [routeId]);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!route) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error || 'Route not found.'}</Text>
        <Button title="Back" onPress={() => router.back()} />
      </View>
    );
  }

  const stops = [...(route.stops || [])].sort((a, b) => a.StopOrder - b.StopOrder);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{route.RouteName}</Text>
      <Text>{route.Status} · {route.CompletedStopCount}/{route.StopCount} completed</Text>
      <Text style={styles.meta}>
        Start ({route.StartType}): {route.StartAddress || 'Address pending'}
      </Text>
      {route.mapData?.start.latitude != null ? (
        <Text style={styles.meta}>
          Coords: {route.mapData.start.latitude}, {route.mapData.start.longitude}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button title="Refresh" onPress={load} />
        <Button title="All routes" onPress={() => router.push('/routes')} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Stops</Text>
      {stops.map((stop) => (
        <View key={stop.RouteStopId} style={styles.card}>
          <Text style={styles.stopOrder}>Stop #{stop.StopOrder}</Text>
          <Text style={styles.stopName}>{stop.StopLabel || stop.TargetType}</Text>
          <Text style={styles.flyer}>Flyer: {stop.AssignedFlyerName || '—'}</Text>
          <Text style={styles.meta}>
            Visit: {stop.VisitFrequencyType || '—'}
            {stop.VisitFrequencyDays ? ` (${stop.VisitFrequencyDays}d)` : ''}
            · {stop.VisitDueStatus || '—'}
          </Text>
          <Text style={styles.meta}>
            Last visited: {stop.TargetLastVisitedAt ? String(stop.TargetLastVisitedAt).slice(0, 10) : '—'}
            · Next due: {stop.TargetNextDueDate || '—'}
          </Text>
          <Text>{stop.StopAddress || 'Address pending'}</Text>
          <Text style={styles.meta}>
            {stop.Status}
            {stop.CheckInRequired ? ' · check-in required' : ''}
            {stop.ProofUploadRequired ? ' · proof required' : ''}
          </Text>
          {stop.Status === 'pending' ? (
            <Button title="Complete visit" onPress={() => completeStop(stop.RouteStopId)} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 12, gap: 8 },
  card: { padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginBottom: 12 },
  stopOrder: { fontSize: 13, color: '#64748b' },
  stopName: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  flyer: { fontSize: 16, fontWeight: '600', color: '#3f5b76', marginBottom: 4 },
  meta: { color: '#64748b', marginTop: 4 },
  error: { color: '#b91c1c', marginBottom: 12 },
});
