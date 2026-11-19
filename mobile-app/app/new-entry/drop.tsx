import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../src/components/ScreenBackButton';
import {
  ensureVisitBatchId,
  getNewEntrySession,
  initOrgLinksFromOrganizations,
  updatePhysicalDrop,
} from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import {
  DROP_STATUS_OPTIONS,
  STOP_TYPE_OPTIONS,
  type DropStatus,
  type StopType,
} from '../../src/features/new-entry/types';
import {
  countOrgsAtTypedSuite,
  isHighDensityLocation,
} from '../../src/features/new-entry/utils';
import { api } from '../../src/services/api';
import { colors, shared } from '../../src/styles/distributor';

function OptionChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onChange(option.value)}
          >
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type ActiveCampaign = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
};

type FlyerRecommendation = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  confidence: 'strong' | 'medium' | 'weak';
  score: number;
  matchReasons: string[];
  matchSource: 'master_doctor' | 'nucc_map' | 'manual';
};

type ActiveFlyersResponse = {
  activeCampaigns?: ActiveCampaign[];
  recommendations?: FlyerRecommendation[];
  preferManual?: boolean;
};

function campaignLabel(campaign: Pick<ActiveCampaign, 'campaignName' | 'flyerTitle'>) {
  return String(campaign.flyerTitle || campaign.campaignName || '').trim();
}

function confidenceLabel(confidence: FlyerRecommendation['confidence']) {
  if (confidence === 'strong') return 'Strong match';
  if (confidence === 'medium') return 'Possible match';
  return 'Low confidence';
}

export default function NewEntryDropScreen() {
  const [sessionSnapshot, setSessionSnapshot] = useState(getNewEntrySession());
  const [dropStatus, setDropStatus] = useState<DropStatus>('dropped');
  const [stopType, setStopType] = useState<StopType>('unknown');
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [photoUri, setPhotoUri] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingFlyers, setLoadingFlyers] = useState(false);
  const [error, setError] = useState('');
  const [activeCampaigns, setActiveCampaigns] = useState<ActiveCampaign[]>([]);
  const [recommendations, setRecommendations] = useState<FlyerRecommendation[]>([]);
  const [preferManual, setPreferManual] = useState(true);
  const loadKeyRef = useRef('');

  const session = sessionSnapshot;
  const suiteOrgCount = session ? countOrgsAtTypedSuite(session.organizations) : 0;
  const highDensity = isHighDensityLocation(suiteOrgCount);
  const virtualOffice = stopType === 'virtual_mailbox';
  const isDropped = dropStatus === 'dropped';

  const selectedCampaign = activeCampaigns.find((campaign) => campaign.campaignId === selectedCampaignId) || null;
  const selectedLabel = selectedCampaign ? campaignLabel(selectedCampaign) : '';

  function persistDrop(patch: {
    dropStatus?: DropStatus;
    stopType?: StopType;
    campaignId?: number | null;
    flyerTitle?: string | null;
    photoUri?: string;
    notes?: string;
  }) {
    const nextStatus = patch.dropStatus ?? dropStatus;
    const nextCampaignId = patch.campaignId !== undefined ? patch.campaignId : selectedCampaignId;
    const campaign = activeCampaigns.find((item) => item.campaignId === nextCampaignId) || selectedCampaign;
    const nextFlyerTitle = patch.flyerTitle !== undefined
      ? patch.flyerTitle
      : campaign
        ? campaignLabel(campaign)
        : null;

    updatePhysicalDrop({
      dropStatus: nextStatus,
      stopType: patch.stopType ?? stopType,
      campaignId: nextStatus === 'dropped' ? nextCampaignId : null,
      flyerTitle: nextStatus === 'dropped' ? nextFlyerTitle : null,
      flyerQuantity: nextStatus === 'dropped' ? 1 : 0,
      photoUri: patch.photoUri ?? photoUri,
      notes: patch.notes ?? notes,
    });
  }

  function selectCampaign(campaign: ActiveCampaign) {
    setSelectedCampaignId(campaign.campaignId);
    persistDrop({
      campaignId: campaign.campaignId,
      flyerTitle: campaignLabel(campaign),
    });
  }

  useFocusEffect(
    useCallback(() => {
      const current = getNewEntrySession();
      if (!current) {
        router.replace('/new-entry');
        return;
      }

      setSessionSnapshot({ ...current });
      const drop = current.physicalDrop;
      const nextStatus = drop?.dropStatus || 'dropped';
      const nextStopType = drop?.stopType || 'unknown';
      setDropStatus(nextStatus);
      setStopType(nextStopType);
      setPhotoUri(drop?.photoUri || '');
      setNotes(drop?.notes || '');
      if (drop?.campaignId) setSelectedCampaignId(drop.campaignId);

      if (!current.physicalDrop) {
        updatePhysicalDrop({
          dropStatus: 'dropped',
          stopType: 'unknown',
          campaignId: null,
          flyerTitle: null,
          flyerQuantity: 1,
          photoUri: '',
          notes: '',
          droppedAt: null,
        });
      }
      if (!current.orgLinks?.length) {
        initOrgLinksFromOrganizations(
          current.organizations,
          isHighDensityLocation(countOrgsAtTypedSuite(current.organizations)),
        );
      }
      ensureVisitBatchId();

      const loadKey = `${current.visitBatchId || ''}|${current.locationAddress}|${nextStopType}`;
      if (loadKeyRef.current === loadKey && activeCampaigns.length) {
        return;
      }
      loadKeyRef.current = loadKey;

      const taxonomyCodes = [
        ...new Set(current.organizations.map((org) => org.taxonomyCode || '').filter(Boolean)),
      ];
      const taxonomyDescs = current.organizations
        .filter((org) => org.taxonomyCode || org.taxonomyDesc)
        .map((org) => org.taxonomyDesc || '');
      const knownProviderNpis = (current.providerSelections || [])
        .filter((provider) => provider.alreadyKnown)
        .map((provider) => provider.npi);

      setLoadingFlyers(true);
      setError('');
      api
        .get<ActiveFlyersResponse>('/new-entries/active-flyers', {
          params: {
            taxonomyCodes: taxonomyCodes.join(','),
            taxonomyDescs: taxonomyDescs.join('|'),
            providerNpis: knownProviderNpis.join(','),
            highDensity: highDensity ? 'true' : 'false',
            virtualOffice: nextStopType === 'virtual_mailbox' ? 'true' : 'false',
          },
        })
        .then((res) => {
          const campaigns = res.data.activeCampaigns || [];
          setActiveCampaigns(campaigns);
          setRecommendations(res.data.recommendations || []);
          setPreferManual(Boolean(res.data.preferManual || highDensity || nextStopType === 'virtual_mailbox'));

          if (drop?.campaignId && campaigns.some((item) => item.campaignId === drop.campaignId)) {
            setSelectedCampaignId(drop.campaignId);
            return;
          }

          if (drop?.campaignId) {
            setSelectedCampaignId(drop.campaignId);
          }
        })
        .catch(() => {
          loadKeyRef.current = '';
          setActiveCampaigns([]);
          setRecommendations([]);
          setPreferManual(true);
        })
        .finally(() => setLoadingFlyers(false));
    }, []),
  );

  function handleDropStatusChange(value: DropStatus) {
    setDropStatus(value);
    persistDrop({
      dropStatus: value,
      campaignId: value === 'dropped' ? selectedCampaignId : null,
      flyerTitle: value === 'dropped' && selectedCampaign ? campaignLabel(selectedCampaign) : null,
    });
  }

  function handleStopTypeChange(value: StopType) {
    setStopType(value);
    if (value === 'virtual_mailbox') {
      setPreferManual(true);
    }
    persistDrop({ stopType: value });
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
      const uri = picked.assets[0].uri;
      setPhotoUri(uri);
      persistDrop({ photoUri: uri });
    } catch (e: any) {
      setError(e?.message || 'Could not open camera.');
    }
  }

  function continueToSummary() {
    if (!session) return;
    if (isDropped && !selectedCampaignId) {
      Alert.alert('Select a flyer', 'Choose which campaign flyer was dropped at this stop.');
      return;
    }

    const campaign = activeCampaigns.find((item) => item.campaignId === selectedCampaignId);
    updatePhysicalDrop({
      dropStatus,
      stopType,
      campaignId: isDropped ? selectedCampaignId : null,
      flyerTitle: isDropped && campaign ? campaignLabel(campaign) : null,
      flyerQuantity: isDropped ? 1 : 0,
      photoUri,
      notes,
      droppedAt: new Date().toISOString(),
    });
    router.push('/new-entry/npi-summary');
  }

  if (!session) return null;

  const { locationAddress, practiceName } = session;
  const suiteLabel = session.organizations.find((org) => org.suiteLabel)?.suiteLabel || null;
  const showPracticeName = Boolean(practiceName?.trim());

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to Add New" />

        <Text style={shared.title}>Physical drop</Text>

        <View style={styles.card}>
          <Text style={styles.locationLabel}>Address</Text>
          <Text style={styles.locationText}>{locationAddress}</Text>
          {suiteLabel ? (
            <>
              <Text style={styles.locationLabel}>Suite</Text>
              <Text style={styles.locationText}>{suiteLabel}</Text>
            </>
          ) : null}
          {showPracticeName ? (
            <>
              <Text style={styles.locationLabel}>Practice name</Text>
              <Text style={styles.locationText}>{practiceName.trim()}</Text>
            </>
          ) : null}
          {highDensity || virtualOffice ? (
            <Text style={styles.warningText}>
              {highDensity ? 'High NPI density detected. ' : ''}
              {virtualOffice ? 'Virtual/mailbox stop. ' : ''}
              Select the flyer manually.
            </Text>
          ) : null}
        </View>

        {error ? <Text style={shared.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.label}>Drop status</Text>
          <OptionChips options={DROP_STATUS_OPTIONS} value={dropStatus} onChange={handleDropStatusChange} />

          <Text style={styles.label}>Stop type</Text>
          <OptionChips options={STOP_TYPE_OPTIONS} value={stopType} onChange={handleStopTypeChange} />

          {isDropped ? (
            <>
              <Text style={styles.label}>Campaign flyer</Text>
              <Text style={styles.helper}>
                Select the flyer dropped at this stop. Recommendations are optional hints only.
              </Text>

              {loadingFlyers ? (
                <ActivityIndicator color={colors.primary} />
              ) : !activeCampaigns.length ? (
                <Text style={styles.hintText}>No active campaigns available. You can still continue without a flyer selection if drop status is not Dropped.</Text>
              ) : (
                <>
                  {selectedLabel ? (
                    <Text style={styles.locationText}>Selected: {selectedLabel}</Text>
                  ) : (
                    <Text style={styles.hintText}>No flyer selected yet.</Text>
                  )}

                  {!preferManual && recommendations.length ? (
                    <>
                      <Text style={[styles.label, { marginTop: 12 }]}>Suggested matches</Text>
                      {recommendations.slice(0, 5).map((item) => {
                        const label = campaignLabel(item);
                        const selected = selectedCampaignId === item.campaignId;
                        return (
                          <Pressable
                            key={`rec-${item.campaignId}`}
                            style={[styles.orgCard, selected && styles.flyerCardSelected]}
                            onPress={() => selectCampaign(item)}
                          >
                            <Text style={styles.providerName}>{label}</Text>
                            <Text style={styles.providerMeta}>
                              {confidenceLabel(item.confidence)} · {item.matchReasons.join('; ')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </>
                  ) : recommendations.length ? (
                    <Text style={styles.hintText}>
                      Suggestions available but manual selection is preferred at this address.
                    </Text>
                  ) : null}

                  <Text style={[styles.label, { marginTop: 12 }]}>All active campaigns</Text>
                  {activeCampaigns.map((campaign) => {
                    const label = campaignLabel(campaign);
                    const selected = selectedCampaignId === campaign.campaignId;
                    return (
                      <Pressable
                        key={campaign.campaignId}
                        style={[styles.orgCard, selected && styles.flyerCardSelected]}
                        onPress={() => selectCampaign(campaign)}
                      >
                        <Text style={styles.providerName}>{label}</Text>
                        {campaign.flyerTitle && campaign.campaignName !== campaign.flyerTitle ? (
                          <Text style={styles.providerMeta}>{campaign.campaignName}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </>
              )}
            </>
          ) : null}

          <Text style={styles.label}>Proof photo (optional)</Text>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  setPhotoUri('');
                  persistDrop({ photoUri: '' });
                }}
              >
                <Text style={styles.secondaryBtnText}>Remove photo</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.secondaryBtn} onPress={takePhoto}>
              <Text style={styles.secondaryBtnText}>Take photo</Text>
            </Pressable>
          )}

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder='e.g. "Left one packet at front desk"'
            value={notes}
            onChangeText={(value) => {
              setNotes(value);
              persistDrop({ notes: value });
            }}
            multiline
          />
        </View>

        <Pressable style={shared.primaryButton} onPress={continueToSummary}>
          <Text style={shared.primaryButtonText}>Save drop & continue</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
