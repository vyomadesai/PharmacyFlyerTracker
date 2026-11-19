import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { OrgSelection, ProviderSelection } from './types';
import {
  ORG_STATUS_OPTIONS,
  STATUS_COLORS,
  orgStatusLabel,
  providerKindLabel,
  samePhone,
  sameStreet,
} from './labels';
import { updateOrgSelection, updateProviderSelection } from './session';

type TypeFilter = 'all' | 'orgs' | 'providers';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  routePlanStopId: number;
  checkedIn: boolean;
  stopPhone?: string | null;
  stopStreet?: string | null;
  orgs: OrgSelection[];
  providers: ProviderSelection[];
  onChange: () => void;
};

const c = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#3f5b76',
  card: '#ffffff',
};

export default function CandidateReviewSheet({
  visible,
  onClose,
  title,
  subtitle,
  routePlanStopId,
  checkedIn,
  stopPhone,
  stopStreet,
  orgs,
  providers,
  onChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [samePhoneOnly, setSamePhoneOnly] = useState(false);
  const [sameAddressOnly, setSameAddressOnly] = useState(false);

  const hasOrgs = orgs.length > 0;
  const hasProviders = providers.length > 0;

  const q = query.trim().toLowerCase();

  const visibleOrgs = useMemo(() => {
    if (typeFilter === 'providers') return [];
    return orgs.filter((org) => {
      if (q && ![org.organizationName, org.taxonomyDescription, org.organizationNpi, org.organizationAddress]
        .some((v) => (v || '').toLowerCase().includes(q))) return false;
      if (samePhoneOnly) return false; // orgs have no phone in selection payload
      if (sameAddressOnly && !sameStreet(org.organizationAddress, stopStreet)) return false;
      return true;
    });
  }, [orgs, q, typeFilter, samePhoneOnly, sameAddressOnly, stopStreet]);

  const visibleProviders = useMemo(() => {
    if (typeFilter === 'orgs') return [];
    return providers.filter((p) => {
      if (q && ![p.providerName, p.taxonomyDescription, p.npi, p.providerAddress]
        .some((v) => (v || '').toLowerCase().includes(q))) return false;
      if (samePhoneOnly && !samePhone(p.phone, stopPhone)) return false;
      if (sameAddressOnly && !sameStreet(p.providerAddress, stopStreet)) return false;
      return true;
    });
  }, [providers, q, typeFilter, samePhoneOnly, sameAddressOnly, stopPhone, stopStreet]);

  function matchReason(providerAddress: string, phone: string | null, alreadyKnown: boolean, provided?: string): string {
    if (provided) return provided;
    if (samePhone(phone, stopPhone)) return 'Same phone';
    if (sameStreet(providerAddress, stopStreet)) return 'Same address';
    if (alreadyKnown) return 'Already in system, not mapped';
    return 'Nearby NPI result';
  }

  function setProvider(npi: string, patch: Partial<ProviderSelection>) {
    updateProviderSelection(routePlanStopId, npi, patch);
    onChange();
  }

  function setOrg(npi: string, patch: Partial<OrgSelection>) {
    updateOrgSelection(routePlanStopId, npi, patch);
    onChange();
  }

  function addAllVisibleToReview() {
    visibleProviders.forEach((p) => {
      if (!p.selectedForReview) {
        updateProviderSelection(routePlanStopId, p.npi, {
          selectedForReview: true,
          verificationStatus: 'selected_for_review',
        });
      }
    });
    onChange();
  }

  const selectedCount = providers.filter((p) => p.selectedForReview).length;
  const totalVisible = visibleOrgs.length + visibleProviders.length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.backdropTap} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}>
              <Text style={s.closeText}>Done</Text>
            </Pressable>
          </View>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, specialty, NPI, address"
            placeholderTextColor={c.muted}
            style={s.search}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
            {hasOrgs && hasProviders ? (
              <>
                <FilterChip label="All" active={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
                <FilterChip label="Organizations" active={typeFilter === 'orgs'} onPress={() => setTypeFilter('orgs')} />
                <FilterChip label="Providers" active={typeFilter === 'providers'} onPress={() => setTypeFilter('providers')} />
              </>
            ) : null}
            <FilterChip label="Same phone" active={samePhoneOnly} onPress={() => setSamePhoneOnly((v) => !v)} />
            <FilterChip label="Same address" active={sameAddressOnly} onPress={() => setSameAddressOnly((v) => !v)} />
          </ScrollView>

          <View style={s.bulkRow}>
            <Text style={s.bulkMeta}>
              {totalVisible} shown · {selectedCount} added for review
            </Text>
            {visibleProviders.length ? (
              <Pressable
                style={[s.bulkBtn, !checkedIn && s.disabled]}
                disabled={!checkedIn}
                onPress={addAllVisibleToReview}
              >
                <Text style={s.bulkBtnText}>Add all visible to review</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {!checkedIn ? (
              <Text style={s.lockHint}>Check in at this stop to review and save updates.</Text>
            ) : null}

            {visibleProviders.map((p) => {
              const reason = matchReason(p.providerAddress, p.phone, p.alreadyKnown, p.matchReason);
              return (
                <View key={`p-${p.npi}`} style={s.row}>
                  <View style={s.rowHeader}>
                    <Text style={s.rowName}>{p.providerName || 'Provider'}</Text>
                    <Badge label={providerKindLabel(p.alreadyKnown)} tone={p.alreadyKnown ? 'needsMapping' : 'newProvider'} />
                  </View>
                  <Text style={s.rowMeta}>
                    {p.taxonomyDescription || 'Provider'} · NPI {p.npi}
                    {p.isPrescriber ? ' · Prescriber' : ''}
                  </Text>
                  {p.providerAddress ? <Text style={s.rowMeta}>{p.providerAddress}</Text> : null}
                  <Text style={s.reason}>Match: {reason}</Text>
                  <View style={s.actionRow}>
                    <ActionChip
                      label={p.selectedForReview && p.verificationStatus === 'selected_for_review' ? 'Added for review ✓' : 'Add to review'}
                      active={p.selectedForReview && p.verificationStatus === 'selected_for_review'}
                      tone="newProvider"
                      disabled={!checkedIn}
                      onPress={() => {
                        const on = p.selectedForReview && p.verificationStatus === 'selected_for_review';
                        setProvider(p.npi, {
                          selectedForReview: !on,
                          verificationStatus: !on ? 'selected_for_review' : (p.alreadyKnown ? 'ignore' : 'npi_only'),
                        });
                      }}
                    />
                    <ActionChip
                      label="Confirmed here"
                      active={p.verificationStatus === 'confirmed_on_site'}
                      tone="confirmed"
                      disabled={!checkedIn}
                      onPress={() => {
                        const on = p.verificationStatus === 'confirmed_on_site';
                        setProvider(p.npi, {
                          verificationStatus: on ? (p.alreadyKnown ? 'ignore' : 'npi_only') : 'confirmed_on_site',
                          selectedForReview: !on,
                        });
                      }}
                    />
                    <ActionChip
                      label="Not here"
                      active={p.verificationStatus === 'ignore'}
                      tone="notHere"
                      disabled={!checkedIn}
                      onPress={() => {
                        const on = p.verificationStatus === 'ignore';
                        setProvider(p.npi, {
                          verificationStatus: on ? 'npi_only' : 'ignore',
                          selectedForReview: false,
                        });
                      }}
                    />
                  </View>
                </View>
              );
            })}

            {visibleOrgs.map((org) => (
              <View key={`o-${org.organizationNpi}`} style={s.row}>
                <View style={s.rowHeader}>
                  <Text style={s.rowName}>{org.organizationName || 'Organization'}</Text>
                  <Badge label={orgStatusLabel(org.verificationStatus)} tone={org.verificationStatus === 'confirmed_on_site' ? 'confirmed' : org.verificationStatus === 'not_present' ? 'notHere' : 'newProvider'} />
                </View>
                <Text style={s.rowMeta}>
                  {org.taxonomyDescription || 'Organization'} · NPI {org.organizationNpi}
                  {org.suiteLabel ? ` · ${org.suiteLabel}` : ''}
                </Text>
                {org.organizationAddress ? <Text style={s.rowMeta}>{org.organizationAddress}</Text> : null}
                <Text style={s.reason}>{org.matchReason ? `Match: ${org.matchReason} · ` : ''}Source: NPI Registry</Text>
                <View style={s.actionRow}>
                  {ORG_STATUS_OPTIONS.map((opt) => {
                    const active = org.verificationStatus === opt.value;
                    const tone = opt.value === 'confirmed_on_site' ? 'confirmed' : opt.value === 'not_present' ? 'notHere' : 'newProvider';
                    return (
                      <ActionChip
                        key={opt.value}
                        label={opt.label}
                        active={active}
                        tone={tone as any}
                        disabled={!checkedIn}
                        onPress={() => setOrg(org.organizationNpi, { verificationStatus: active ? 'npi_only' : opt.value })}
                      />
                    );
                  })}
                </View>
              </View>
            ))}

            {totalVisible === 0 ? (
              <Text style={s.emptyText}>No matches. Try clearing filters or search.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.filterChip, active && s.filterChipActive]}>
      <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Badge({ label, tone }: { label: string; tone: keyof typeof STATUS_COLORS }) {
  const col = STATUS_COLORS[tone];
  return (
    <View style={{ backgroundColor: col.bg, borderColor: col.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: col.text, fontSize: 10, fontWeight: '900' }}>{label}</Text>
    </View>
  );
}

function ActionChip({
  label,
  active,
  tone,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  tone: keyof typeof STATUS_COLORS;
  disabled?: boolean;
  onPress: () => void;
}) {
  const col = STATUS_COLORS[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        s.actionChip,
        active && { backgroundColor: col.bg, borderColor: col.border },
        disabled && s.disabled,
      ]}
    >
      <Text style={[s.actionChipText, active && { color: col.text }]}>{label}</Text>
    </Pressable>
  );
}

const s = {
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' as const },
  backdropTap: { flex: 1 },
  sheet: {
    maxHeight: '86%' as const,
    backgroundColor: c.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  handle: { alignSelf: 'center' as const, width: 44, height: 5, borderRadius: 999, backgroundColor: '#cbd5e1', marginBottom: 10 },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  title: { color: c.text, fontSize: 18, fontWeight: '900' as const },
  subtitle: { color: c.muted, fontSize: 12, marginTop: 2, fontWeight: '600' as const },
  closeBtn: { backgroundColor: '#eef2ff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: c.primary, fontWeight: '900' as const, fontSize: 13 },
  search: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text,
    backgroundColor: '#f8fafc',
  },
  filterRow: { gap: 8, paddingVertical: 12, paddingRight: 8 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  filterChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  filterChipText: { color: c.muted, fontWeight: '800' as const, fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  bulkRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 6, gap: 8 },
  bulkMeta: { color: c.muted, fontSize: 12, fontWeight: '700' as const, flex: 1 },
  bulkBtn: { backgroundColor: '#eef2ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  bulkBtnText: { color: c.primary, fontWeight: '900' as const, fontSize: 12 },
  lockHint: { color: c.muted, fontSize: 12, fontWeight: '700' as const, marginBottom: 8 },
  row: { borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 12, marginBottom: 10, backgroundColor: '#fff' },
  rowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
  rowName: { color: c.text, fontWeight: '900' as const, fontSize: 14, flex: 1 },
  rowMeta: { color: c.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  reason: { color: '#0e7490', fontSize: 11, marginTop: 5, fontWeight: '800' as const },
  actionRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 10 },
  actionChip: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f8fafc' },
  actionChipText: { color: c.muted, fontWeight: '800' as const, fontSize: 12 },
  emptyText: { color: c.muted, fontSize: 13, fontWeight: '600' as const, textAlign: 'center' as const, marginTop: 20 },
  disabled: { opacity: 0.45 },
};
