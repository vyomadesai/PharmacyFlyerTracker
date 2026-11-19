import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../src/components/ScreenBackButton';
import ListPagination, { paginateList } from '../../src/features/new-entry/ListPagination';
import {
  clearNewEntrySession,
  ensureVisitBatchId,
  getNewEntrySession,
} from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import {
  dropStatusLabel,
  flyerLabel,
  getCurrentLocation,
  orgVerificationLabel,
  stopTypeLabel,
} from '../../src/features/new-entry/utils';
import { api } from '../../src/services/api';
import { shared } from '../../src/styles/distributor';

function ReviewRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewKey}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

export default function NewEntryReviewScreen() {
  const session = getNewEntrySession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [orgPage, setOrgPage] = useState(1);
  const [providerPage, setProviderPage] = useState(1);

  useFocusEffect(
    useCallback(() => {
      if (!getNewEntrySession()?.physicalDrop) {
        router.replace('/new-entry');
      }
    }, []),
  );

  const orgLinks = session?.orgLinks || [];
  const linkedOrgRows = useMemo(
    () => orgLinks.filter((org) => org.verificationStatus !== 'npi_only'),
    [orgLinks],
  );
  const providers = session?.providerSelections || [];
  const selectedProviders = useMemo(
    () => providers.filter((provider) => provider.selectedForReview),
    [providers],
  );

  const orgPagination = useMemo(() => paginateList(linkedOrgRows, orgPage), [linkedOrgRows, orgPage]);
  const providerPagination = useMemo(
    () => paginateList(selectedProviders, providerPage),
    [selectedProviders, providerPage],
  );

  useEffect(() => {
    if (orgPage !== orgPagination.safePage) {
      setOrgPage(orgPagination.safePage);
    }
  }, [orgPage, orgPagination.safePage]);

  useEffect(() => {
    if (providerPage !== providerPagination.safePage) {
      setProviderPage(providerPagination.safePage);
    }
  }, [providerPage, providerPagination.safePage]);

  async function submitVisit() {
    if (!session?.physicalDrop) return;

    setBusy(true);
    setError('');

    try {
      const savedCoords = session.coords ?? (await getCurrentLocation());
      const visitBatchId = ensureVisitBatchId();
      const parts = session.addressParts;
      const drop = session.physicalDrop;
      const linkedOrgRows = (session.orgLinks || []).filter((org) => org.verificationStatus !== 'npi_only');
      const providers = (session.providerSelections || []).filter((provider) => provider.selectedForReview);
      const selectedFlyer = drop.campaignId
        ? {
            campaignId: drop.campaignId,
            campaignName: drop.flyerTitle || '',
            flyerTitle: drop.flyerTitle,
            matchReason: '',
          }
        : null;

      const payload = new FormData();
      payload.append('practiceName', session.practiceName.trim() || session.locationAddress.trim() || 'Unknown practice');
      payload.append('locationAddress', session.locationAddress.trim());
      payload.append('street', parts?.street || '');
      payload.append('city', parts?.city || '');
      payload.append('state', parts?.state || 'FL');
      payload.append('postalCode', parts?.postalCode || '');
      payload.append('latitude', String(savedCoords.latitude));
      payload.append('longitude', String(savedCoords.longitude));
      if (visitBatchId) payload.append('visitBatchId', visitBatchId);

      payload.append(
        'physicalDropJson',
        JSON.stringify({
          dropStatus: drop.dropStatus,
          stopType: drop.stopType,
          campaignId: drop.campaignId,
          flyerTitle: selectedFlyer ? flyerLabel(selectedFlyer) : drop.flyerTitle,
          flyerQuantity: drop.dropStatus === 'dropped' ? Math.max(1, drop.flyerQuantity || 1) : 0,
          notes: drop.notes || '',
          droppedAt: drop.droppedAt || new Date().toISOString(),
        }),
      );

      payload.append(
        'orgLinksJson',
        JSON.stringify(
          linkedOrgRows.map((org) => ({
            organizationNpi: org.organizationNpi,
            organizationName: org.organizationName,
            organizationAddress: org.organizationAddress,
            taxonomyCode: org.taxonomyCode || '',
            taxonomyDescription: org.taxonomyDescription || '',
            distanceMiles: org.distanceMiles,
            suiteLabel: org.suiteLabel || '',
            verificationStatus: org.verificationStatus,
            flyerAttributed: org.flyerAttributed || false,
          })),
        ),
      );

      payload.append(
        'providersJson',
        JSON.stringify(
          providers.map((provider) => ({
            npi: provider.npi,
            providerName: provider.providerName,
            providerAddress: provider.providerAddress,
            phone: provider.phone.replace(/\D/g, '') || '',
            taxonomyCode: provider.taxonomyCode || '',
            taxonomyDesc: provider.taxonomyDescription || '',
            verificationStatus: provider.verificationStatus,
            selectedForReview: true,
          })),
        ),
      );

      if (drop.photoUri) {
        payload.append('photo', {
          uri: drop.photoUri,
          name: `physical-stop-${Date.now()}.jpg`,
          type: 'image/jpeg',
        } as any);
      }

      const res = await api.post('/new-entries/physical-visit', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      clearNewEntrySession();
      Alert.alert('Submitted', res.data.message || 'Visit submitted for admin review.', [
        { text: 'OK', onPress: () => router.replace('/new-entry') },
      ]);
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not submit visit.';
      setError(message);
      Alert.alert('Submit failed', message);
    } finally {
      setBusy(false);
    }
  }

  if (!session?.physicalDrop) return null;

  const drop = session.physicalDrop;
  const confirmedOrgs = orgLinks.filter((org) => org.verificationStatus === 'confirmed_on_site').length;
  const npiOnlyOrgs = orgLinks.filter((org) => org.verificationStatus === 'npi_only').length;
  const virtualOrgs = orgLinks.filter((org) => org.verificationStatus === 'virtual_mail_only').length;
  const prescriberSelected = selectedProviders.filter((provider) => provider.isPrescriber).length;
  const nonPrescriberSelected = selectedProviders.length - prescriberSelected;
  const physicalFlyerDrops = drop.dropStatus === 'dropped' ? 1 : 0;
  const suiteLabel = orgLinks.find((org) => org.suiteLabel)?.suiteLabel || session.npiSummary?.suiteLabel || '—';

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back" />

        <Text style={shared.title}>Review & submit</Text>
        <Text style={shared.subtitle}>
          Flyer count is based on the physical drop only. Organizations and providers are data links/candidates.
        </Text>

        {error ? <Text style={shared.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.stepTitle}>Physical stop</Text>
          <ReviewRow label="Address" value={session.locationAddress} />
          <ReviewRow label="Suite" value={suiteLabel} />
          <ReviewRow
            label="GPS"
            value={session.coords ? `${session.coords.latitude.toFixed(5)}, ${session.coords.longitude.toFixed(5)}` : '—'}
          />
          <ReviewRow label="Stop type" value={stopTypeLabel(drop.stopType)} />
          <ReviewRow label="Drop status" value={dropStatusLabel(drop.dropStatus)} />
          <ReviewRow label="Drop name" value={drop.flyerTitle || '—'} />
          <ReviewRow label="Notes" value={drop.notes || '—'} />
          {drop.photoUri ? <Image source={{ uri: drop.photoUri }} style={styles.photoPreview} /> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.stepTitle}>NPI organizations</Text>
          <ReviewRow label="Total orgs found" value={session.organizations.length} />
          <ReviewRow label="Org links to save" value={linkedOrgRows.length} />
          <ReviewRow label="Confirmed orgs" value={confirmedOrgs} />
          <ReviewRow label="NPI-only orgs" value={npiOnlyOrgs} />
          <ReviewRow label="Virtual/mail-only orgs" value={virtualOrgs} />

          {linkedOrgRows.length ? (
            <>
              <Text style={styles.label}>Org links to save</Text>
              <ListPagination
                page={orgPagination.safePage}
                totalPages={orgPagination.totalPages}
                totalItems={orgPagination.totalItems}
                showingFrom={orgPagination.showingFrom}
                showingTo={orgPagination.showingTo}
                onPageChange={setOrgPage}
              />
              {orgPagination.pageItems.map((org) => (
                <View key={org.organizationNpi} style={styles.reviewListItem}>
                  <Text style={styles.providerName}>{org.organizationName}</Text>
                  <Text style={styles.providerMeta}>
                    NPI {org.organizationNpi}
                    {org.suiteLabel ? ` · ${org.suiteLabel}` : ''}
                    {` · ${orgVerificationLabel(org.verificationStatus)}`}
                  </Text>
                </View>
              ))}
              <ListPagination
                page={orgPagination.safePage}
                totalPages={orgPagination.totalPages}
                totalItems={orgPagination.totalItems}
                showingFrom={orgPagination.showingFrom}
                showingTo={orgPagination.showingTo}
                onPageChange={setOrgPage}
              />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.stepTitle}>Providers</Text>
          <ReviewRow label="New candidates selected" value={selectedProviders.length} />
          <ReviewRow label="Already known excluded" value={providers.filter((p) => p.alreadyKnown).length} />
          <ReviewRow label="Prescriber count selected" value={prescriberSelected} />
          <ReviewRow label="Non-prescriber count selected" value={nonPrescriberSelected} />

          {selectedProviders.length ? (
            <>
              <Text style={styles.label}>Selected provider candidates</Text>
              <ListPagination
                page={providerPagination.safePage}
                totalPages={providerPagination.totalPages}
                totalItems={providerPagination.totalItems}
                showingFrom={providerPagination.showingFrom}
                showingTo={providerPagination.showingTo}
                onPageChange={setProviderPage}
              />
              {providerPagination.pageItems.map((provider) => (
                <View key={provider.npi} style={styles.reviewListItem}>
                  <Text style={styles.providerName}>{provider.providerName}</Text>
                  <Text style={styles.providerMeta}>
                    NPI {provider.npi}
                    {provider.taxonomyDescription ? ` · ${provider.taxonomyDescription}` : ''}
                    {provider.isPrescriber ? ' · Prescriber' : ''}
                  </Text>
                </View>
              ))}
              <ListPagination
                page={providerPagination.safePage}
                totalPages={providerPagination.totalPages}
                totalItems={providerPagination.totalItems}
                showingFrom={providerPagination.showingFrom}
                showingTo={providerPagination.showingTo}
                onPageChange={setProviderPage}
              />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.stepTitle}>Summary counts</Text>
          <ReviewRow label="Physical flyer drops" value={physicalFlyerDrops} />
          <ReviewRow label="NPI organizations" value={orgLinks.length} />
          <ReviewRow label="NPI providers" value={providers.length} />
          <ReviewRow label="Provider candidates selected" value={selectedProviders.length} />
        </View>

        <Pressable
          style={[shared.primaryButton, busy && styles.disabledButton]}
          onPress={submitVisit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={shared.primaryButtonText}>Submit for admin review</Text>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
