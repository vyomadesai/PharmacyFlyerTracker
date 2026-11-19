import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

const ROUTE_SESSION_STORAGE_KEY = 'routeThree.openSession.v1';

type ShiftSummary = {
  completedStops: number;
  totalStops: number;
  flyers: number;
  doctors: number;
  startedAt?: string;
};

function formatElapsed(startedAt: string | undefined, now: number) {
  if (!startedAt) return '—';
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

type CalendarDay = {
  date: string;
  stopCount: number;
  flyerCount: number;
};

type CalendarData = {
  today: string;
  days: CalendarDay[];
};

type CalendarCell = {
  key: string;
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  row?: CalendarDay;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function monthTitle(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}

function dayTitle(dateString: string) {
  return parseDateKey(dateString).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

function buildMonthGrid(
  visibleMonth: Date,
  selectedDate: string,
  today: string,
  rowsByDate: Map<string, CalendarDay>
): CalendarCell[] {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const start = addDays(firstOfMonth, -firstOfMonth.getDay());

  return Array.from({ length: 42 }).map((_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);

    return {
      key,
      date,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
      isToday: key === today,
      isSelected: key === selectedDate,
      row: rowsByDate.get(key)
    };
  });
}

export default function CalendarScreen() {
  const localToday = dateKey(new Date());

  const [data, setData] = useState<CalendarData | null>(null);
  const [selectedDate, setSelectedDate] = useState(localToday);
  const [visibleMonth, setVisibleMonth] = useState(parseDateKey(localToday));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    setLoading(true);
    setError('');

    try {
      const res = await api.get<CalendarData>('/route-planner/my/calendar');
      const payload = res.data;
      setData(payload);

      if (payload.today) {
        setSelectedDate(payload.today);
        setVisibleMonth(parseDateKey(payload.today));
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load calendar.');
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => {
    load();
    AsyncStorage.getItem(ROUTE_SESSION_STORAGE_KEY)
      .then((raw) => {
        if (!raw) {
          setShift(null);
          return;
        }
        const parsed = JSON.parse(raw) as { shift?: ShiftSummary };
        setShift(parsed.shift || null);
      })
      .catch(() => setShift(null));
  }, []));

  useEffect(() => {
    if (!shift?.startedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, [shift?.startedAt]);

  const todayKey = data?.today || localToday;

  const rowsByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();

    for (const row of data?.days || []) {
      map.set(String(row.date).slice(0, 10), row);
    }

    return map;
  }, [data?.days]);

  const monthCells = useMemo(
    () => buildMonthGrid(visibleMonth, selectedDate, todayKey, rowsByDate),
    [visibleMonth, selectedDate, todayKey, rowsByDate]
  );

  const selectedRow = rowsByDate.get(selectedDate);
  const selectedIsToday = selectedDate === todayKey;

  function selectDate(value: string) {
    setSelectedDate(value);
    setVisibleMonth(parseDateKey(value));
  }

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={shared.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={shared.title}>Calendar</Text>
        <Text style={shared.subtitle}>Stops and flyers by day. Tap a date to see the count.</Text>

        {error ? <Text style={shared.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator color={colors.primary} /> : null}

        {data ? (
          <>
            <View style={styles.calendarCard}>
              <View style={styles.monthHeader}>
                <Pressable
                  style={styles.monthButton}
                  onPress={() => setVisibleMonth((month) => addMonths(month, -1))}
                >
                  <Text style={styles.monthButtonText}>‹</Text>
                </Pressable>

                <Text style={styles.monthTitle}>{monthTitle(visibleMonth)}</Text>

                <Pressable
                  style={styles.monthButton}
                  onPress={() => setVisibleMonth((month) => addMonths(month, 1))}
                >
                  <Text style={styles.monthButtonText}>›</Text>
                </Pressable>
              </View>

              <View style={styles.weekdayHeader}>
                {WEEKDAYS.map((day) => (
                  <Text key={day} style={styles.weekdayText}>{day}</Text>
                ))}
              </View>

              <View style={styles.monthGrid}>
                {monthCells.map((cell) => {
                  const stopCount = cell.row?.stopCount || 0;
                  const flyerCount = cell.row?.flyerCount || 0;
                  const hasActivity = stopCount > 0 || flyerCount > 0;

                  return (
                    <Pressable
                      key={cell.key}
                      style={[
                        styles.dayCell,
                        !cell.isCurrentMonth && styles.dayCellMuted,
                        cell.isToday && styles.dayCellToday,
                        cell.isSelected && styles.dayCellSelected
                      ]}
                      onPress={() => selectDate(cell.key)}
                    >
                      <Text
                        style={[
                          styles.dayNumber,
                          !cell.isCurrentMonth && styles.mutedText,
                          cell.isSelected && styles.selectedText
                        ]}
                      >
                        {cell.dayNumber}
                      </Text>

                      {hasActivity ? (
                        <View style={[styles.activityDot, cell.isSelected && styles.activityDotSelected]} />
                      ) : (
                        <View style={styles.activitySpacer} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View>
                  <Text style={styles.kicker}>Selected date</Text>
                  <Text style={styles.detailTitle}>{dayTitle(selectedDate)}</Text>
                </View>

                {selectedIsToday ? (
                  <View style={styles.todayBadge}>
                    <Text style={styles.todayBadgeText}>Today</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.shiftStrip}>
                <ShiftStat icon="checkmark-done-outline" value={`${shift?.completedStops ?? 0}/${shift?.totalStops ?? 0}`} label="Stops" />
                <View style={styles.shiftDivider} />
                <ShiftStat icon="document-text-outline" value={String(shift?.flyers ?? 0)} label="Flyers" />
                <View style={styles.shiftDivider} />
                <ShiftStat icon="people-outline" value={String(shift?.doctors ?? 0)} label="Doctors" />
                <View style={styles.shiftDivider} />
                <ShiftStat icon="time-outline" value={formatElapsed(shift?.startedAt, now)} label="Route" />
              </View>

              {selectedRow ? null : (
                <Text style={shared.meta}>No deliveries recorded for this day.</Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ShiftStat({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string }) {
  return (
    <View style={styles.shiftStat}>
      <Ionicons name={icon} size={14} color="#3f5b76" />
      <Text style={styles.shiftValue}>{value}</Text>
      <Text style={styles.shiftLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4
  },
  calendarCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  monthButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8eef3',
    alignItems: 'center',
    justifyContent: 'center'
  },
  monthButtonText: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '800'
  },
  monthTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900'
  },
  weekdayHeader: {
    flexDirection: 'row',
    marginBottom: 8
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase'
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  dayCell: {
    width: `${100 / 7}%`,
    minHeight: 48,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellMuted: {
    opacity: 0.35
  },
  dayCellToday: {
    backgroundColor: '#e8eef3'
  },
  dayCellSelected: {
    backgroundColor: colors.primary
  },
  dayNumber: {
    color: '#111827',
    fontWeight: '900',
    fontSize: 14
  },
  mutedText: {
    color: '#94a3b8'
  },
  selectedText: {
    color: '#ffffff'
  },
  activityDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  activityDotSelected: { backgroundColor: '#fff' },
  activitySpacer: { width: 5, height: 5, marginTop: 4 },
  shiftStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  shiftStat: { flex: 1, alignItems: 'center', gap: 1 },
  shiftValue: { color: '#111827', fontSize: 15, fontWeight: '900' },
  shiftLabel: { color: '#64748b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  shiftDivider: { width: 1, height: 28, backgroundColor: '#e2e8f0' },
  detailCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12
  },
  detailTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900'
  },
  todayBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7'
  },
  todayBadgeText: {
    color: '#15803d',
    fontWeight: '900'
  },
  countCard: {
    flexDirection: 'row',
    gap: 12
  },
  countBlock: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center'
  },
  countValue: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: '900'
  },
  countLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center'
  }
});
