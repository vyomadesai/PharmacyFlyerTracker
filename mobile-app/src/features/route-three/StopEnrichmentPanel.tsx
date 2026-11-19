import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { stopKindLabel, oneLineAddress } from './routeHelpers';
import DiscoverTabPanel from './DiscoverTabPanel';
import {
  getStopSelections,
  initStopSelectionsFromEnrichment,
  isFieldEditable,
  setOrgPresent,
  setProviderPresent,
  setUnifiedEntityPresent,
  updateDoctorSelection,
  updateOrgSelection,
  updateProviderSelection,
  updateUnifiedEntitySelection,
} from './session';
import type { EntityType, StopEnrichment, StopKind, UnifiedEntitySource, V2Location } from './types';

const colors = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#3f5b76',
  success: '#16a34a',
  successBg: '#f0fdf4',
  mapped: '#3f5b76',
  mappedBg: '#e8eef3',
  unmapped: '#b45309',
  unmappedBg: '#fff7ed',
  npi: '#0e7490',
  npiBg: '#ecfeff',
  npi_registry: '#0369a1',
  npi_registryBg: '#e0f2fe',
  discovery: '#7c3aed',
  discoveryBg: '#f5f3ff',
  org: '#6d28d9',
  orgBg: '#f3e8ff',
};

type Props = {
  routePlanStopId: number;
  enrichment: StopEnrichment | null;
  checkedIn: boolean;
  stopKind: StopKind;
  stopLocation?: V2Location | null;
  refreshKey?: number;
  onSelectionsChange?: () => void;
};

type RowModel = {
  key: string;
  entityType: EntityType;
  source: UnifiedEntitySource | null;
  sources: UnifiedEntitySource[];
  name: string;
  phone: string;
  npi?: string;
  specialty: string;
  flyerTitle: string;
  subtitle: string;
  comparisons?: string;
  presentHere: boolean;
  onToggle: () => void;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onSpecialty: (v: string) => void;
};

type PersonTab = 'mapped' | 'find' | 'discover';

const LIST_MAX_HEIGHT = 280;

const TAB_ORDER: PersonTab[] = ['mapped', 'find', 'discover'];

const TAB_STYLE: Record<PersonTab, { bg: string; text: string; activeBg: string }> = {
  mapped: { bg: colors.mappedBg, text: colors.mapped, activeBg: colors.mapped },
  find: { bg: colors.npiBg, text: colors.npi, activeBg: colors.npi },
  discover: { bg: colors.discoveryBg, text: colors.discovery, activeBg: colors.discovery },
};

const TAB_LABEL: Record<PersonTab, string> = {
  mapped: 'Providers',
  find: 'Unknown providers',
  discover: 'Add more',
};

const TAB_JOB: Record<PersonTab, string> = {
  mapped: 'Tap the names you see. Leave Here if you see them.',
  find: 'Only the 15 doctor specialties at this address. Tap a name to add them to this visit.',
  discover: 'Brand-new practice you just found. GPS fills the location while you write names.',
};

type FindSource = 'all' | 'individuals' | 'unmapped';

const ENTITY_STYLE: Record<EntityType, { bg: string; text: string; label: string }> = {
  mapped: { bg: colors.mappedBg, text: colors.mapped, label: 'Mapped' },
  unmapped: { bg: colors.unmappedBg, text: colors.unmapped, label: 'Unmapped' },
  npi: { bg: colors.npiBg, text: colors.npi, label: 'NPI Live' },
  npi_registry: { bg: colors.npi_registryBg, text: colors.npi_registry, label: 'NPI Registry' },
  org: { bg: colors.orgBg, text: colors.org, label: 'Org' },
  discovery: { bg: colors.discoveryBg, text: colors.discovery, label: 'New' },
  master_doctor: { bg: colors.unmappedBg, text: colors.unmapped, label: 'Master Doctor' },
};

const SOURCE_LABEL: Record<UnifiedEntitySource, string> = {
  mapped: 'Mapped',
  unmapped: 'Unmapped',
  master_doctor: 'Master Doctor',
  npi_registry: 'NPI Registry',
  npi_live: 'NPI Live',
};

function formatComparisons(comparisons: Array<{ field: string; values: Array<{ source: string; value: string }> }>) {
  if (!comparisons.length) return '';
  return comparisons
    .map((comparison) => {
      const values = comparison.values.map((entry) => `${SOURCE_LABEL[entry.source as UnifiedEntitySource] || entry.source}: ${entry.value}`).join(' · ');
      return `${comparison.field}: ${values}`;
    })
    .join('\n');
}

function compactRowSummary(row: RowModel) {
  const parts: string[] = [];
  if (row.specialty) parts.push(row.specialty);
  if (row.phone) parts.push(row.phone);
  if (row.npi) parts.push(`NPI ${row.npi}`);
  return parts.slice(0, 2).join(' · ');
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
}

export default function StopEnrichmentPanel({
  routePlanStopId,
  enrichment,
  checkedIn,
  stopKind,
  stopLocation,
  refreshKey,
  onSelectionsChange,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PersonTab>('mapped');
  const [findSource, setFindSource] = useState<FindSource>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setActiveTab('mapped');
    setFindSource('all');
    setSearchQuery('');
    setExpandedKey(null);
  }, [routePlanStopId]);

  const selections = useMemo(() => {
    if (!enrichment || enrichment.loading || enrichment.error) {
      return getStopSelections(routePlanStopId);
    }
    return initStopSelectionsFromEnrichment(routePlanStopId, enrichment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routePlanStopId,
    enrichment,
    enrichment?.loading,
    enrichment?.error,
    enrichment?.stats.configuredDoctorCount,
    enrichment?.stats.mappedDoctorCount,
    enrichment?.stats.unmappedDoctorCount,
    enrichment?.stats.organizationCount,
    enrichment?.stats.allProviderCount,
    enrichment?.unifiedEntities?.length,
    refreshKey,
  ]);

  const rows: RowModel[] = useMemo(() => {
    if (selections.unifiedEntities.length) {
      return selections.unifiedEntities.map((entity) => ({
        key: entity.entityKey,
        entityType: entity.entityType,
        source: entity.source,
        sources: entity.sources,
        name: entity.displayName,
        phone: entity.phone,
        npi: entity.npi || undefined,
        specialty: entity.specialty || '',
        flyerTitle: entity.flyerTitle || entity.campaignName || '',
        subtitle: entity.flyerTitle
        ? `Flyer: ${entity.flyerTitle}`
        : entity.source === 'master_doctor'
          ? 'In Master_Doctor, not mapped to this practice'
          : entity.source === 'mapped'
            ? 'Mapped to this practice'
            : entity.source,
        comparisons: formatComparisons(entity.comparisons),
        presentHere: entity.presentHere,
        onToggle: () => {
          setUnifiedEntityPresent(routePlanStopId, entity.entityKey, !entity.presentHere);
          onSelectionsChange?.();
        },
        onName: (v) => {
          updateUnifiedEntitySelection(routePlanStopId, entity.entityKey, { displayName: v });
          onSelectionsChange?.();
        },
        onPhone: (v) => {
          updateUnifiedEntitySelection(routePlanStopId, entity.entityKey, { phone: v });
          onSelectionsChange?.();
        },
        onSpecialty: (v) => {
          updateUnifiedEntitySelection(routePlanStopId, entity.entityKey, { specialty: v });
          onSelectionsChange?.();
        },
      }));
    }

    const doctorRows: RowModel[] = selections.doctors.map((d) => ({
      key: `doctor-${d.doctorId}-${d.routePlanDropId ?? 'unmapped'}`,
      entityType: d.entityType,
      source: d.entityType === 'mapped' ? 'mapped' : 'unmapped',
      sources: [d.entityType === 'mapped' ? 'mapped' : 'unmapped'],
      name: d.doctorName,
      phone: d.phone,
      specialty: d.specialty || '',
      flyerTitle: d.flyerTitle || '',
      subtitle: d.entityType === 'mapped' ? (d.flyerTitle || 'On today\'s flyer list') : 'In database at this location',
      presentHere: d.presentHere,
      onToggle: () => {
        updateDoctorSelection(routePlanStopId, d.doctorId, d.routePlanDropId, { presentHere: !d.presentHere });
        onSelectionsChange?.();
      },
      onName: (v) => {
        updateDoctorSelection(routePlanStopId, d.doctorId, d.routePlanDropId, { doctorName: v });
        onSelectionsChange?.();
      },
      onPhone: (v) => {
        updateDoctorSelection(routePlanStopId, d.doctorId, d.routePlanDropId, { phone: v });
        onSelectionsChange?.();
      },
      onSpecialty: (v) => {
        updateDoctorSelection(routePlanStopId, d.doctorId, d.routePlanDropId, { specialty: v });
        onSelectionsChange?.();
      },
    }));

    const orgRows: RowModel[] = selections.orgs.map((o) => ({
      key: `org-${o.organizationNpi}`,
      entityType: 'org' as EntityType,
      source: 'npi_live',
      sources: ['npi_live'],
      name: o.organizationName,
      phone: o.phone,
      specialty: o.taxonomyDescription || '',
      flyerTitle: '',
      subtitle: o.organizationAddress,
      presentHere: o.verificationStatus === 'confirmed_on_site',
      onToggle: () => {
        setOrgPresent(routePlanStopId, o.organizationNpi, o.verificationStatus !== 'confirmed_on_site');
        onSelectionsChange?.();
      },
      onName: (v) => {
        updateOrgSelection(routePlanStopId, o.organizationNpi, { organizationName: v });
        onSelectionsChange?.();
      },
      onPhone: (v) => {
        updateOrgSelection(routePlanStopId, o.organizationNpi, { phone: v });
        onSelectionsChange?.();
      },
      onSpecialty: (v) => {
        updateOrgSelection(routePlanStopId, o.organizationNpi, { taxonomyDescription: v });
        onSelectionsChange?.();
      },
    }));

    const providerRows: RowModel[] = selections.providers
      .filter((p) => p.entityType !== 'org')
      .map((p) => ({
      key: `provider-${p.npi}`,
      entityType: p.entityType,
      source: 'npi_live',
      sources: ['npi_live'],
      name: p.providerName,
      phone: p.phone,
      npi: p.npi,
      specialty: p.taxonomyDescription || '',
      flyerTitle: '',
      subtitle: p.providerAddress,
      presentHere: p.verificationStatus === 'confirmed_on_site' || p.selectedForReview,
      onToggle: () => {
        const on = p.verificationStatus === 'confirmed_on_site' || p.selectedForReview;
        setProviderPresent(routePlanStopId, p.npi, !on);
        onSelectionsChange?.();
      },
      onName: (v) => {
        updateProviderSelection(routePlanStopId, p.npi, { providerName: v });
        onSelectionsChange?.();
      },
      onPhone: (v) => {
        updateProviderSelection(routePlanStopId, p.npi, { phone: v });
        onSelectionsChange?.();
      },
      onSpecialty: (v) => {
        updateProviderSelection(routePlanStopId, p.npi, { taxonomyDescription: v });
        onSelectionsChange?.();
      },
    }));

    return [...doctorRows, ...orgRows, ...providerRows];
  }, [selections, routePlanStopId, onSelectionsChange]);

  const mappedRows = useMemo(
    () => rows.filter((row) => row.entityType === 'mapped' || row.source === 'mapped'),
    [rows],
  );
  const addedRows = useMemo(
    () => rows.filter((row) => row.presentHere && row.entityType !== 'mapped' && row.source !== 'mapped'),
    [rows],
  );
  const findPool = useMemo(() => {
    const extras = rows.filter((row) => row.entityType !== 'mapped' && row.source !== 'mapped' && row.entityType !== 'org');
    return extras.filter((row) => {
      if (findSource === 'individuals') return row.entityType === 'npi' || row.entityType === 'npi_registry';
      if (findSource === 'unmapped') {
        return row.entityType === 'unmapped' || row.source === 'unmapped' || row.source === 'master_doctor';
      }
      return true;
    });
  }, [rows, findSource]);

  const discoverCount = selections.discover.providers.length;

  const tabCounts = useMemo(() => ({
    mapped: mappedRows.length + addedRows.length,
    find: findPool.length,
    discover: discoverCount,
  }), [mappedRows.length, addedRows.length, findPool.length, discoverCount]);

  const activeRows = activeTab === 'mapped' ? mappedRows : activeTab === 'find' ? findPool : [];

  function selectTab(tab: PersonTab) {
    setActiveTab(tab);
    setExpandedKey(null);
  }

  function toggleRowExpanded(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  const mappedConfirmed = mappedRows.filter((row) => row.presentHere).length;
  const mappedProgress = mappedRows.length ? mappedConfirmed / mappedRows.length : 0;
  const stopKindKey: EntityType = stopKind === 'mapped' ? 'mapped' : stopKind === 'unmapped' ? 'unmapped' : stopKind === 'npi' ? 'npi' : 'discovery';

  if (!enrichment) return null;

  if (enrichment.loading) {
    return (
      <View style={styles.panel}>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.hint}>Loading people at this location…</Text>
        </View>
      </View>
    );
  }

  if (enrichment.error) {
    return (
      <View style={styles.panel}>
        <Text style={styles.error}>{enrichment.error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={[styles.stopKindTag, { backgroundColor: ENTITY_STYLE[stopKindKey].bg }]}>
          <Text style={[styles.stopKindText, { color: ENTITY_STYLE[stopKindKey].text }]}>
            {stopKindLabel(stopKind)}
          </Text>
        </View>
      </View>

      {/* <View style={styles.statRow}>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{mappedConfirmed}</Text>
          <Text style={styles.statLabel}>of {mappedRows.length} here</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{addedRows.length}</Text>
          <Text style={styles.statLabel}>added today</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{discoverCount}</Text>
          <Text style={styles.statLabel}>new names</Text>
        </View>
      </View> */}

      <View style={styles.tabBar}>
        {TAB_ORDER.map((tab, index) => {
          const isActive = activeTab === tab;
          const tabStyle = TAB_STYLE[tab];
          return (
            <Pressable
              key={tab}
              style={[styles.tab, isActive && { backgroundColor: tabStyle.activeBg, borderColor: tabStyle.activeBg }]}
              onPress={() => selectTab(tab)}
            >
              <Text style={[styles.tabStep, isActive && styles.tabTextActive]}>{index + 1}</Text>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]} numberOfLines={1}>{TAB_LABEL[tab]}</Text>
              <Text style={[styles.tabCount, isActive && styles.tabTextActive]}>{tabCounts[tab]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.jobBar, { backgroundColor: TAB_STYLE[activeTab].bg }]}>
        <Text style={[styles.jobText, { color: TAB_STYLE[activeTab].text }]}>{TAB_JOB[activeTab]}</Text>
      </View>

      {activeTab === 'find' ? (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              placeholder="Type a doctor name…"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              autoCapitalize="words"
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.sourceRow}>
            {([
              { id: 'all' as const, label: 'All' },
              { id: 'individuals' as const, label: 'Individuals' },
              { id: 'unmapped' as const, label: 'Unmapped' },
            ]).map((source) => {
              const on = findSource === source.id;
              return (
                <Pressable
                  key={source.id}
                  style={[styles.sourceChip, on && styles.sourceChipOn]}
                  onPress={() => setFindSource(source.id)}
                >
                  <Text style={[styles.sourceChipText, on && styles.sourceChipTextOn]}>{source.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {activeTab === 'discover' ? (
        <DiscoverTabPanel
          routePlanStopId={routePlanStopId}
          checkedIn={checkedIn}
          refreshKey={refreshKey}
          onSelectionsChange={onSelectionsChange}
          listMaxHeight={LIST_MAX_HEIGHT}
          stopDefaults={{
            locationAddress: stopLocation ? oneLineAddress(stopLocation) : '',
            latitude: stopLocation?.latitude ?? null,
            longitude: stopLocation?.longitude ?? null,
            practiceName: enrichment?.practiceName || '',
          }}
        />
      ) : null}

      {activeTab === 'mapped' && mappedRows.length ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(mappedProgress * 100)}%` }]} />
        </View>
      ) : null}

      {activeTab === 'mapped' ? (
        !mappedRows.length && !addedRows.length ? (
          <Text style={styles.empty}>
            No providers at this practice yet. Use Unknown providers or Add more to add someone.
          </Text>
        ) : (
          <ScrollView
            style={styles.nameListScroll}
            contentContainerStyle={styles.nameListContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
            keyboardShouldPersistTaps="handled"
          >
            {addedRows.length ? (
              <>
                <Text style={styles.sectionLabelFirst}>Added this visit</Text>
                {addedRows.map((row) => (
                  <PersonRow
                    key={row.key}
                    row={row}
                    checkedIn={checkedIn}
                    expanded={expandedKey === row.key}
                    intent="add"
                    onPressRow={() => toggleRowExpanded(row.key)}
                  />
                ))}
              </>
            ) : null}

            <Text style={addedRows.length ? styles.sectionLabel : styles.sectionLabelFirst}>
              Providers
            </Text>
            {mappedRows.length ? (
              mappedRows.map((row) => (
                <PersonRow
                  key={row.key}
                  row={row}
                  checkedIn={checkedIn}
                  expanded={expandedKey === row.key}
                  intent="confirm"
                  onPressRow={() => toggleRowExpanded(row.key)}
                />
              ))
            ) : (
              <Text style={styles.emptyInList}>No providers yet.</Text>
            )}
          </ScrollView>
        )
      ) : null}

      {activeTab === 'find' && !activeRows.length ? (
        <Text style={styles.empty}>
          No individuals or unmapped names at this address. Use Add more if this is a new practice.
        </Text>
      ) : activeTab === 'find' ? (
        <>
          <Text style={styles.sectionLabel}>
            {activeRows.length} name{activeRows.length === 1 ? '' : 's'}
          </Text>
          <ScrollView
            style={styles.nameListScroll}
            contentContainerStyle={styles.nameListContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
            keyboardShouldPersistTaps="handled"
          >
            {activeRows.map((row) => (
              <PersonRow
                key={row.key}
                row={row}
                checkedIn={checkedIn}
                expanded={expandedKey === row.key}
                intent="add"
                onPressRow={() => {
                  if (checkedIn && !row.presentHere) {
                    row.onToggle();
                  }
                  toggleRowExpanded(row.key);
                }}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

function PersonRow({
  row,
  checkedIn,
  expanded,
  intent,
  onPressRow,
}: {
  row: RowModel;
  checkedIn: boolean;
  expanded: boolean;
  intent: 'confirm' | 'add';
  onPressRow: () => void;
}) {
  const style = ENTITY_STYLE[row.entityType];
  const canEdit = checkedIn && row.entityType !== 'mapped';
  const summary = compactRowSummary(row);
  const actionLabel = row.presentHere
    ? (intent === 'add' ? 'Added' : 'Here')
    : (intent === 'add' ? 'Add' : 'Not here');

  return (
    <View style={[styles.row, row.presentHere && styles.rowPresent, expanded && styles.rowExpanded]}>
      <Pressable style={styles.rowContent} onPress={onPressRow}>
        <View style={styles.rowTop}>
          <View style={[styles.avatar, { backgroundColor: style.bg }]}>
            <Text style={[styles.avatarText, { color: style.text }]}>{initials(row.name)}</Text>
          </View>
          <View style={styles.rowIdentity}>
            <Text style={[styles.name, !expanded && styles.nameCompact]} numberOfLines={expanded ? 3 : 1}>
              {row.name || 'Unnamed'}
            </Text>
            {!expanded && summary ? (
              <Text style={styles.summaryCompact} numberOfLines={1}>{summary}</Text>
            ) : null}
          </View>
        </View>

        {!expanded ? (
          row.flyerTitle ? (
            <View style={styles.flyerChip}>
              <Text style={styles.flyerChipLabel}>Flyer</Text>
              <Text style={styles.flyerChipText} numberOfLines={1}>{row.flyerTitle}</Text>
            </View>
          ) : null
        ) : (
          <View style={styles.expandedBlock}>
            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: style.bg }]}>
                <Text style={[styles.tagText, { color: style.text }]}>{style.label}</Text>
              </View>
              {(row.sources.length ? row.sources : row.source ? [row.source] : []).map((source) => (
                <View key={`${row.key}-${source}`} style={[styles.tag, { backgroundColor: '#f1f5f9' }]}>
                  <Text style={[styles.tagText, { color: '#475569' }]}>{SOURCE_LABEL[source]}</Text>
                </View>
              ))}
            </View>

            {row.flyerTitle ? (
              <View style={styles.flyerBanner}>
                <Text style={styles.flyerBannerLabel}>Drop this flyer</Text>
                <Text style={styles.flyerBannerText}>{row.flyerTitle}</Text>
                <Text style={styles.flyerBannerHint}>Take the proof photo in Flyers to drop below.</Text>
              </View>
            ) : null}

            {canEdit && isFieldEditable(row.entityType, 'name') ? (
              <>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  value={row.name}
                  onChangeText={row.onName}
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor={colors.muted}
                />
              </>
            ) : null}

            {canEdit && isFieldEditable(row.entityType, 'phone') ? (
              <>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  value={row.phone}
                  onChangeText={row.onPhone}
                  style={styles.inputSmall}
                  placeholder="Phone"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                />
              </>
            ) : (
              <Text style={styles.meta}>{row.phone ? `Phone  ${row.phone}` : 'No phone on file'}</Text>
            )}

            {row.npi ? <Text style={styles.meta}>NPI  {row.npi}</Text> : null}

            {canEdit && isFieldEditable(row.entityType, 'specialty') ? (
              <>
                <Text style={styles.fieldLabel}>Specialty</Text>
                <TextInput
                  value={row.specialty}
                  onChangeText={row.onSpecialty}
                  style={styles.inputSmall}
                  placeholder="Specialty"
                  placeholderTextColor={colors.muted}
                />
              </>
            ) : (
              <Text style={styles.meta}>
                {row.specialty || (row.entityType === 'mapped' ? 'No specialty on file' : 'No specialty')}
              </Text>
            )}

            {row.subtitle && !row.subtitle.startsWith('Flyer:') ? (
              <Text style={styles.meta} numberOfLines={2}>{row.subtitle}</Text>
            ) : null}

            {row.comparisons ? (
              <Text style={styles.comparisonMeta} numberOfLines={4}>{row.comparisons}</Text>
            ) : null}

            <Text style={styles.expandHint}>Tap the name to collapse</Text>
          </View>
        )}
      </Pressable>

      <Pressable
        style={[styles.action, row.presentHere ? styles.actionOn : styles.actionOff, !checkedIn && styles.disabled]}
        onPress={row.onToggle}
        disabled={!checkedIn}
      >
        <Ionicons
          name={row.presentHere ? 'checkmark' : intent === 'add' ? 'add' : 'close'}
          size={14}
          color={row.presentHere ? '#fff' : intent === 'add' ? colors.npi : colors.muted}
        />
        <Text style={[styles.actionText, row.presentHere && styles.actionTextOn, !row.presentHere && intent === 'add' && styles.actionTextAdd]}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {},
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stopKindTag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  stopKindText: { fontSize: 11, fontWeight: '800' },
  address: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 18, flex: 1 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statChip: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 8 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  practiceName: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 4 },
  practiceInput: { marginTop: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '800', color: colors.text },
  tabPhonesBlock: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tabPhone: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 6 },
  tabPhoneEmpty: { color: colors.muted, fontSize: 13, marginTop: 6, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  empty: { color: colors.muted, fontSize: 13, marginTop: 14, lineHeight: 18 },
  tabBar: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tab: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    minHeight: 68,
    justifyContent: 'center',
  },
  tabStep: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  tabText: { color: colors.text, fontSize: 11, fontWeight: '800', marginTop: 2 },
  tabCount: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  tabTextActive: { color: '#fff' },
  jobBar: { marginTop: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  jobText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  progressTrack: { marginTop: 12, height: 6, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: colors.primary },
  searchWrap: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  nameListScroll: {
    marginTop: 10,
    maxHeight: LIST_MAX_HEIGHT,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  nameListContent: {
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sourceChipOn: { backgroundColor: colors.npi, borderColor: colors.npi },
  sourceChipText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  sourceChipTextOn: { color: '#fff' },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 14,
    marginBottom: 2,
  },
  sectionLabelFirst: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 2,
  },
  emptyInList: { color: colors.muted, fontSize: 13, marginTop: 8, marginBottom: 4 },
  row: { marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fff' },
  rowPresent: { borderColor: '#86efac', backgroundColor: colors.successBg },
  rowExpanded: { paddingVertical: 12 },
  rowContent: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIdentity: { flex: 1, minWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '800' },
  expandedBlock: { marginTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: '900' },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  nameCompact: { fontSize: 14, fontWeight: '700' },
  summaryCompact: { color: colors.muted, fontSize: 12, marginTop: 2, fontWeight: '600' },
  flyerChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  flyerChipLabel: { color: '#16a34a', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  flyerChipText: { color: '#15803d', fontSize: 12, fontWeight: '800', flexShrink: 1 },
  flyerBanner: {
    marginBottom: 10,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flyerBannerLabel: { color: '#16a34a', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  flyerBannerText: { color: '#15803d', fontSize: 15, fontWeight: '800', marginTop: 3 },
  flyerBannerHint: { color: '#16a34a', fontSize: 11, marginTop: 4, fontWeight: '600' },
  expandHint: { color: colors.muted, fontSize: 11, marginTop: 8, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  comparisonMeta: { color: '#b45309', fontSize: 11, marginTop: 6, lineHeight: 15, fontWeight: '700' },
  input: { marginTop: 2, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: colors.text },
  inputSmall: { marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text },
  action: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  actionOn: { backgroundColor: colors.primary },
  actionOff: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  actionTextOn: { color: '#fff' },
  actionTextAdd: { color: colors.npi },
  addBtn: { marginTop: 14, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#eef2ff' },
  addBtnText: { color: colors.primary, fontWeight: '900', fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 10, lineHeight: 17 },
  error: { color: '#b91c1c', fontSize: 13, marginTop: 8, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
