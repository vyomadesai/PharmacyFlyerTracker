import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';

/**
 * Front-desk notes for the current stop: what happened at the counter, the best
 * time to come back, and who to ask for. This is the office intel a distributor
 * picks up on every visit and would otherwise keep in their head.
 *
 * Saves automatically (debounced) to PATCH /route-three/stops/:id/front-desk.
 * Does not touch check-in, doctor selection, or proof-photo logic.
 */

export type FrontDeskOutcome = 'accepted' | 'left_at_desk' | 'refused' | 'closed' | 'wrong_address';
export type BestTimeToVisit = 'morning' | 'midday' | 'afternoon';

type FrontDesk = {
  outcome: FrontDeskOutcome | null;
  bestTime: BestTimeToVisit | null;
  contactName: string;
  note: string;
};

const EMPTY: FrontDesk = { outcome: null, bestTime: null, contactName: '', note: '' };

const OUTCOMES: Array<{ key: FrontDeskOutcome; label: string; icon: keyof typeof Ionicons.glyphMap; tone: 'good' | 'ok' | 'bad' }> = [
  { key: 'accepted', label: 'Accepted', icon: 'checkmark-circle-outline', tone: 'good' },
  { key: 'left_at_desk', label: 'Left at desk', icon: 'file-tray-outline', tone: 'ok' },
  { key: 'refused', label: 'Refused', icon: 'close-circle-outline', tone: 'bad' },
  { key: 'closed', label: 'Closed', icon: 'lock-closed-outline', tone: 'bad' },
  { key: 'wrong_address', label: 'Wrong address', icon: 'alert-circle-outline', tone: 'bad' },
];

const BEST_TIMES: Array<{ key: BestTimeToVisit; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'morning', label: 'Morning', icon: 'sunny-outline' },
  { key: 'midday', label: 'Midday', icon: 'partly-sunny-outline' },
  { key: 'afternoon', label: 'Afternoon', icon: 'moon-outline' },
];

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type Props = {
  routePlanStopId: number;
  /** Hide the inputs until the distributor is actually at the counter. */
  enabled: boolean;
  onOutcomeChange?: (outcome: FrontDeskOutcome | null) => void;
  proofUri?: string;
  proofBusy?: boolean;
  onTakeProof?: () => void;
  onNext?: () => void;
};

const POSITIVE_OUTCOMES = new Set<FrontDeskOutcome>(['accepted', 'left_at_desk']);

export default function FrontDeskCard({
  routePlanStopId,
  enabled,
  onOutcomeChange,
  proofUri,
  proofBusy,
  onTakeProof,
  onNext,
}: Props) {
  const [data, setData] = useState<FrontDesk>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<number | null>(null);

  // Load what is already on file for this stop.
  useEffect(() => {
    let cancelled = false;
    loadedFor.current = null;
    setData(EMPTY);
    onOutcomeChange?.(null);
    setSaveState('idle');
    setLoading(true);
    api.get<{ outcome: FrontDeskOutcome | null; bestTime: BestTimeToVisit | null; contactName: string | null; note: string | null }>(
      `/route-three/stops/${routePlanStopId}/front-desk`,
    )
      .then((res) => {
        if (cancelled) return;
        const next: FrontDesk = {
          outcome: res.data?.outcome ?? null,
          bestTime: res.data?.bestTime ?? null,
          contactName: res.data?.contactName ?? '',
          note: res.data?.note ?? '',
        };
        setData(next);
        onOutcomeChange?.(next.outcome);
        loadedFor.current = routePlanStopId;
      })
      .catch(() => {
        if (!cancelled) loadedFor.current = routePlanStopId;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [routePlanStopId, onOutcomeChange]);

  function queueSave(next: FrontDesk) {
    setData(next);
    onOutcomeChange?.(next.outcome);
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next), 700);
  }

  async function persist(next: FrontDesk) {
    if (loadedFor.current !== routePlanStopId) return;
    setSaveState('saving');
    try {
      await api.patch(`/route-three/stops/${routePlanStopId}/front-desk`, {
        outcome: next.outcome,
        bestTime: next.bestTime,
        contactName: next.contactName.trim() || null,
        note: next.note.trim() || null,
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  if (!enabled) {
    return (
      <View style={styles.card}>
        <Header saveState="idle" />
        <Text style={styles.locked}>Opens after you check in.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Header saveState={saveState} />

      {loading ? (
        <ActivityIndicator color="#3f5b76" style={{ marginTop: 10 }} />
      ) : (
        <>
          <Text style={styles.label}>Where did you leave the flyers?</Text>
          <View style={styles.outcomeRowGood}>
            {OUTCOMES.filter((item) => item.tone !== 'bad').map((item) => {
              const active = data.outcome === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => queueSave({ ...data, outcome: active ? null : item.key })}
                  style={[styles.chip, styles.chipOnGood, active && styles.chip_good]}
                  hitSlop={4}
                >
                  <Ionicons name={item.icon} size={14} color={active ? '#16a34a' : '#15803d'} />
                  <Text style={[styles.chipText, { color: active ? '#16a34a' : '#15803d' }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.outcomeRowBad}>
            {OUTCOMES.filter((item) => item.tone === 'bad').map((item) => {
              const active = data.outcome === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => queueSave({ ...data, outcome: active ? null : item.key })}
                  style={[styles.chip, styles.chipOnBad, active && styles.chip_bad]}
                  hitSlop={4}
                >
                  <Ionicons name={item.icon} size={14} color={active ? '#b91c1c' : '#9f1239'} />
                  <Text style={[styles.chipText, { color: active ? '#b91c1c' : '#9f1239' }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {data.outcome && POSITIVE_OUTCOMES.has(data.outcome) ? (
            <View style={styles.followUp}>
              <Text style={styles.stepTitle}>1. Take proof photo <Text style={styles.required}>*</Text></Text>
              {proofUri ? <Image source={{ uri: proofUri }} style={styles.proof} /> : null}
              {proofUri ? (
                <>
                  <Pressable
                    style={[styles.retakeBtn, proofBusy && styles.photoBtnBusy]}
                    onPress={onTakeProof}
                    disabled={proofBusy || !onTakeProof}
                  >
                    <Ionicons name="camera-outline" size={16} color="#3f5b76" />
                    <Text style={styles.retakeBtnText}>{proofBusy ? 'Opening camera…' : 'Retake photo'}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={[styles.photoBtn, proofBusy && styles.photoBtnBusy]}
                    onPress={onTakeProof}
                    disabled={proofBusy || !onTakeProof}
                  >
                    <Ionicons name="camera" size={18} color="#fff" />
                    <Text style={styles.photoBtnText}>{proofBusy ? 'Opening camera…' : 'Take proof photo'}</Text>
                  </Pressable>
                </>
              )}

              {proofUri ? (
              <>
              <Text style={styles.stepTitle}>2. Best time to come back</Text>
              <View style={styles.timeRow}>
                {BEST_TIMES.map((item) => {
                  const active = data.bestTime === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => queueSave({ ...data, bestTime: active ? null : item.key })}
                      style={[styles.timeBtn, active && styles.timeBtnOn]}
                    >
                      <Ionicons name={item.icon} size={18} color={active ? '#fff' : '#3f5b76'} />
                      <Text style={[styles.timeText, active && styles.timeTextOn]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.stepTitle}>3. Contact name or a note</Text>
              <TextInput
                value={data.contactName}
                onChangeText={(value) => queueSave({ ...data, contactName: value })}
                placeholder="Who should we ask for?"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                autoCapitalize="words"
              />
              <TextInput
                value={data.note}
                onChangeText={(value) => queueSave({ ...data, note: value })}
                placeholder="Note for the next visit"
                placeholderTextColor="#94a3b8"
                style={[styles.input, styles.inputMulti]}
                multiline
              />
              <SaveNext
                state={saveState}
                onSave={() => {
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  void persist(data);
                }}
                onNext={() => {
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  void persist(data);
                  onNext?.();
                }}
              />
              </>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function SaveNext({ state, onSave, onNext }: { state: SaveState; onSave: () => void; onNext: () => void }) {
  const saving = state === 'saving' || state === 'dirty';
  return (
    <View style={styles.actionBox}>
      <Text style={styles.actionLabel}>This drop</Text>
      <Pressable style={[styles.saveBtn, state === 'saved' && styles.saveBtnDone]} onPress={onSave}>
        {state === 'saved' ? (
          <View style={styles.savedRow}>
            <Ionicons name="checkmark" size={16} color="#16a34a" />
            <Text style={styles.saveOk}>Saved</Text>
          </View>
        ) : (
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : state === 'error' ? 'Not saved' : 'Save'}</Text>
        )}
      </Pressable>
      <Pressable style={styles.nextBtn} onPress={onNext}>
        <Text style={styles.nextBtnText}>See doctors</Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </Pressable>
    </View>
  );
}

function Header({ saveState }: { saveState: SaveState }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Ionicons name="clipboard-outline" size={16} color="#3f5b76" />
        <Text style={styles.title}>Front desk</Text>
      </View>
      <SaveBadge state={saveState} />
    </View>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saving' || state === 'dirty') {
    return <Text style={styles.saveMuted}>Saving…</Text>;
  }
  if (state === 'error') {
    return <Text style={styles.saveError}>Not saved · check connection</Text>;
  }
  return (
    <View style={styles.savedRow}>
      <Ionicons name="checkmark" size={13} color="#16a34a" />
      <Text style={styles.saveOk}>Saved</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    paddingTop: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#111827', fontSize: 15, fontWeight: '700' },
  locked: { color: '#6b7280', fontSize: 13, fontWeight: '500', marginTop: 6 },
  label: { color: '#6b7280', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  outcomeRowGood: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#dcfce7',
    borderRadius: 16,
    padding: 8,
  },
  outcomeRowBad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    backgroundColor: '#fee2e2',
    borderRadius: 16,
    padding: 8,
  },
  chip: {
    flexGrow: 1,
    flexBasis: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  chipOnGood: {},
  chipOnBad: {},
  chip_good: { backgroundColor: '#fff', borderColor: '#86efac' },
  chip_bad: { backgroundColor: '#fff', borderColor: '#fecaca' },
  chipText: { color: '#475569', fontSize: 13, fontWeight: '700' },
  followUp: { marginTop: 16, gap: 8 },
  stepTitle: { color: '#111827', fontSize: 16, fontWeight: '700', marginTop: 8 },
  required: { color: '#b91c1c' },
  stepHint: { color: '#6b7280', fontSize: 13, fontWeight: '500', marginBottom: 4 },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeBtn: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#c5d0dc',
    backgroundColor: '#e8eef3',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  timeBtnOn: { backgroundColor: '#3f5b76', borderColor: '#3f5b76' },
  timeText: { color: '#3f5b76', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  timeTextOn: { color: '#fff' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#111827',
    fontSize: 15,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  proof: { width: '100%', height: 160, borderRadius: 14, backgroundColor: '#e5e7eb', marginTop: 4 },
  proofDone: { color: '#16a34a', fontSize: 14, fontWeight: '700' },
  photoBtn: {
    marginTop: 4,
    backgroundColor: '#3f5b76',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  photoBtnBusy: { opacity: 0.55 },
  photoBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  retakeBtn: {
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: '#3f5b76',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#fff',
  },
  retakeBtnText: { color: '#3f5b76', fontSize: 15, fontWeight: '700' },
  actionBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  actionLabel: { color: '#6b7280', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  saveBtn: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDone: { backgroundColor: '#ecfdf5', borderColor: '#86efac' },
  saveBtnText: { color: '#111827', fontSize: 16, fontWeight: '700' },
  nextBtn: {
    backgroundColor: '#3f5b76',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  saveMuted: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  saveError: { color: '#b91c1c', fontSize: 11, fontWeight: '700' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  saveOk: { color: '#16a34a', fontSize: 11, fontWeight: '800' },
});
