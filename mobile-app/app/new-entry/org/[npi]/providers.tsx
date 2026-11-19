import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import DistributorNav from '../../../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../../../src/components/ScreenBackButton';
import OrgSummaryCard from '../../../../src/features/new-entry/OrgSummaryCard';
import {
  clearNewEntrySession,
  getNewEntrySession,
  setProviderDraft,
  setProviderSelected,
} from '../../../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../../../src/features/new-entry/styles';
import type { OrgProviderDraft } from '../../../../src/features/new-entry/types';
import { flyerLabel, getCurrentLocation } from '../../../../src/features/new-entry/utils';
import { api } from '../../../../src/services/api';
import { colors, shared } from '../../../../src/styles/distributor';

export default function NewEntryOrgProvidersScreen() {
  const { npi } = useLocalSearchParams<{ npi: string }>();
  const session = getNewEntrySession();
  const orgVisit = session?.orgVisit;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedNpis, setSelectedNpis] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      const current = getNewEntrySession();
      if (!current?.orgVisit || current.orgVisit.organization.npi !== npi) {
        router.replace('/new-entry');
        return;
      }
      setSelectedNpis(new Set(current.orgVisit.selectedProviderNpis || []));
    }, [npi]),
  );

  const newProviders = (orgVisit?.providers || []).filter((provider) => !provider.alreadyKnown);

  function toggleProvider(providerNpi: string) {
    const current = getNewEntrySession();
    const visit = current?.orgVisit;
    if (!current || !visit) return;
    const provider = newProviders.find((entry) => entry.npi === providerNpi);
    if (!provider) return;

    const nextSelected = !selectedNpis.has(providerNpi);
    if (nextSelected && !visit.providerDrafts?.[providerNpi]) {
      setProviderDraft(providerNpi, {
        npi: provider.npi,
        providerName: provider.providerName,
        providerAddress: provider.providerAddress,
        primaryPracticeAddress: provider.providerAddress,
        secondaryPracticeAddresses: [],
        phone: provider.phone || '',
        taxonomyCode: provider.taxonomyCode,
        taxonomyDesc: provider.taxonomyDesc,
        primaryTaxonomy: null,
        selectedTaxonomy: null,
        taxonomyState: null,
        licenseNumber: null,
        practiceName: current.practiceName.trim() || visit.organization.organizationName,
      });
    }
    setProviderSelected(providerNpi, nextSelected);
    setSelectedNpis((prev) => {
      const next = new Set(prev);
      if (nextSelected) next.add(providerNpi);
      else next.delete(providerNpi);
      return next;
    });
  }

  async function saveVisit() {
    if (!session || !orgVisit) return;

    const organization = orgVisit.organization;
    const flyer = orgVisit.selectedFlyer;
    if (!flyer || !orgVisit.flyerDropped) {
      Alert.alert('Missing flyer', 'Go back and drop a flyer first.');
      return;
    }

    const drafts = orgVisit.providerDrafts || {};
    const selectedProviders = (orgVisit.selectedProviderNpis || [])
      .map((providerNpi) => drafts[providerNpi])
      .filter((draft): draft is OrgProviderDraft => Boolean(draft));

    setBusy(true);
    setError('');

    try {
      const savedCoords = session.coords ?? (await getCurrentLocation());
      const payload = new FormData();

      payload.append('practiceName', session.practiceName.trim() || organization.organizationName);
      payload.append('locationAddress', session.locationAddress.trim() || organization.organizationAddress);
      payload.append('organizationNpi', organization.npi);
      payload.append('organizationName', organization.organizationName);
      payload.append('organizationAddress', organization.organizationAddress);
      payload.append('phone', organization.phone || '');
      payload.append('taxonomyCode', organization.taxonomyCode || '');
      payload.append('taxonomyDesc', organization.taxonomyDesc || '');
      payload.append('primaryTaxonomy', organization.primaryTaxonomy || '');
      payload.append('selectedTaxonomy', organization.selectedTaxonomy || '');
      payload.append('taxonomyState', organization.taxonomyState || '');
      payload.append('licenseNumber', organization.licenseNumber || '');
      payload.append('campaignId', String(flyer.campaignId));
      payload.append('flyerTitle', flyerLabel(flyer));
      payload.append('flyerDropped', 'true');
      payload.append('latitude', String(savedCoords.latitude));
      payload.append('longitude', String(savedCoords.longitude));
      payload.append(
        'providersJson',
        JSON.stringify(
          selectedProviders.map((provider) => ({
            npi: provider.npi,
            providerName: provider.providerName,
            providerAddress: provider.primaryPracticeAddress || provider.providerAddress,
            phone: provider.phone.replace(/\D/g, '') || '',
            taxonomyCode: provider.taxonomyCode || '',
            taxonomyDesc: provider.taxonomyDesc || '',
            primaryTaxonomy: provider.primaryTaxonomy || '',
            selectedTaxonomy: provider.selectedTaxonomy || '',
            taxonomyState: provider.taxonomyState || '',
            licenseNumber: provider.licenseNumber || '',
          })),
        ),
      );

      if (orgVisit.photoUri) {
        payload.append('photo', {
          uri: orgVisit.photoUri,
          name: `org-visit-${Date.now()}.jpg`,
          type: 'image/jpeg',
        } as any);
      }

      const res = await api.post('/new-entries/visit', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      clearNewEntrySession();
      Alert.alert('Saved', res.data.message || 'Visit saved.', [
        { text: 'OK', onPress: () => router.replace('/new-entry') },
      ]);
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not save visit.';
      setError(message);
      Alert.alert('Save failed', message);
    } finally {
      setBusy(false);
    }
  }

  if (!session || !orgVisit) return null;

  const { newCount, alreadyKnownCount, summaryHint } = orgVisit;
  const selectedCount = selectedNpis.size;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to organization" />

        <OrgSummaryCard
          variant="header"
          organizationName={orgVisit.organization.organizationName}
          organizationAddress={orgVisit.organization.organizationAddress}
          meta={`NPI ${orgVisit.organization.npi}`}
        />

        <Text style={shared.meta}>
          {newCount} new{alreadyKnownCount > 0 ? ` · ${alreadyKnownCount} already in database (hidden)` : ''}
        </Text>
        {summaryHint ? <Text style={styles.hintText}>{summaryHint}</Text> : null}

        {error ? <Text style={shared.error}>{error}</Text> : null}

        <View style={{ width: '100%' }}>
          {!newProviders.length ? (
            <Text style={styles.hintText}>No new individual providers at this organization address.</Text>
          ) : (
            newProviders.map((provider) => {
              const checked = selectedNpis.has(provider.npi);
              return (
                <View key={provider.npi} style={[styles.providerCard, checked && styles.flyerCardSelected]}>
                  <Pressable
                    style={styles.checkbox}
                    onPress={() => toggleProvider(provider.npi)}
                    disabled={busy}
                  >
                    {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </Pressable>

                  <Pressable
                    style={styles.selectBody}
                    onPress={() => router.push(`/new-entry/org/${npi}/provider/${provider.npi}`)}
                    disabled={busy}
                  >
                    <Text style={styles.providerName}>{provider.providerName}</Text>
                    <Text style={styles.providerMeta}>NPI {provider.npi}</Text>
                    {provider.taxonomyDesc ? (
                      <Text style={styles.providerMeta}>{provider.taxonomyDesc}</Text>
                    ) : null}
                    <Text style={styles.openHint}>Tap for details →</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        <Pressable
          style={[shared.primaryButton, busy && styles.disabledButton]}
          onPress={saveVisit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={shared.primaryButtonText}>
              {selectedCount
                ? `Save visit + ${selectedCount} provider${selectedCount === 1 ? '' : 's'}`
                : 'Save visit (no providers selected)'}
            </Text>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
