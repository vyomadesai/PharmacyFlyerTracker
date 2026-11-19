import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../src/components/ScreenBackButton';
import { getNewEntrySession, updateNewEntrySession } from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import type { NpiSummaryStats } from '../../src/features/new-entry/types';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

const SUMMARY_ITEMS: Array<{ key: keyof NpiSummaryStats; label: string }> = [
  { key: 'physicalFlyerDrops', label: 'Drops' },
  { key: 'organizationCount', label: 'Orgs' },
  { key: 'exactSuiteMatchCount', label: 'Suite' },
  { key: 'providerCount', label: 'Providers' },
  { key: 'alreadyKnownProviderCount', label: 'Known' },
  { key: 'newProviderCandidateCount', label: 'New' },
];

function SummaryStatsRow({ summary }: { summary: NpiSummaryStats }) {
  return (
    <View style={styles.summaryStatsRow}>
      {SUMMARY_ITEMS.map((item, index) => {
        const value = summary[item.key];
        const isLast = index === SUMMARY_ITEMS.length - 1;
        return (
          <View key={item.key} style={[styles.summaryStatCell, isLast && styles.summaryStatCellLast]}>
            <Text style={styles.summaryValueCompact}>{String(value ?? 0)}</Text>
            <Text style={styles.summaryLabelCompact}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function NewEntryNpiSummaryScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<NpiSummaryStats | null>(null);
  const loadKeyRef = useRef('');

  useFocusEffect(
    useCallback(() => {
      const current = getNewEntrySession();
      if (!current?.physicalDrop) {
        router.replace('/new-entry');
        return;
      }

      if (current.npiSummary) {
        setSummary(current.npiSummary);
        setLoading(false);
        setError('');
        return;
      }

      const loadKey = `${current.visitBatchId || ''}|${current.locationAddress}`;
      if (loadKeyRef.current === loadKey) return;
      loadKeyRef.current = loadKey;

      const parts = current.addressParts;
      setLoading(true);
      setError('');

      api
        .get<NpiSummaryStats>('/new-entries/npi-summary-at-address', {
          params: {
            lat: current.coords?.latitude,
            lng: current.coords?.longitude,
            address: current.locationAddress,
            street: parts?.street || undefined,
            city: parts?.city || undefined,
            state: parts?.state || 'FL',
            postalCode: parts?.postalCode || undefined,
            exactSuite: Boolean(parts?.street && /\b(STE|SUITE|#|APT|UNIT)\b/i.test(parts.street)),
            dropStatus: current.physicalDrop.dropStatus,
          },
        })
        .then((res) => {
          setSummary(res.data);
          updateNewEntrySession({ npiSummary: res.data });
        })
        .catch((e: any) => {
          loadKeyRef.current = '';
          setError(e?.response?.data?.message || e?.message || 'Could not load NPI summary.');
        })
        .finally(() => setLoading(false));
    }, []),
  );

  if (!getNewEntrySession()?.physicalDrop) return null;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to physical drop" />

        <Text style={shared.title}>NPI match summary</Text>
        <Text style={shared.subtitle}>
          Review organizations and providers before submitting. Flyer count is based on the physical drop only.
        </Text>

        {loading && !summary ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.helper}>Loading NPI counts…</Text>
          </View>
        ) : null}

        {error ? <Text style={shared.error}>{error}</Text> : null}

        {summary ? (
          <>
            <SummaryStatsRow summary={summary} />

            {summary.warnings.map((warning) => (
              <Text key={warning} style={styles.warningText}>
                {warning}
              </Text>
            ))}
            {summary.lookupHint ? <Text style={styles.hintText}>{summary.lookupHint}</Text> : null}
          </>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable style={[styles.inlineBtn, { flex: 1 }]} onPress={() => router.push('/new-entry/orgs')}>
            <Text style={[styles.inlineBtnText, { textAlign: 'center' }]}>Review organizations</Text>
          </Pressable>
          <Pressable style={[styles.inlineBtn, { flex: 1 }]} onPress={() => router.push('/new-entry/providers')}>
            <Text style={[styles.inlineBtnText, { textAlign: 'center' }]}>Review providers</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
