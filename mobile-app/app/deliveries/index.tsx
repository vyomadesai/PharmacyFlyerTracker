import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

type FlyerStatus = 'completed' | 'pending' | 'skipped';

type DeliveryFlyer = {
  title: string;
  status: FlyerStatus;
};

type DeliveryStop = {
  routePlanStopId: number;
  stopOrder: number;
  locationName: string;
  address: string;
  status: string;
  completedAt: string | null;
  outcome: string | null;
  flyerTotal: number;
  flyerDone: number;
  flyers: DeliveryFlyer[];
};

type DeliverySession = {
  checkInId: number;
  checkInAt: string;
  checkOutAt: string | null;
  deliveryCount: number;
  stops?: DeliveryStop[];
};

type DeliveryDay = {
  date: string;
  totalDeliveries: number;
  sessions: DeliverySession[];
};

type DeliveryHistory = {
  days: DeliveryDay[];
  totalDeliveries: number;
};

const OUTCOME_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  left_at_desk: 'Left at desk',
  refused: 'Refused',
  closed: 'Closed',
  wrong_address: 'Wrong address',
};

const NEGATIVE_OUTCOMES = new Set(['refused', 'closed', 'wrong_address']);

function localDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function stopTone(stop: DeliveryStop): 'done' | 'progress' | 'idle' | 'negative' {
  if (stop.outcome && NEGATIVE_OUTCOMES.has(stop.outcome)) return 'negative';
  if (stop.flyerTotal > 0 && stop.flyerDone === stop.flyerTotal) return 'done';
  if (stop.status === 'completed') return 'done';
  if (stop.flyerDone > 0) return 'progress';
  return 'idle';
}

function stopStatusLabel(stop: DeliveryStop) {
  if (stop.outcome && NEGATIVE_OUTCOMES.has(stop.outcome)) {
    return OUTCOME_LABEL[stop.outcome] || 'Not completed';
  }
  if (stop.flyerTotal > 0 && stop.flyerDone === stop.flyerTotal) return 'All completed';
  if (stop.status === 'skipped') return 'Skipped';
  if (stop.status === 'completed') return 'Completed';
  if (stop.flyerDone > 0) return `${stop.flyerDone} of ${stop.flyerTotal}`;
  return 'Not started';
}

function flyerStatusLabel(status: FlyerStatus) {
  if (status === 'completed') return 'Done';
  if (status === 'skipped') return 'Skipped';
  return 'Not yet';
}

function stopWasVisited(stop: DeliveryStop) {
  if (stop.completedAt) return true;
  if (stop.outcome) return true;
  if (stop.status === 'completed' || stop.status === 'skipped') return true;
  return stop.flyers.some((flyer) => flyer.status === 'completed' || flyer.status === 'skipped');
}

export default function DeliveriesScreen() {
  const [data, setData] = useState<DeliveryHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<DeliveryHistory>('/route-planner/my/deliveries');
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load deliveries.');
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  const todayKey = localDateKey(new Date());

  const todaySessions = useMemo(() => {
    if (!data) return [];
    return data.days
      .flatMap((day) => day.sessions)
      .filter((session) => localDateKey(new Date(session.checkInAt)) === todayKey)
      .sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime());
  }, [data, todayKey]);

  const visitedStops = todaySessions
    .flatMap((session) => session.stops ?? [])
    .filter(stopWasVisited)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime || a.stopOrder - b.stopOrder;
    })
    .filter((stop, index, list) => list.findIndex((item) => item.routePlanStopId === stop.routePlanStopId) === index);

  const flyerDone = visitedStops.reduce((sum, stop) => sum + stop.flyerDone, 0);
  const flyerTotal = visitedStops.reduce((sum, stop) => sum + stop.flyerTotal, 0);

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={shared.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={shared.title}>Deliveries</Text>
        <Text style={shared.subtitle}>Stops you finished today.</Text>

        {error ? <Text style={shared.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator color={colors.primary} /> : null}

        {data && todaySessions.length === 0 ? (
          <View style={shared.card}>
            <Text style={shared.cardTitle}>Nothing delivered yet</Text>
            <Text style={shared.meta}>
              Finish a stop on today's route and it will show here with the practice name and the flyers you completed.
            </Text>
          </View>
        ) : null}

        {todaySessions.length > 0 && visitedStops.length === 0 ? (
          <View style={shared.card}>
            <Text style={shared.cardTitle}>No finished visits yet</Text>
            <Text style={shared.meta}>
              A stop shows here after you finish it on the route. Stops you have not visited stay off this list.
            </Text>
          </View>
        ) : null}

        {visitedStops.length > 0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.eyebrow}>Today</Text>
            <Text style={styles.summaryValue}>{visitedStops.length}</Text>
            <Text style={styles.summaryMeta}>
              {visitedStops.length === 1 ? 'stop visited' : 'stops visited'}
            </Text>
            {flyerTotal > 0 ? (
              <Text style={styles.summaryNote}>
                {flyerDone} of {flyerTotal} {flyerTotal === 1 ? 'flyer' : 'flyers'} completed
              </Text>
            ) : null}
          </View>
        ) : null}

        {visitedStops.map((stop) => {
          const tone = stopTone(stop);
          const finishedAt = stop.completedAt ? `Finished ${formatTime(stop.completedAt)}` : 'Visited';
          const note = stop.outcome && !NEGATIVE_OUTCOMES.has(stop.outcome)
            ? OUTCOME_LABEL[stop.outcome]
            : '';
          return (
            <View key={stop.routePlanStopId} style={styles.stopCard}>
              <View style={styles.stopTop}>
                <View style={styles.orderBadge}>
                  <Text style={styles.orderText}>{stop.stopOrder || '•'}</Text>
                </View>
                <View style={styles.stopIdentity}>
                  <Text style={styles.locationName}>{stop.locationName}</Text>
                  {stop.address ? <Text style={styles.address}>{stop.address}</Text> : null}
                </View>
                <View style={[styles.pill, styles[`pill_${tone}`]]}>
                  <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{stopStatusLabel(stop)}</Text>
                </View>
              </View>

              <View style={styles.finishedRow}>
                <Ionicons name="flag-outline" size={14} color={colors.muted} />
                <Text style={styles.finishedText}>{finishedAt}</Text>
                {note ? <Text style={styles.noteText}>{note}</Text> : null}
              </View>

              {stop.flyers.length > 0 ? (
                <View style={styles.flyerList}>
                  {stop.flyers.map((flyer) => (
                    <View key={`${stop.routePlanStopId}-${flyer.title}`} style={styles.flyerRow}>
                      <Text style={styles.flyerTitle}>{flyer.title}</Text>
                      <Text style={[
                        styles.flyerStatus,
                        flyer.status === 'completed' && styles.flyerDone,
                        flyer.status === 'skipped' && styles.flyerSkipped,
                      ]}>
                        {flyerStatusLabel(flyer.status)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noFlyers}>No flyers on this stop.</Text>
              )}
            </View>
          );
        })}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryValue: {
    color: colors.primary,
    fontSize: 40,
    fontWeight: '800',
    marginTop: 2,
  },
  summaryMeta: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  summaryNote: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  stopCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  stopTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e8eef3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  stopIdentity: { flex: 1, minWidth: 0 },
  locationName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  address: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 118,
  },
  pill_done: { backgroundColor: '#dcfce7' },
  pill_progress: { backgroundColor: '#e8eef3' },
  pill_idle: { backgroundColor: '#f1f5f9' },
  pill_negative: { backgroundColor: '#fee2e2' },
  pillText: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
  pillText_done: { color: colors.success },
  pillText_progress: { color: colors.primary },
  pillText_idle: { color: colors.muted },
  pillText_negative: { color: colors.danger },
  finishedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  finishedText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  noteText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  flyerList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  flyerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 7,
  },
  flyerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  flyerStatus: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  flyerDone: { color: colors.success },
  flyerSkipped: { color: colors.warning },
  noFlyers: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 10,
  },
});
