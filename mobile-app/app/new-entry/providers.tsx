import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../src/components/ScreenBackButton';
import ListPagination, { paginateList } from '../../src/features/new-entry/ListPagination';
import {
  getNewEntrySession,
  setProviderSelections,
} from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import type { ProviderSelection } from '../../src/features/new-entry/types';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

function mapProvidersFromApi(
  rows: Array<{
    npi: string;
    providerName: string;
    providerAddress: string;
    taxonomyCode: string | null;
    taxonomyDesc: string | null;
    phone: string | null;
    alreadyKnown: boolean;
    isPrescriber: boolean;
    providerCategory: string;
  }>,
): ProviderSelection[] {
  return rows.map((provider) => ({
    npi: provider.npi,
    providerName: provider.providerName,
    providerAddress: provider.providerAddress,
    taxonomyCode: provider.taxonomyCode,
    taxonomyDescription: provider.taxonomyDesc,
    phone: provider.phone || '',
    alreadyKnown: provider.alreadyKnown,
    isPrescriber: provider.isPrescriber,
    providerCategory: provider.providerCategory,
    verificationStatus: provider.alreadyKnown ? 'ignore' : 'npi_only',
    selectedForReview: false,
  }));
}

export default function NewEntryProvidersScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<ProviderSelection[]>([]);
  const [page, setPage] = useState(1);
  const loadKeyRef = useRef('');

  useFocusEffect(
    useCallback(() => {
      const current = getNewEntrySession();
      if (!current?.physicalDrop) {
        router.replace('/new-entry');
        return;
      }

      if (current.providerSelections?.length) {
        setProviders(current.providerSelections);
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
        .get<{ allProviders: Parameters<typeof mapProvidersFromApi>[0] }>('/new-entries/providers-at-address', {
          params: {
            address: current.locationAddress,
            street: parts?.street || undefined,
            city: parts?.city || undefined,
            state: parts?.state || 'FL',
            postalCode: parts?.postalCode || undefined,
            exactSuite: Boolean(parts?.street && /\b(STE|SUITE|#|APT|UNIT)\b/i.test(parts.street)),
          },
        })
        .then((res) => {
          const mapped = mapProvidersFromApi(res.data.allProviders || []);
          setProviders(mapped);
          setProviderSelections(mapped);
        })
        .catch((e: any) => {
          loadKeyRef.current = '';
          setError(e?.response?.data?.message || e?.message || 'Could not load providers.');
        })
        .finally(() => setLoading(false));
    }, []),
  );

  function applyProviders(next: ProviderSelection[]) {
    setProviders(next);
    setProviderSelections(next);
  }

  const newCandidates = useMemo(
    () => providers.filter((provider) => !provider.alreadyKnown),
    [providers],
  );

  const pagination = useMemo(() => paginateList(newCandidates, page), [newCandidates, page]);

  useEffect(() => {
    if (page !== pagination.safePage) {
      setPage(pagination.safePage);
    }
  }, [page, pagination.safePage]);

  function toggleReview(npi: string) {
    applyProviders(
      providers.map((entry) => {
        if (entry.npi !== npi) return entry;
        const next = !entry.selectedForReview;
        return {
          ...entry,
          selectedForReview: next,
          verificationStatus: next ? 'selected_for_review' : 'npi_only',
        };
      }),
    );
  }

  function selectAllVisible() {
    const visibleNpis = new Set(pagination.pageItems.map((p) => p.npi));
    applyProviders(
      providers.map((provider) =>
        visibleNpis.has(provider.npi)
          ? { ...provider, selectedForReview: true, verificationStatus: 'selected_for_review' as const }
          : provider,
      ),
    );
  }

  function clearVisibleSelection() {
    const visibleNpis = new Set(pagination.pageItems.map((p) => p.npi));
    applyProviders(
      providers.map((provider) =>
        visibleNpis.has(provider.npi)
          ? { ...provider, selectedForReview: false, verificationStatus: 'npi_only' as const }
          : provider,
      ),
    );
  }

  function updatePhone(npi: string, phone: string) {
    applyProviders(providers.map((entry) => (entry.npi === npi ? { ...entry, phone } : entry)));
  }

  const selectedCount = providers.filter((provider) => provider.selectedForReview).length;

  if (!getNewEntrySession()?.physicalDrop) return null;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to NPI summary" />

        <Text style={shared.title}>New provider candidates</Text>
        <Text style={shared.subtitle}>
          Multi-select providers not already in the database to add as New Entries candidates for admin review.
        </Text>

        {loading && !providers.length ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.helper}>Loading providers at this address…</Text>
          </View>
        ) : null}
        {error ? <Text style={shared.error}>{error}</Text> : null}

        {!loading || providers.length ? (
          <>
            <View style={styles.actionRow}>
              <Pressable style={styles.inlineBtn} onPress={selectAllVisible}>
                <Text style={styles.inlineBtnText}>Select visible</Text>
              </Pressable>
              <Pressable style={styles.inlineBtn} onPress={clearVisibleSelection}>
                <Text style={styles.inlineBtnText}>Clear visible</Text>
              </Pressable>
            </View>

            <Text style={shared.meta}>
              {selectedCount} selected for New Entries review · {newCandidates.length} new candidates
            </Text>

            <ListPagination
              page={pagination.safePage}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              showingFrom={pagination.showingFrom}
              showingTo={pagination.showingTo}
              onPageChange={setPage}
            />

            {!newCandidates.length ? (
              <Text style={styles.hintText}>No new provider candidates at this location.</Text>
            ) : (
              pagination.pageItems.map((provider) => (
                <View
                  key={provider.npi}
                  style={[styles.providerCard, provider.selectedForReview && styles.flyerCardSelected]}
                >
                  <Pressable
                    style={[styles.checkbox, provider.selectedForReview && styles.checkboxChecked]}
                    onPress={() => toggleReview(provider.npi)}
                  >
                    {provider.selectedForReview ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </Pressable>

                  <View style={styles.selectBody}>
                    <Pressable onPress={() => toggleReview(provider.npi)}>
                      <Text style={styles.providerName}>{provider.providerName}</Text>
                      <Text style={styles.providerMeta}>NPI: {provider.npi}</Text>
                      {provider.taxonomyDescription ? (
                        <Text style={styles.providerMeta}>Taxonomy: {provider.taxonomyDescription}</Text>
                      ) : null}
                      <Text style={styles.providerMeta}>Address: {provider.providerAddress}</Text>
                    </Pressable>
                    <Text style={styles.label}>Phone</Text>
                    <TextInput
                      style={styles.input}
                      value={provider.phone}
                      onChangeText={(value) => updatePhone(provider.npi, value)}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>
              ))
            )}

            <ListPagination
              page={pagination.safePage}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              showingFrom={pagination.showingFrom}
              showingTo={pagination.showingTo}
              onPageChange={setPage}
            />
          </>
        ) : null}

        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/new-entry/orgs')}>
          <Text style={styles.secondaryBtnText}>Back to organizations</Text>
        </Pressable>

        <Pressable style={shared.primaryButton} onPress={() => router.push('/new-entry/review')}>
          <Text style={shared.primaryButtonText}>
            {selectedCount
              ? `Continue with ${selectedCount} for review`
              : 'Continue to review'}
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
