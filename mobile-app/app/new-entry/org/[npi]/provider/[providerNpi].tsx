import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DistributorNav from '../../../../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../../../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../../../../src/components/ScreenBackButton';
import OrgSummaryCard from '../../../../../src/features/new-entry/OrgSummaryCard';
import {
  getNewEntrySession,
  setProviderDraft,
  setProviderSelected,
} from '../../../../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../../../../src/features/new-entry/styles';
import type { OrgProviderDetail, OrgProviderDraft } from '../../../../../src/features/new-entry/types';
import { api } from '../../../../../src/services/api';
import { colors, shared } from '../../../../../src/styles/distributor';

function displayValue(value: string | null | undefined) {
  const text = String(value || '').trim();
  return text || '—';
}

function formatSecondaryAddresses(addresses: string[]) {
  if (!addresses.length) return '—';
  return addresses.join('\n');
}

export default function NewEntryOrgProviderDetailScreen() {
  const { npi: orgNpi, providerNpi } = useLocalSearchParams<{ npi: string; providerNpi: string }>();
  const session = getNewEntrySession();
  const orgVisit = session?.orgVisit;

  const [provider, setProvider] = useState<OrgProviderDetail | null>(null);
  const [phone, setPhone] = useState('');
  const [included, setIncluded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const orgName = orgVisit?.organization.organizationName || '—';

  const loadProvider = useCallback(async () => {
    const visit = getNewEntrySession()?.orgVisit;
    const currentSession = getNewEntrySession();
    if (!providerNpi || !visit || visit.organization.npi !== orgNpi || !currentSession) {
      router.replace('/new-entry');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.get<{ provider: OrgProviderDetail }>(`/new-entries/providers/${providerNpi}`, {
        params: {
          practiceName: currentSession.practiceName.trim() || visit.organization.organizationName,
        },
      });

      const detail = res.data.provider;
      setProvider(detail);

      const existingDraft = visit.providerDrafts?.[providerNpi];
      const initialPhone = existingDraft?.phone || detail.phone || '';
      setPhone(initialPhone);
      setIncluded(visit.selectedProviderNpis.includes(providerNpi));
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not load provider details.');
    } finally {
      setLoading(false);
    }
  }, [orgNpi, providerNpi]);

  useEffect(() => {
    loadProvider();
  }, [loadProvider]);

  function persistDraft(nextPhone: string, nextIncluded: boolean) {
    if (!provider || !orgVisit) return;

    const draft: OrgProviderDraft = {
      npi: provider.npi,
      providerName: provider.providerName,
      providerAddress: provider.providerAddress,
      primaryPracticeAddress: provider.primaryPracticeAddress || provider.providerAddress,
      secondaryPracticeAddresses: provider.secondaryPracticeAddresses || [],
      phone: nextPhone,
      taxonomyCode: provider.taxonomyCode,
      taxonomyDesc: provider.taxonomyDesc,
      primaryTaxonomy: provider.primaryTaxonomy,
      selectedTaxonomy: provider.selectedTaxonomy,
      taxonomyState: provider.taxonomyState,
      licenseNumber: provider.licenseNumber,
      practiceName: orgName,
    };

    setProviderDraft(provider.npi, draft);
    setProviderSelected(provider.npi, nextIncluded);
  }

  function handlePhoneChange(value: string) {
    setPhone(value);
    persistDraft(value, included);
  }

  function toggleIncluded() {
    const nextIncluded = !included;
    setIncluded(nextIncluded);
    persistDraft(phone, nextIncluded);
  }

  if (!session || !orgVisit) return null;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to new providers" />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.helper}>Loading provider details…</Text>
          </View>
        ) : null}

        {error ? <Text style={shared.error}>{error}</Text> : null}

        {provider ? (
          <>
            {orgVisit ? (
              <OrgSummaryCard
                organizationName={orgVisit.organization.organizationName}
                organizationAddress={orgVisit.organization.organizationAddress}
              />
            ) : null}

            <Text style={shared.title}>{provider.providerName}</Text>
            <Text style={shared.meta}>NPI {provider.npi}</Text>

            <View style={[shared.card, styles.detailBox]}>
              <Text style={styles.detailLabel}>Primary address</Text>
              <Text style={styles.detailValue}>
                {displayValue(provider.primaryPracticeAddress || provider.providerAddress)}
              </Text>

              <Text style={styles.detailLabel}>Secondary address(es)</Text>
              <Text style={styles.detailValue}>
                {formatSecondaryAddresses(provider.secondaryPracticeAddresses || [])}
              </Text>

              <Text style={styles.detailLabel}>Phone number</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={handlePhoneChange}
                placeholder="e.g. 7273843338"
                keyboardType="phone-pad"
              />

              <Text style={styles.detailLabel}>Taxonomy</Text>
              <View style={styles.taxonomyGrid}>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>Primary Taxonomy</Text>
                  <Text style={styles.taxonomyValue}>{displayValue(provider.primaryTaxonomy)}</Text>
                </View>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>Selected Taxonomy</Text>
                  <Text style={styles.taxonomyValue}>{displayValue(provider.selectedTaxonomy)}</Text>
                </View>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>State</Text>
                  <Text style={styles.taxonomyValue}>{displayValue(provider.taxonomyState)}</Text>
                </View>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>License Number</Text>
                  <Text style={styles.taxonomyValue}>{displayValue(provider.licenseNumber)}</Text>
                </View>
              </View>
            </View>

            <Pressable
              style={[styles.providerCard, included && styles.flyerCardSelected]}
              onPress={toggleIncluded}
            >
              <View style={styles.selectRow}>
                <View style={[styles.checkbox, included && styles.checkboxChecked]}>
                  {included ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </View>
                <Text style={styles.providerName}>
                  {included ? 'Included in save' : 'Include in save'}
                </Text>
              </View>
            </Pressable>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
