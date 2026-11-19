import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import DistributorNav from '../../src/components/DistributorNav';
import KeyboardAwareScrollView from '../../src/components/KeyboardAwareScrollView';
import ScreenBackButton from '../../src/components/ScreenBackButton';
import ListPagination, { paginateList } from '../../src/features/new-entry/ListPagination';
import OrgSummaryCard from '../../src/features/new-entry/OrgSummaryCard';
import {
  getNewEntrySession,
  initOrgLinksFromOrganizations,
  setOrgLinks,
} from '../../src/features/new-entry/session';
import { newEntryStyles as styles } from '../../src/features/new-entry/styles';
import {
  type OrgLink,
  type OrgVerificationStatus,
} from '../../src/features/new-entry/types';
import { countOrgsAtTypedSuite, isHighDensityLocation } from '../../src/features/new-entry/utils';
import { shared } from '../../src/styles/distributor';

function OrgLinkCard({
  org,
  selected,
  onToggleSelected,
}: {
  org: OrgLink;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  return (
    <View style={[styles.orgCard, selected && styles.flyerCardSelected]}>
      <View style={styles.selectRow}>
        <Pressable style={[styles.checkbox, selected && styles.checkboxChecked]} onPress={onToggleSelected}>
          {selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </Pressable>
        <Pressable style={styles.selectBody} onPress={onToggleSelected}>
          <OrgSummaryCard
            organizationName={org.organizationName}
            organizationAddress={org.organizationAddress}
            meta={`NPI ${org.organizationNpi} · ${org.distanceMiles} mi${org.suiteLabel ? ` · ${org.suiteLabel}` : ''}${org.taxonomyDescription ? ` · ${org.taxonomyDescription}` : ''}`}
          />
        </Pressable>
      </View>
    </View>
  );
}

export default function NewEntryOrgsScreen() {
  const [search, setSearch] = useState('');
  const [exactSuiteOnly, setExactSuiteOnly] = useState(false);
  const [selectedNpis, setSelectedNpis] = useState<Set<string>>(new Set());
  const [orgLinks, setOrgLinksLocal] = useState<OrgLink[]>([]);
  const [page, setPage] = useState(1);

  useFocusEffect(
    useCallback(() => {
      const current = getNewEntrySession();
      if (!current?.physicalDrop) {
        router.replace('/new-entry');
        return;
      }

      if (current.orgLinks?.length) {
        setOrgLinksLocal(current.orgLinks);
        return;
      }

      const links = initOrgLinksFromOrganizations(
        current.organizations,
        isHighDensityLocation(countOrgsAtTypedSuite(current.organizations)),
      );
      setOrgLinksLocal(links);
    }, []),
  );

  const highDensity = isHighDensityLocation(countOrgsAtTypedSuite(getNewEntrySession()?.organizations || []));

  function applyOrgLinks(next: OrgLink[]) {
    setOrgLinksLocal(next);
    setOrgLinks(next);
  }

  const filteredLinks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orgLinks.filter((org) => {
      if (exactSuiteOnly && !org.suiteLabel) return false;
      if (!needle) return true;
      return (
        org.organizationName.toLowerCase().includes(needle)
        || org.organizationNpi.includes(needle)
        || (org.taxonomyDescription || '').toLowerCase().includes(needle)
      );
    });
  }, [orgLinks, search, exactSuiteOnly]);

  useEffect(() => {
    setPage(1);
  }, [search, exactSuiteOnly]);

  const pagination = useMemo(() => paginateList(filteredLinks, page), [filteredLinks, page]);

  useEffect(() => {
    if (page !== pagination.safePage) {
      setPage(pagination.safePage);
    }
  }, [page, pagination.safePage]);

  function toggleSelected(npi: string) {
    setSelectedNpis((prev) => {
      const next = new Set(prev);
      if (next.has(npi)) next.delete(npi);
      else next.add(npi);
      return next;
    });
  }

  function markSelected(status: OrgVerificationStatus) {
    const selected = new Set(selectedNpis);
    applyOrgLinks(
      orgLinks.map((link) =>
        selected.has(link.organizationNpi) ? { ...link, verificationStatus: status } : link,
      ),
    );
    setSelectedNpis(new Set());
  }

  const session = getNewEntrySession();
  if (!session?.physicalDrop) return null;

  return (
    <View style={[shared.screen, styles.screenBody]}>
      <DistributorNav />

      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenBackButton label="Back to NPI summary" />

        <Text style={shared.title}>Organizations found here</Text>
        <Text style={shared.subtitle}>
          Multi-select organizations and mark verification status. Only non-NPI-only orgs are saved on submit.
        </Text>

        <Text style={styles.locationText}>{session.locationAddress}</Text>
        {highDensity ? (
          <Text style={styles.warningText}>
            High NPI density detected. You do not need to review every organization one by one.
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Search org name, NPI, taxonomy"
          value={search}
          onChangeText={setSearch}
        />

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.inlineBtn, exactSuiteOnly && styles.chipSelected]}
            onPress={() => setExactSuiteOnly((value) => !value)}
          >
            <Text style={styles.inlineBtnText}>Exact suite only</Text>
          </Pressable>
          <Pressable
            style={styles.inlineBtn}
            onPress={() => markSelected('confirmed_on_site')}
            disabled={!selectedNpis.size}
          >
            <Text style={styles.inlineBtnText}>Mark selected confirmed</Text>
          </Pressable>
          <Pressable
            style={styles.inlineBtn}
            onPress={() => markSelected('virtual_mail_only')}
            disabled={!selectedNpis.size}
          >
            <Text style={styles.inlineBtnText}>Mark selected virtual/mail</Text>
          </Pressable>
        </View>

        <Text style={shared.meta}>{selectedNpis.size} selected · {filteredLinks.length} shown</Text>

        <ListPagination
          page={pagination.safePage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          showingFrom={pagination.showingFrom}
          showingTo={pagination.showingTo}
          onPageChange={setPage}
        />

        <View style={{ width: '100%' }}>
          {!pagination.pageItems.length ? (
            <Text style={styles.hintText}>No organizations match this filter.</Text>
          ) : (
            pagination.pageItems.map((org) => (
              <OrgLinkCard
                key={org.organizationNpi}
                org={org}
                selected={selectedNpis.has(org.organizationNpi)}
                onToggleSelected={() => toggleSelected(org.organizationNpi)}
              />
            ))
          )}
        </View>

        <ListPagination
          page={pagination.safePage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          showingFrom={pagination.showingFrom}
          showingTo={pagination.showingTo}
          onPageChange={setPage}
        />

        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/new-entry/providers')}>
          <Text style={styles.secondaryBtnText}>Continue to providers</Text>
        </Pressable>

        <Pressable style={shared.primaryButton} onPress={() => router.push('/new-entry/review')}>
          <Text style={shared.primaryButtonText}>Review & submit</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
