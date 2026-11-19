import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/services/api';

type FlyerGroup = {
  campaignId: number;
  campaignName: string;
  flyers: Array<{
    distributorInventoryId: number;
    flyerName: string;
    assignedQuantity: number;
    deliveredQuantity: number;
    remainingQuantity: number;
    status: string;
    assignmentBatchId?: number | null;
  }>;
};

type BatchStop = {
  BatchStopId: number;
  StopLabel?: string | null;
  AddressLine?: string | null;
  SortOrder?: number;
  FlyersForStop?: number;
};

type Batch = {
  AssignmentBatchId: number;
  BatchName: string;
  TotalStops: number;
  TotalFlyers: number;
  Status: string;
  MarketName?: string | null;
  stops?: BatchStop[];
};

type MyFlyersSummary = {
  capacity: number;
  employmentType: string | null;
  totalAssignedToday: number;
  totalDeliveredToday: number;
  totalRemainingToday: number;
  flyersByCampaign: FlyerGroup[];
  batches: Batch[];
};

export default function MyFlyersScreen() {
  const [summary, setSummary] = useState<MyFlyersSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/distributor-inventory/my-flyers');
      setSummary(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load assigned flyers.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Flyers</Text>
      <View style={styles.actions}>
        <Button title="Refresh" onPress={load} />
        <Button title="Calendar" onPress={() => router.push('/calendar')} />
        {/* <Button title="Manual Delivery" onPress={() => router.push('/campaigns')} /> */}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summary ? (
        <>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Today's inventory</Text>
            <Text>Capacity: {summary.capacity} · {summary.employmentType || 'distributor'}</Text>
            <Text>Assigned: {summary.totalAssignedToday}</Text>
            <Text>Delivered: {summary.totalDeliveredToday}</Text>
            <Text style={styles.remaining}>Remaining: {summary.totalRemainingToday}</Text>
          </View>

          <Text style={styles.sectionTitle}>By campaign / flyer</Text>
          <FlatList
            data={summary.flyersByCampaign}
            keyExtractor={(item) => String(item.campaignId)}
            ListEmptyComponent={<Text>No flyers assigned today.</Text>}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{item.campaignName}</Text>
                {item.flyers.map((flyer) => (
                  <View key={flyer.distributorInventoryId} style={styles.flyerRow}>
                    <Text style={styles.flyerName}>{flyer.flyerName}</Text>
                    <Text>{flyer.remainingQuantity} remaining of {flyer.assignedQuantity}</Text>
                    <Text style={styles.meta}>Delivered {flyer.deliveredQuantity} · {flyer.status}</Text>
                  </View>
                ))}
              </View>
            )}
          />

          {summary.batches.length ? (
            <>
              <Text style={styles.sectionTitle}>Assigned routes / stops</Text>
              {summary.batches.map((batch) => (
                <View key={batch.AssignmentBatchId} style={styles.card}>
                  <Text style={styles.cardTitle}>{batch.BatchName}</Text>
                  <Text>{batch.TotalStops} stops · {batch.TotalFlyers} flyers · {batch.Status}</Text>
                  {batch.MarketName ? <Text style={styles.meta}>Market: {batch.MarketName}</Text> : null}
                  {(batch.stops || []).map((stop) => (
                    <Pressable key={stop.BatchStopId} style={styles.stopRow}>
                      <Text style={styles.flyerName}>{stop.StopLabel || 'Stop'}</Text>
                      <Text>{stop.AddressLine || 'Address pending'}</Text>
                      <Text style={styles.meta}>Flyers for stop: {stop.FlyersForStop ?? 1}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 },
  summaryCard: { padding: 16, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, marginBottom: 16, backgroundColor: '#f8fafc' },
  summaryTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  remaining: { fontSize: 20, fontWeight: '700', marginTop: 8, color: '#3f5b76' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  card: { padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  flyerRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  flyerName: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#64748b', marginTop: 2 },
  stopRow: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  error: { color: '#b91c1c', marginBottom: 12 },
});
