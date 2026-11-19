import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import DistributorNav from '../../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../../src/components/ScreenBackButton';
import OrgSummaryCard from '../../../src/features/new-entry/OrgSummaryCard';
import { getNewEntrySession, updateNewEntrySession } from '../../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../../src/features/new-entry/styles';
import type { MatchedFlyer, OrgDetail } from '../../../src/features/new-entry/types';
import { flyerLabel } from '../../../src/features/new-entry/utils';
import { api } from '../../../src/services/api';
import { colors, shared } from '../../../src/styles/distributor';

export default function NewEntryOrgScreen() {
  const { npi } = useLocalSearchParams<{ npi: string }>();
  const session = getNewEntrySession();

  const [organization, setOrganization] = useState<OrgDetail | null>(null);
  const [matchedFlyers, setMatchedFlyers] = useState<MatchedFlyer[]>([]);
  const [selectedFlyer, setSelectedFlyer] = useState<MatchedFlyer | null>(null);
  const [flyerDropped, setFlyerDropped] = useState(false);
  const [photoUri, setPhotoUri] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadOrganization = useCallback(async () => {
    if (!npi || !session) {
      router.replace('/new-entry');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ organization: OrgDetail; matchedFlyers: MatchedFlyer[] }>(
        `/new-entries/orgs/${npi}`,
      );
      setOrganization(res.data.organization);
      setMatchedFlyers(res.data.matchedFlyers || []);
      if (res.data.matchedFlyers?.length === 1) {
        setSelectedFlyer(res.data.matchedFlyers[0]);
      }
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not load organization.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [npi, session]);

  useEffect(() => {
    if (!session) {
      router.replace('/new-entry');
      return;
    }
    loadOrganization();
  }, [loadOrganization, session]);

  function dropFlyer(flyer: MatchedFlyer) {
    setSelectedFlyer(flyer);
    setFlyerDropped(true);
    Alert.alert('Flyer dropped', `${flyerLabel(flyer)} marked as dropped at reception.`);
  }

  async function takePhoto() {
    setError('');
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (cameraPermission.status !== 'granted') {
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (libraryPermission.status !== 'granted') {
          throw new Error('Camera or photo library permission is required.');
        }
      }

      const picked = await ImagePicker.launchCameraAsync({
        quality: 0.72,
        allowsEditing: false,
      }).catch(() =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.72,
        }),
      );

      if (picked.canceled || !picked.assets?.[0]) return;
      setPhotoUri(picked.assets[0].uri);
    } catch (e: any) {
      setError(e?.message || 'Could not open camera.');
    }
  }

  async function continueToProviders() {
    if (!session || !organization) return;
    if (!selectedFlyer || !flyerDropped) {
      Alert.alert('Drop a flyer', 'Select and drop a flyer before continuing.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const res = await api.get<{
        organization: OrgDetail;
        providers: Array<{
          npi: string;
          providerName: string;
          taxonomyDesc: string | null;
          taxonomyCode: string | null;
          phone: string | null;
          providerAddress: string;
          alreadyKnown: boolean;
        }>;
        newCount: number;
        alreadyKnownCount: number;
        summaryHint: string | null;
      }>(`/new-entries/orgs/${npi}/providers-at-address`);

      updateNewEntrySession({
        orgVisit: {
          organization: res.data.organization,
          selectedFlyer,
          flyerDropped,
          photoUri,
          providers: res.data.providers || [],
          newCount: res.data.newCount,
          alreadyKnownCount: res.data.alreadyKnownCount,
          summaryHint: res.data.summaryHint,
          selectedProviderNpis: [],
          providerDrafts: {},
        },
      });

      router.push(`/new-entry/org/${npi}/providers`);
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message || 'Could not load providers.';
      setError(message);
      Alert.alert('Load failed', message);
    } finally {
      setBusy(false);
    }
  }

  const canContinue = Boolean(organization && selectedFlyer && flyerDropped && !busy && !loading);
  const formLocked = busy || loading;

  if (!session) return null;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to nearby orgs" />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.helper}>Loading organization taxonomy and flyers…</Text>
          </View>
        ) : null}

        {error ? <Text style={shared.error}>{error}</Text> : null}

        {organization ? (
          <>
            <OrgSummaryCard
              organizationName={organization.organizationName}
              organizationAddress={organization.organizationAddress}
              meta={`NPI ${organization.npi}`}
            />

            <View style={[shared.card, styles.detailBox]}>
              <Text style={styles.label}>Organization taxonomy</Text>
              <View style={styles.taxonomyGrid}>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>Primary Taxonomy</Text>
                  <Text style={styles.taxonomyValue}>{organization.primaryTaxonomy || '—'}</Text>
                </View>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>Selected Taxonomy</Text>
                  <Text style={styles.taxonomyValue}>{organization.selectedTaxonomy || '—'}</Text>
                </View>
                <View style={styles.taxonomyRow}>
                  <Text style={styles.taxonomyLabel}>State</Text>
                  <Text style={styles.taxonomyValue}>{organization.taxonomyState || '—'}</Text>
                </View>
              </View>

              <Text style={styles.label}>Flyer to drop (reception)</Text>
              {!matchedFlyers.length ? (
                <Text style={styles.hintText}>No active flyers matched this taxonomy.</Text>
              ) : (
                matchedFlyers.map((flyer) => {
                  const selected = selectedFlyer?.campaignId === flyer.campaignId;
                  const dropped = selected && flyerDropped;
                  return (
                    <View
                      key={flyer.campaignId}
                      style={[styles.flyerCard, selected && styles.flyerCardSelected]}
                    >
                      <Text style={styles.flyerTitle}>{flyerLabel(flyer)}</Text>
                      <Text style={styles.providerMeta}>{flyer.matchReason}</Text>
                      {dropped ? (
                        <Text style={styles.droppedBadge}>Dropped</Text>
                      ) : (
                        <Pressable
                          style={styles.dropBtn}
                          onPress={() => dropFlyer(flyer)}
                          disabled={formLocked}
                        >
                          <Text style={styles.dropBtnText}>Drop flyer</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })
              )}

              <Text style={styles.label}>Proof photo (optional)</Text>
              {photoUri ? (
                <View style={styles.photoWrap}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                  <Pressable style={styles.secondaryBtn} onPress={() => setPhotoUri('')} disabled={formLocked}>
                    <Text style={styles.secondaryBtnText}>Remove photo</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.secondaryBtn} onPress={takePhoto} disabled={formLocked}>
                  <Text style={styles.secondaryBtnText}>Take proof photo</Text>
                </Pressable>
              )}
            </View>

            {canContinue ? (
              <Pressable
                style={[shared.primaryButton, busy && styles.disabledButton]}
                onPress={continueToProviders}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.primaryButtonText}>Continue to providers</Text>
                )}
              </Pressable>
            ) : null}
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
