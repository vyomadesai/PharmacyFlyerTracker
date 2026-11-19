import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseTypedAddress } from '../new-entry/utils';
import {
  addDiscoverProvider,
  getStopSelections,
  removeDiscoverProvider,
  seedDiscoverFromStop,
  updateDiscoverProvider,
} from './session';

const colors = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  discovery: '#7c3aed',
  discoveryBg: '#f5f3ff',
};

type StopAddressDefaults = {
  locationAddress: string;
  addressParts?: ReturnType<typeof parseTypedAddress>;
  latitude?: number | null;
  longitude?: number | null;
  practiceName?: string;
};

type Props = {
  routePlanStopId: number;
  checkedIn: boolean;
  stopDefaults: StopAddressDefaults;
  refreshKey?: number;
  onSelectionsChange?: () => void;
  listMaxHeight?: number;
};

export default function DiscoverTabPanel({
  routePlanStopId,
  checkedIn,
  stopDefaults,
  refreshKey,
  onSelectionsChange,
  listMaxHeight = 280,
}: Props) {
  const draft = getStopSelections(routePlanStopId).discover;
  void refreshKey;

  useEffect(() => {
    seedDiscoverFromStop(routePlanStopId, stopDefaults);
    const current = getStopSelections(routePlanStopId).discover;
    if (!current.providers.length) {
      addDiscoverProvider(routePlanStopId);
      onSelectionsChange?.();
    }
  }, [routePlanStopId, stopDefaults.locationAddress]);

  if (!checkedIn) {
    return (
      <Text style={styles.pending}>Check in at this stop to add who works here.</Text>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.providersHeader}>
        <View>
          <Text style={styles.sectionTitle}>Who works here</Text>
          <Text style={styles.cardHint}>First name, last name, specialty. The stop address is already saved with the name.</Text>
        </View>
        <Pressable
          style={styles.addProviderBtn}
          onPress={() => {
            addDiscoverProvider(routePlanStopId);
            onSelectionsChange?.();
          }}
        >
          <Ionicons name="add" size={14} color={colors.discovery} />
          <Text style={styles.addProviderText}>Add</Text>
        </Pressable>
      </View>

      {!draft.providers.length ? (
        <Text style={styles.empty}>Add at least one person with first name, last name, and specialty.</Text>
      ) : (
        <ScrollView
          style={[styles.providerListScroll, { maxHeight: listMaxHeight }]}
          contentContainerStyle={styles.providerListContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          persistentScrollbar
          keyboardShouldPersistTaps="handled"
        >
          {draft.providers.map((provider, index) => (
            <View key={provider.id} style={styles.providerCard}>
              <View style={styles.providerCardHeader}>
                <Text style={styles.providerIndex}>Person #{index + 1}</Text>
                {draft.providers.length > 1 ? (
                  <Pressable
                    onPress={() => {
                      removeDiscoverProvider(routePlanStopId, provider.id);
                      onSelectionsChange?.();
                    }}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.nameRow}>
                <View style={styles.nameField}>
                  <Text style={styles.fieldLabel}>First name</Text>
                  <TextInput
                    value={provider.firstName}
                    onChangeText={(value) => {
                      updateDiscoverProvider(routePlanStopId, provider.id, { firstName: value });
                      onSelectionsChange?.();
                    }}
                    style={styles.input}
                    placeholder="First"
                    placeholderTextColor={colors.muted}
                  />
                </View>
                <View style={styles.nameField}>
                  <Text style={styles.fieldLabel}>Last name</Text>
                  <TextInput
                    value={provider.lastName}
                    onChangeText={(value) => {
                      updateDiscoverProvider(routePlanStopId, provider.id, { lastName: value });
                      onSelectionsChange?.();
                    }}
                    style={styles.input}
                    placeholder="Last"
                    placeholderTextColor={colors.muted}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Specialty</Text>
              <TextInput
                value={provider.specialty}
                onChangeText={(value) => {
                  updateDiscoverProvider(routePlanStopId, provider.id, { specialty: value });
                  onSelectionsChange?.();
                }}
                style={styles.input}
                placeholder="e.g. Family Medicine"
                placeholderTextColor={colors.muted}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, gap: 10 },
  cardHint: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 16 },
  pending: { color: colors.muted, fontSize: 13, marginTop: 14, fontWeight: '600' },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#fff',
  },
  providersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  addProviderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    backgroundColor: colors.discoveryBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addProviderText: { color: colors.discovery, fontWeight: '800', fontSize: 13 },
  nameRow: { flexDirection: 'row', gap: 8 },
  nameField: { flex: 1 },
  empty: { color: colors.muted, fontSize: 13, marginTop: 10, fontWeight: '600' },
  providerListScroll: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  providerListContent: {
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  providerCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fafbfc',
  },
  providerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerIndex: { color: colors.text, fontSize: 13, fontWeight: '800' },
  removeText: { color: '#b91c1c', fontSize: 13, fontWeight: '800' },
});
