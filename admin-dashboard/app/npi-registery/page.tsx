'use client';

import './npi-registery.css';

import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../src/components/PageHeader';
import { api } from '../../src/services/api';

type SourceName = 'MASTER_DOCTOR' | 'NPI_REGISTRY';

type DoctorFlat = {
  source: SourceName;
  masterDoctorId?: number | null;
  npi?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  credential?: string | null;
  sex?: string | null;
  licenseNumber?: string | null;
  taxonomyCode?: string | null;
  taxonomyDesc?: string | null;
  taxonomyState?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  fax?: string | null;
  practiceName?: string | null;
  isPracticeMapped?: boolean | null;
  isLocalMapped?: boolean | null;
  primaryPracticeAddress?: string | null;
  secondaryPracticeAddresses?: string | null;
  primaryTaxonomy?: string | null;
  selectedTaxonomy?: string | null;
  nppesLastUpdated?: string | null;
  raw?: any;
};

type ComparisonRow = {
  key: keyof DoctorFlat;
  label: string;
  masterValue: string;
  registryValue: string;
  match: boolean;
  defaultChoice: SourceName;
};

type LookupResponse = {
  npi: string;
  master: DoctorFlat | null;
  registry: DoctorFlat | null;
  comparison: ComparisonRow[];
  existingConfig?: any;
  nppesResultCount?: number;
};

type NpiSearchFilters = {
  npiNumber: string;
  npiType: string;
  taxonomyDescription: string;
  city: string;
  postalCode: string;
  address1: string;
  phone: string;
};

type SearchPaginationMeta = {
  page: number;
  total: number;
  totalPages: number;
};

type ResultTab = 'matched' | 'mapped' | 'registry-only' | 'local-only';

type MatchedPair = {
  local: DoctorFlat;
  registry: DoctorFlat | null;
};

type SearchCounts = {
  matched: number;
  mapped: number;
  registryOnly: number;
  localOnly: number;
};

type TabPagination = {
  page: number;
  total: number;
  totalPages: number;
};

type TabResultFilterField = 'all' | 'practiceName' | 'primaryAddress' | 'secondaryAddress' | 'phone' | 'taxonomy';

type TabResultFilter = {
  field: TabResultFilterField;
  text: string;
};

const tabResultFilterOptions: Array<{ value: TabResultFilterField; label: string }> = [
  { value: 'all', label: 'All fields' },
  { value: 'practiceName', label: 'Practice Name' },
  { value: 'primaryAddress', label: 'Primary Practice Address' },
  { value: 'secondaryAddress', label: 'Secondary Practice Address(es)' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'taxonomy', label: 'Taxonomy' }
];

const resultTabLabels: Record<ResultTab, string> = {
  matched: 'Matched Items',
  mapped: 'Mapped',
  'registry-only': 'NPI Registry Results',
  'local-only': 'New Data from Master_Doctor'
};

type FieldConfig = { key: keyof DoctorFlat; label: string; compact?: boolean };
type ComparisonSection = { id: string; title: string; subtitle: string; fields: FieldConfig[] };

type TaxonomyRow = {
  id: string;
  source: SourceName;
  code: string;
  desc: string;
  primary: 'Yes' | 'No' | '—';
  state: string;
  license: string;
};

function isPrimaryFlag(value: unknown) {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === 'y' || text === 'yes' || text === '1';
}

function taxonomyRowsFor(doctor: DoctorFlat | null | undefined): TaxonomyRow[] {
  if (!doctor) return [];

  if (doctor.source === 'NPI_REGISTRY') {
    const taxonomies = Array.isArray(doctor.raw?.taxonomies) ? doctor.raw.taxonomies : [];
    if (taxonomies.length) {
      return taxonomies.map((entry: any, index: number) => ({
        id: `npi:${index}:${String(entry?.code || '').trim()}:${String(entry?.license || '').trim()}`,
        source: 'NPI_REGISTRY' as const,
        code: String(entry?.code || '').trim(),
        desc: String(entry?.desc || '').trim(),
        primary: isPrimaryFlag(entry?.primary) ? 'Yes' as const : 'No' as const,
        state: String(entry?.state || '').trim(),
        license: String(entry?.license || '').trim(),
      }));
    }
  }

  const code = String(doctor.taxonomyCode || '').trim();
  const desc = String(doctor.taxonomyDesc || '').trim();
  const license = String(doctor.licenseNumber || '').trim();
  if (!code && !desc && !license) return [];
  return [{
    id: `master:${code || desc || 'local'}`,
    source: 'MASTER_DOCTOR',
    code,
    desc,
    primary: '—',
    state: String(doctor.taxonomyState || '').trim(),
    license,
  }];
}

function allTaxonomyRows(master: DoctorFlat | null | undefined, registry: DoctorFlat | null | undefined) {
  return [...taxonomyRowsFor(master), ...taxonomyRowsFor(registry)];
}

function taxonomyListText(doctor: DoctorFlat | null | undefined) {
  const rows = taxonomyRowsFor(doctor);
  if (!rows.length) return '—';
  return rows
    .map((row) => `Primary ${row.primary} | ${row.code || '—'} - ${row.desc || '—'} | ${row.state || '—'} | ${row.license || '—'}`)
    .join(' ; ');
}

function pickTaxonomyId(rows: TaxonomyRow[], existing: any) {
  let savedId = '';
  let savedCode = String(existing?.TaxonomyCode || '').trim();
  try {
    const selected = typeof existing?.SelectedJson === 'string'
      ? JSON.parse(existing.SelectedJson)
      : existing?.SelectedJson;
    savedId = String(selected?.taxonomyChoiceId || '');
    if (!savedCode) savedCode = String(selected?.taxonomyCode || '');
  } catch {
    savedId = '';
  }
  if (savedId && rows.some((row) => row.id === savedId)) return savedId;
  if (savedCode) {
    const match = rows.find((row) => row.code.toUpperCase() === savedCode.toUpperCase());
    if (match) return match.id;
  }
  return rows.find((row) => row.primary === 'Yes')?.id || rows[0]?.id || '';
}

const comparisonSections: ComparisonSection[] = [
  {
    id: 'practice-addresses',
    title: 'Practice Address Review',
    subtitle: 'Primary and secondary practice addresses from each source',
    fields: [
      { key: 'primaryPracticeAddress', label: 'Primary Practice Address' },
      { key: 'secondaryPracticeAddresses', label: 'Secondary Practice Address(es)' }
    ]
  },
  {
    id: 'address-contact',
    title: 'Address & Contact',
    subtitle: 'Practice address, phone, and fax values used by the app',
    fields: [
      { key: 'address1', label: 'Address 1' },
      { key: 'address2', label: 'Address 2' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State', compact: true },
      { key: 'postalCode', label: 'ZIP' },
      { key: 'phone', label: 'Phone' },
      { key: 'fax', label: 'Fax' }
    ]
  }
];

const fieldLabels = comparisonSections.flatMap((section) => section.fields);

function valueOf(doctor: DoctorFlat | null | undefined, key: keyof DoctorFlat) {
  const value = doctor?.[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

function doctorName(doctor: DoctorFlat | null | undefined) {
  if (!doctor) return 'Not found';
  const name = [doctor.firstName, doctor.middleName, doctor.lastName, doctor.credential].filter(Boolean).join(' ');
  if (name) return name;
  const orgName = doctor.raw?.basic?.organization_name;
  if (orgName) return String(orgName);
  return 'No name';
}

function doctorAddress(doctor: DoctorFlat | null | undefined) {
  if (!doctor) return '';
  return [doctor.address1, doctor.address2, doctor.city, doctor.state, doctor.postalCode].filter(Boolean).join(', ');
}

function doctorPracticeName(doctor: DoctorFlat | null | undefined, variant?: 'master' | 'registry') {
  if (!doctor) return '';

  const isMaster = doctor.source === 'MASTER_DOCTOR' || variant === 'master';
  if (isMaster) {
    const raw = doctor.raw || {};
    return String(
      doctor.practiceName
      || raw.Practice_Name
      || raw.practice_name
      || raw.PracticeName
      || ''
    ).trim();
  }

  const raw = doctor.raw || {};
  const basic = raw.basic || {};
  const isOrganization = String(raw.enumeration_type || '').toUpperCase() === 'NPI-2';
  if (isOrganization) {
    return String(basic.organization_name || doctor.lastName || '').trim();
  }

  return String(basic.organization_name || '').trim()
    || [doctor.firstName, doctor.middleName, doctor.lastName, doctor.credential].filter(Boolean).join(' ').trim();
}

function doctorMappingStatus(doctor: DoctorFlat) {
  const mapped = Boolean(doctor.isPracticeMapped);
  return {
    mapped,
    label: mapped ? 'Mapped' : 'Unmapped',
    title: mapped
      ? 'Active Doctor_Location_Mapping to a practice'
      : 'No active Doctor_Location_Mapping to a practice'
  };
}

function formatAddressParts(parts: Array<unknown>) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function primaryPracticeAddress(doctor: DoctorFlat | null | undefined) {
  if (!doctor) return '—';
  if (doctor.source === 'NPI_REGISTRY') {
    const addresses = Array.isArray(doctor.raw?.addresses) ? doctor.raw.addresses : [];
    const primary = addresses.find((entry: any) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
      || addresses[0];
    if (!primary) return doctorAddress(doctor) || '—';
    return formatAddressParts([
      primary.address_1,
      primary.address_2,
      primary.city,
      primary.state,
      primary.postal_code,
      primary.country_code
    ]) || '—';
  }
  return doctorAddress(doctor) || '—';
}

function secondaryPracticeAddresses(doctor: DoctorFlat | null | undefined) {
  if (!doctor || doctor.source !== 'NPI_REGISTRY') return [];
  const addresses = Array.isArray(doctor.raw?.addresses) ? doctor.raw.addresses : [];
  const primary = addresses.find((entry: any) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
    || addresses[0];
  const primaryText = primary
    ? formatAddressParts([primary.address_1, primary.address_2, primary.city, primary.state, primary.postal_code, primary.country_code])
    : '';

  const seen = new Set<string>();
  if (primaryText) seen.add(primaryText.toUpperCase());

  return addresses
    .map((entry: any) => formatAddressParts([
      entry.address_1,
      entry.address_2,
      entry.city,
      entry.state,
      entry.postal_code,
      entry.country_code
    ]))
    .filter(Boolean)
    .filter((text) => {
      const key = text.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function taxonomyDetails(doctor: DoctorFlat | null | undefined) {
  if (!doctor) {
    return { primary: '—', selected: '—', state: '—', license: '—' };
  }

  if (doctor.source === 'NPI_REGISTRY') {
    const taxonomies = Array.isArray(doctor.raw?.taxonomies) ? doctor.raw.taxonomies : [];
    const primaryTaxonomy = taxonomies.find((entry: any) => entry?.primary === true) || null;
    const selectedTaxonomy = primaryTaxonomy || taxonomies[0] || null;
    const selected = selectedTaxonomy
      ? `${selectedTaxonomy.code || '—'}${selectedTaxonomy.desc ? ` - ${selectedTaxonomy.desc}` : ''}`
      : (doctor.taxonomyCode || doctor.taxonomyDesc ? `${doctor.taxonomyCode || '—'}${doctor.taxonomyDesc ? ` - ${doctor.taxonomyDesc}` : ''}` : '—');
    return {
      primary: primaryTaxonomy ? 'Yes' : (taxonomies.length ? 'No' : '—'),
      selected,
      state: selectedTaxonomy?.state || doctor.taxonomyState || '—',
      license: selectedTaxonomy?.license || doctor.licenseNumber || '—'
    };
  }

  return {
    primary: '—',
    selected: doctor.taxonomyCode || doctor.taxonomyDesc
      ? `${doctor.taxonomyCode || '—'}${doctor.taxonomyDesc ? ` - ${doctor.taxonomyDesc}` : ''}`
      : '—',
    state: doctor.taxonomyState || doctor.state || '—',
    license: doctor.licenseNumber || '—'
  };
}

function withDerivedDoctorFields(doctor: DoctorFlat | null | undefined): DoctorFlat | null {
  if (!doctor) return null;
  const secondary = secondaryPracticeAddresses(doctor);
  const taxonomy = taxonomyDetails(doctor);
  return {
    ...doctor,
    primaryPracticeAddress: primaryPracticeAddress(doctor),
    secondaryPracticeAddresses: secondary.length ? secondary.join(' | ') : null,
    primaryTaxonomy: taxonomy.primary,
    selectedTaxonomy: taxonomy.selected,
    taxonomyState: taxonomy.state,
    licenseNumber: taxonomy.license
  };
}

function normalizeForEmpty(value: unknown) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function buildSelectedValues(master: DoctorFlat | null, registry: DoctorFlat | null, choices: Record<string, SourceName>) {
  return fieldLabels.reduce((out, field) => {
    const source = choices[String(field.key)] || 'NPI_REGISTRY';
    out[field.key] = source === 'MASTER_DOCTOR' ? valueOf(master, field.key) : valueOf(registry, field.key);
    return out;
  }, {} as Record<string, string>);
}

function getRow(lookup: LookupResponse | null, key: keyof DoctorFlat, label: string): ComparisonRow {
  const found = lookup?.comparison?.find((row) => row.key === key);
  if (found) return found;
  return {
    key,
    label,
    masterValue: valueOf(lookup?.master, key),
    registryValue: valueOf(lookup?.registry, key),
    match: valueOf(lookup?.master, key).trim().toLowerCase() === valueOf(lookup?.registry, key).trim().toLowerCase(),
    defaultChoice: valueOf(lookup?.registry, key) ? 'NPI_REGISTRY' : 'MASTER_DOCTOR'
  };
}

function doctorPhone(doctor: DoctorFlat | null | undefined) {
  if (!doctor) return '—';
  if (doctor.phone) return doctor.phone;
  if (doctor.source === 'NPI_REGISTRY') {
    const addresses = Array.isArray(doctor.raw?.addresses) ? doctor.raw.addresses : [];
    const primary = addresses.find((entry: any) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
      || addresses[0];
    const registryPhone = primary?.telephone_number;
    if (registryPhone) return String(registryPhone).trim();
  }
  const rawPhone = doctor.raw?.Doctor_Phone || doctor.raw?.Doctor_MobileNo;
  if (rawPhone) return String(rawPhone).trim();
  return '—';
}

function DoctorResultCard({
  doc,
  variant,
  onSelect
}: {
  doc: DoctorFlat;
  variant: 'master' | 'registry';
  onSelect: () => void;
}) {
  const secondary = secondaryPracticeAddresses(doc);
  const mapping = variant === 'master' ? doctorMappingStatus(doc) : null;

  return (
    <button
      type="button"
      className={`npi-result npi-result-${variant === 'master' ? 'master' : 'registry'}`}
      onClick={onSelect}
    >
      <div className="npi-result-head">
        <span className={`npi-result-source npi-result-source-${variant === 'master' ? 'master' : 'registry'}`}>
          {variant === 'master' ? 'Master_Doctor' : 'NPI Registry'}
        </span>
        {mapping ? (
          <span
            className={`npi-result-map-badge ${mapping.mapped ? 'npi-result-map-badge-mapped' : 'npi-result-map-badge-unmapped'}`}
            title={mapping.title}
          >
            {mapping.label}
          </span>
        ) : variant === 'registry' ? (
          <span
            className={`npi-result-map-badge ${doc.isLocalMapped ? 'npi-result-map-badge-mapped' : 'npi-result-map-badge-unmapped'}`}
            title={doc.isLocalMapped ? 'This NPI already exists in Master_Doctor.' : 'Not in Master_Doctor yet.'}
          >
            {doc.isLocalMapped ? 'In Master_Doctor' : 'New'}
          </span>
        ) : null}
      </div>
      <strong>{doctorName(doc)}</strong>
      <div className="npi-result-details">
        <div className="npi-result-detail"><b>Practice Name:</b> {doctorPracticeName(doc) || '—'}</div>
        <div className="npi-result-detail"><b>Primary Practice Address:</b> {primaryPracticeAddress(doc)}</div>
        <div className="npi-result-detail"><b>Secondary Practice Address(es):</b> {secondary.length ? secondary.join(' | ') : '—'}</div>
        <div className="npi-result-detail"><b>Phone Number:</b> {doctorPhone(doc)}</div>
        <div className="npi-result-detail"><b>Taxonomies:</b> {taxonomyListText(doc)}</div>
      </div>
      <small>NPI: {doc.npi || 'missing'}</small>
    </button>
  );
}

function MatchedResultRow({
  pair,
  onSelect
}: {
  pair: MatchedPair;
  onSelect: (npi: string) => void;
}) {
  const npi = pair.local.npi || pair.registry?.npi || '';

  return (
    <div className="npi-matched-row">
      <DoctorResultCard doc={pair.local} variant="master" onSelect={() => onSelect(npi)} />
      {pair.registry ? (
        <DoctorResultCard doc={pair.registry} variant="registry" onSelect={() => onSelect(npi)} />
      ) : (
        <button
          type="button"
          className="npi-result npi-result-registry npi-result-missing"
          onClick={() => onSelect(npi)}
          disabled={!npi}
        >
          <div className="npi-result-head">
            <span className="npi-result-source npi-result-source-registry">NPI Registry</span>
          </div>
          <strong>Not found in NPI Registry</strong>
          <div className="npi-result-details">
            <div className="npi-result-detail">No registry record is available for this provider yet.</div>
          </div>
          {npi ? <small>NPI: {npi}</small> : <small>NPI missing</small>}
        </button>
      )}
    </div>
  );
}

type FullSearchResults = {
  matched: MatchedPair[];
  mapped: MatchedPair[];
  registryNew: DoctorFlat[];
  localOnly: DoctorFlat[];
};

function doctorMatchesTabFilter(
  doctor: DoctorFlat | null | undefined,
  field: TabResultFilterField,
  term: string,
) {
  const needle = term.trim();
  if (!needle) return true;
  if (!doctor) return false;

  const haystack = (() => {
    switch (field) {
      case 'practiceName':
        return doctorPracticeName(doctor);
      case 'primaryAddress':
        return primaryPracticeAddress(doctor);
      case 'secondaryAddress':
        return secondaryPracticeAddresses(doctor).join(' | ');
      case 'phone':
        return doctorPhone(doctor);
      case 'taxonomy':
        return taxonomyListText(doctor);
      default:
        return [
          doctorPracticeName(doctor),
          primaryPracticeAddress(doctor),
          secondaryPracticeAddresses(doctor).join(' | '),
          doctorPhone(doctor),
          taxonomyListText(doctor),
        ].join(' ');
    }
  })().toLowerCase();

  if (haystack.includes(needle.toLowerCase())) return true;

  const digits = needle.replace(/\D/g, '');
  if (digits.length >= 3 && (field === 'phone' || field === 'all')) {
    const phoneDigits = doctorPhone(doctor).replace(/\D/g, '');
    if (phoneDigits.includes(digits)) return true;
  }

  return false;
}

function pairMatchesTabFilter(pair: MatchedPair, field: TabResultFilterField, term: string) {
  return doctorMatchesTabFilter(pair.local, field, term)
    || doctorMatchesTabFilter(pair.registry, field, term);
}

function filterFullSearchResults(results: FullSearchResults, filter: TabResultFilter): FullSearchResults {
  const term = filter.text.trim();
  if (!term) return results;

  return {
    matched: results.matched.filter((pair) => pairMatchesTabFilter(pair, filter.field, term)),
    mapped: results.mapped.filter((pair) => pairMatchesTabFilter(pair, filter.field, term)),
    registryNew: results.registryNew.filter((doc) => doctorMatchesTabFilter(doc, filter.field, term)),
    localOnly: results.localOnly.filter((doc) => doctorMatchesTabFilter(doc, filter.field, term)),
  };
}

function paginateTotalPages(total: number, limit: number) {
  if (!total) return 0;
  return Math.ceil(total / limit);
}

function TabResultFilterBar({
  filter,
  onChange,
}: {
  filter: TabResultFilter;
  onChange: (next: TabResultFilter) => void;
}) {
  return (
    <div className="npi-tab-result-filter">
      <label className="npi-tab-result-filter-field">
        <span>Filter by</span>
        <select
          value={filter.field}
          onChange={(event) => onChange({ ...filter, field: event.target.value as TabResultFilterField })}
        >
          {tabResultFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="npi-tab-result-filter-search">
        <span>Search</span>
        <input
          type="text"
          value={filter.text}
          placeholder="Filters as you type (e.g. org name, 727893 for phone)..."
          onChange={(event) => {
            onChange({ ...filter, text: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </label>
    </div>
  );
}

function SearchPaginationBar({
  label,
  meta,
  loading,
  onPageChange
}: {
  label: string;
  meta: SearchPaginationMeta;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const canPrev = meta.page > 1;
  const canNext = meta.totalPages > 0 && meta.page < meta.totalPages;

  return (
    <div className="npi-pagination">
      <div className="npi-pagination-meta">
        <strong>{label}</strong>
        <span>
          Page {meta.page} of {meta.totalPages || 1}
          {meta.total ? ` · ${meta.total} total` : ''}
        </span>
      </div>
      <div className="npi-pagination-actions">
        <button type="button" disabled={loading || !canPrev} onClick={() => onPageChange(meta.page - 1)}>
          Previous
        </button>
        <button type="button" disabled={loading || !canNext} onClick={() => onPageChange(meta.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}


export default function NpiRegisteryPage() {
  const [npi, setNpi] = useState('');
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [choices, setChoices] = useState<Record<string, SourceName>>({});
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState('');
  const [searchFilters, setSearchFilters] = useState<NpiSearchFilters>({
    npiNumber: '',
    npiType: 'Any',
    taxonomyDescription: '',
    city: '',
    postalCode: '',
    address1: '',
    phone: ''
  });
  const [activeTab, setActiveTab] = useState<ResultTab>('matched');
  const [fullResults, setFullResults] = useState<FullSearchResults | null>(null);
  const [tabPage, setTabPage] = useState(1);
  const [pageSize] = useState(10);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [searchHint, setSearchHint] = useState('');
  const [tabResultFilter, setTabResultFilter] = useState<TabResultFilter>({ field: 'all', text: '' });

  const filteredResults = useMemo(
    () => (fullResults ? filterFullSearchResults(fullResults, tabResultFilter) : null),
    [fullResults, tabResultFilter],
  );

  const searchCounts = useMemo<SearchCounts>(() => ({
    matched: filteredResults?.matched.length ?? 0,
    mapped: filteredResults?.mapped.length ?? 0,
    registryOnly: filteredResults?.registryNew.length ?? 0,
    localOnly: filteredResults?.localOnly.length ?? 0,
  }), [filteredResults]);

  const tabView = useMemo(() => {
    if (!filteredResults) {
      return {
        matchedResults: [] as MatchedPair[],
        tabItems: [] as DoctorFlat[],
        pagination: { page: 1, total: 0, totalPages: 0 } as TabPagination,
      };
    }

    const offset = (tabPage - 1) * pageSize;
    if (activeTab === 'matched') {
      const total = filteredResults.matched.length;
      return {
        matchedResults: filteredResults.matched,
        tabItems: [] as DoctorFlat[],
        pagination: { page: 1, total, totalPages: 1 },
      };
    }
    if (activeTab === 'mapped') {
      const total = filteredResults.mapped.length;
      return {
        matchedResults: filteredResults.mapped.slice(offset, offset + pageSize),
        tabItems: [] as DoctorFlat[],
        pagination: { page: tabPage, total, totalPages: paginateTotalPages(total, pageSize) },
      };
    }
    if (activeTab === 'registry-only') {
      const total = filteredResults.registryNew.length;
      return {
        matchedResults: [] as MatchedPair[],
        tabItems: filteredResults.registryNew.slice(offset, offset + pageSize),
        pagination: { page: tabPage, total, totalPages: paginateTotalPages(total, pageSize) },
      };
    }
    const total = filteredResults.localOnly.length;
    return {
      matchedResults: [] as MatchedPair[],
      tabItems: filteredResults.localOnly.slice(offset, offset + pageSize),
      pagination: { page: tabPage, total, totalPages: paginateTotalPages(total, pageSize) },
    };
  }, [filteredResults, activeTab, tabPage, pageSize]);

  const { matchedResults, tabItems, pagination: tabPagination } = tabView;

  useEffect(() => {
    setTabPage(1);
  }, [tabResultFilter.field, tabResultFilter.text, activeTab]);

  const taxonomyChoices = useMemo(
    () => allTaxonomyRows(lookup?.master || null, lookup?.registry || null),
    [lookup],
  );
  const chosenTaxonomy = taxonomyChoices.find((row) => row.id === selectedTaxonomyId) || taxonomyChoices[0] || null;

  const selectedValues = useMemo(() => {
    const values = buildSelectedValues(lookup?.master || null, lookup?.registry || null, choices);
    if (!chosenTaxonomy) return values;
    return {
      ...values,
      taxonomyCode: chosenTaxonomy.code,
      taxonomyDesc: chosenTaxonomy.desc,
      licenseNumber: chosenTaxonomy.license,
      taxonomyState: chosenTaxonomy.state,
      primaryTaxonomy: chosenTaxonomy.primary,
      selectedTaxonomy: [chosenTaxonomy.code, chosenTaxonomy.desc].filter(Boolean).join(' - '),
      taxonomyChoiceId: chosenTaxonomy.id,
      taxonomySource: chosenTaxonomy.source,
    };
  }, [lookup, choices, chosenTaxonomy]);

  const comparisonStats = useMemo(() => {
    const rows = fieldLabels.map((field) => getRow(lookup, field.key, field.label));
    const matched = rows.filter((row) => row.match).length;
    const mismatched = rows.filter((row) => !row.match).length;
    const selectedMaster = Object.values(choices).filter((source) => source === 'MASTER_DOCTOR').length;
    const selectedRegistry = Object.values(choices).filter((source) => source === 'NPI_REGISTRY').length;
    return { total: rows.length, matched, mismatched, selectedMaster, selectedRegistry };
  }, [lookup, choices]);

  async function lookupByNpi(targetNpi?: string) {
    const cleanNpi = String(targetNpi || npi).replace(/\D/g, '');
    if (cleanNpi.length !== 10) {
      setMessage('Enter a valid 10 digit NPI.');
      return;
    }

    setLookupLoading(true);
    setMessage('');
    try {
      const res = await api.get(`/npi-registery/doctor/${cleanNpi}`);
      const data: LookupResponse = res.data;
      setLookup({
        ...data,
        master: withDerivedDoctorFields(data.master),
        registry: withDerivedDoctorFields(data.registry)
      });
      setNpi(cleanNpi);

      const defaultChoices: Record<string, SourceName> = {};
      for (const row of data.comparison || []) defaultChoices[String(row.key)] = row.defaultChoice || 'NPI_REGISTRY';
      setChoices(defaultChoices);
      const taxonomyRows = allTaxonomyRows(
        withDerivedDoctorFields(data.master),
        withDerivedDoctorFields(data.registry),
      );
      setSelectedTaxonomyId(pickTaxonomyId(taxonomyRows, data.existingConfig));
    } catch (e: any) {
      setMessage(e?.response?.data?.message || 'Lookup failed. Check backend connection and login.');
    } finally {
      setLookupLoading(false);
    }
  }

  function registryAnchorFilters() {
    return [
      searchFilters.npiNumber,
      searchFilters.taxonomyDescription,
      searchFilters.city,
      searchFilters.postalCode
    ].some((value) => String(value || '').trim().length > 0);
  }

  async function runFullSearch() {
    const hasAnyFilter = [
      searchFilters.npiNumber,
      searchFilters.taxonomyDescription,
      searchFilters.city,
      searchFilters.postalCode,
      searchFilters.address1,
      searchFilters.phone
    ].some((value) => String(value || '').trim().length > 0);

    if (!hasAnyFilter) {
      setMessage('Enter at least one filter before searching.');
      setSearchHint('');
      return;
    }

    const usesStreetOrPhone = Boolean(
      String(searchFilters.address1 || '').trim() || String(searchFilters.phone || '').trim()
    );
    if (usesStreetOrPhone && !registryAnchorFilters()) {
      setSearchHint('Add City, Postal Code, NPI, or Taxonomy so NPI Registry can search first, then narrow by Street or Phone.');
    } else {
      setSearchHint('');
    }

    setSearchLoading(true);
    setMessage('');
    try {
      const res = await api.get('/npi-registery/search', {
        params: {
          npi: searchFilters.npiNumber,
          npiType: searchFilters.npiType,
          taxonomyDescription: searchFilters.taxonomyDescription,
          city: searchFilters.city,
          postalCode: searchFilters.postalCode,
          address1: searchFilters.address1,
          phone: searchFilters.phone,
          resultTab: 'matched',
          page: 1,
          limit: pageSize,
          includeFullResults: true
        }
      });

      const full = res.data.fullResults;
      if (full) {
        setFullResults({
          matched: full.matched || [],
          mapped: full.mapped || [],
          registryNew: full.registryNew || [],
          localOnly: full.localOnly || [],
        });
      } else {
        setFullResults({
          matched: res.data.matched || [],
          mapped: res.data.mapped || [],
          registryNew: res.data.items || [],
          localOnly: res.data.items || [],
        });
      }

      setActiveTab('matched');
      setTabPage(1);
      setTabResultFilter({ field: 'all', text: '' });
      if (res.data.registryHint) setSearchHint(String(res.data.registryHint));
      setHasSearched(true);
    } catch (e: any) {
      setMessage(e?.response?.data?.message || 'Search failed.');
    } finally {
      setSearchLoading(false);
    }
  }

  async function searchDoctors() {
    await runFullSearch();
  }

  function changeTab(tab: ResultTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setTabPage(1);
  }

  function changeTabPage(page: number) {
    setTabPage(page);
  }

  function setAll(source: SourceName) {
    const next: Record<string, SourceName> = {};
    for (const field of fieldLabels) next[String(field.key)] = source;
    setChoices(next);
  }

  function setSection(source: SourceName, section: ComparisonSection) {
    const next = { ...choices };
    for (const field of section.fields) next[String(field.key)] = source;
    setChoices(next);
  }

  async function saveSelected() {
    if (!lookup?.npi) return;
    setSaving(true);
    setMessage('');
    try {
      const user = typeof window !== 'undefined' ? localStorage.getItem('username') || localStorage.getItem('email') || 'admin' : 'admin';
      await api.post('/npi-registery/save', {
        npi: lookup.npi,
        masterDoctorId: lookup.master?.masterDoctorId || null,
        selectedSource: 'MIXED',
        selectedValues,
        master: lookup.master,
        registry: lookup.registry,
        comparison: lookup.comparison,
        updatedBy: user,
        createdBy: user
      });
      setMessage('Saved selected values to npiRegisteryConfig. Master_Doctor was not changed.');
      await lookupByNpi(lookup.npi);
    } catch (e: any) {
      setMessage(e?.response?.data?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="npi-page">
      <PageHeader
        eyebrow="Data & reports"
        title="NPI Registry"
        subtitle="Search providers in the local Master_Doctor table and the NPI Registry side by side, see which are matched or mapped to a practice, and review address and contact differences for a single NPI. Saving writes your field choices to npiRegisteryConfig — Master_Doctor is never changed."
        actions={lookup?.existingConfig ? <span className="badge badge-success badge-dot">Previously saved</span> : null}
      />
      {/* <div className="npi-hero-actions">
        <input placeholder="Enter 10 digit NPI" value={npi} onChange={(e) => setNpi(e.target.value)} />
        <button type="button" onClick={() => lookupByNpi()} disabled={loading}>{loading ? 'Loading...' : 'Lookup NPI'}</button>
      </div> */}

      {message ? <div className="npi-card npi-message">{message}</div> : null}

      <section className="npi-card">
        <div className="npi-section-title">
          <div>
            <h2>Search providers</h2>
            <small>
              City and Postal Code search both local and NPI Registry. Street and Phone search local directly;
              for NPI Registry they refine results after City, Postal Code, NPI, or Taxonomy is used.
            </small>
          </div>
        </div>

        <div className="npi-toolbar">
          <label>
            NPI Number
            <input
              placeholder="10-digit NPI"
              value={searchFilters.npiNumber}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, npiNumber: e.target.value }))}
            />
          </label>
          <label>
            NPI Type
            <select
              className="npi-type-select"
              value={searchFilters.npiType}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, npiType: e.target.value }))}
            >
              <option>Any</option>
              <option>Individual</option>
              <option>Organization</option>
            </select>
          </label>
          <label>
            Taxonomy Description
            <input
              placeholder="e.g. Internal Medicine"
              value={searchFilters.taxonomyDescription}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, taxonomyDescription: e.target.value }))}
            />
          </label>
          <label>
            Phone Number
            <input
              placeholder="8135551234 · with City/ZIP"
              value={searchFilters.phone}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </label>
          <label>
            Street Address
            <input
              placeholder="123 Main St · with City/ZIP"
              value={searchFilters.address1}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, address1: e.target.value }))}
            />
          </label>
          <label>
            City
            <input
              placeholder="e.g. St Petersburg"
              value={searchFilters.city}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, city: e.target.value }))}
            />
          </label>
          <label>
            Postal Code
            <input
              placeholder="e.g. 33701"
              value={searchFilters.postalCode}
              onChange={(e) => setSearchFilters((prev) => ({ ...prev, postalCode: e.target.value }))}
            />
          </label>
          <div className="npi-toolbar-action">
            <button
              type="button"
              className="npi-primary-btn npi-search-btn"
              onClick={() => void searchDoctors()}
              disabled={searchLoading}
            >
              {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {searchHint ? <div className="npi-search-hint">{searchHint}</div> : null}

        {hasSearched ? (
          <div className="npi-search-results">
            <div className="npi-result-tabs">
              {(Object.keys(resultTabLabels) as ResultTab[]).map((tab) => {
                const count = tab === 'matched'
                  ? searchCounts.matched
                  : tab === 'mapped'
                    ? searchCounts.mapped
                    : tab === 'registry-only'
                      ? searchCounts.registryOnly
                      : searchCounts.localOnly;
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`npi-result-tab ${activeTab === tab ? 'npi-result-tab-active' : ''}`}
                    onClick={() => changeTab(tab)}
                    disabled={searchLoading}
                  >
                    {resultTabLabels[tab]}
                    <span className="npi-result-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="npi-tab-panel">
              <div className="npi-tab-panel-header">
                <div>
                  <h3>{resultTabLabels[activeTab]}</h3>
                  <small>
                    {activeTab === 'matched'
                      ? 'Providers found in both Master_Doctor and NPI Registry, matched by exact NPI.'
                      : activeTab === 'mapped'
                        ? 'Master_Doctor providers with an active practice mapping, shown alongside NPI Registry data when available.'
                        : activeTab === 'registry-only'
                          ? 'NPI Registry providers from this search that are not in Master_Doctor yet (excluding Matched Items).'
                          : 'Master_Doctor providers not found in the current NPI Registry search results.'}
                  </small>
                </div>
                <span className={`npi-chip ${activeTab === 'local-only' ? 'npi-chip-master' : activeTab === 'registry-only' ? 'npi-chip-registry' : activeTab === 'mapped' ? 'npi-chip-mapped' : 'npi-chip-soft'}`}>
                  {tabPagination.total}
                </span>
              </div>

              <TabResultFilterBar
                filter={tabResultFilter}
                onChange={setTabResultFilter}
              />

              {activeTab === 'matched' || activeTab === 'mapped' ? (
                <div className={`npi-matched-list ${activeTab === 'matched' ? 'npi-matched-list-scroll' : ''}`}>
                  {matchedResults.map((pair, index) => (
                    <MatchedResultRow
                      key={`${activeTab}-${pair.local.npi || pair.local.masterDoctorId || index}`}
                      pair={pair}
                      onSelect={(npi) => void lookupByNpi(npi)}
                    />
                  ))}
                  {!matchedResults.length ? (
                    <div className="npi-empty-result">
                      {tabResultFilter.text.trim()
                        ? 'No results match this tab filter. Try another field or clear the search box.'
                        : activeTab === 'mapped'
                          ? 'No practice-mapped Master_Doctor providers found for this search.'
                          : 'No matched providers found for this search.'}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="npi-result-list">
                  {tabItems.map((doc, index) => (
                    <DoctorResultCard
                      key={`${activeTab}-${doc.npi ?? doc.masterDoctorId ?? index}`}
                      doc={doc}
                      variant={activeTab === 'local-only' ? 'master' : 'registry'}
                      onSelect={() => void lookupByNpi(doc.npi || '')}
                    />
                  ))}
                  {!tabItems.length ? (
                    <div className="npi-empty-result">
                      {tabResultFilter.text.trim()
                        ? 'No results match this tab filter. Try another field or clear the search box.'
                        : activeTab === 'registry-only'
                          ? 'No new NPI Registry providers for this search — all results are already in Master_Doctor or matched above.'
                          : 'No new Master_Doctor providers found for this search.'}
                    </div>
                  ) : null}
                </div>
              )}

              {activeTab === 'matched' ? null : (
                <SearchPaginationBar
                  label={resultTabLabels[activeTab]}
                  meta={tabPagination}
                  loading={false}
                  onPageChange={changeTabPage}
                />
              )}
            </div>
          </div>
        ) : null}
      </section>

      {lookup ? (
        <>
          <section className="npi-summary-grid">
            <div className="npi-card npi-source-card">
              <div className="npi-source-head">
                <div className="npi-source-title">
                  <strong>Master_Doctor</strong>
                  <span>Local address/contact record</span>
                </div>
                <span className="npi-chip npi-chip-master">Local</span>
              </div>
              <div className="npi-source-body">
                {lookup.master ? (
                  <>
                    <h3>{doctorName(lookup.master)}</h3>
                    {doctorPracticeName(lookup.master, 'master') ? (
                      <p>Practice Name: {doctorPracticeName(lookup.master, 'master')}</p>
                    ) : null}
                    <p>{doctorAddress(lookup.master) || 'No address'}</p>
                    <p>Phone: {lookup.master.phone || '—'}</p>
                    <p>NPI: {lookup.master.npi || lookup.npi}</p>
                  </>
                ) : <p>Not found in Master_Doctor.</p>}
              </div>
            </div>

            <div className="npi-card npi-source-card">
              <div className="npi-source-head">
                <div className="npi-source-title">
                  <strong>NPI Registry</strong>
                  <span>Registry address/contact response</span>
                </div>
                <span className="npi-chip npi-chip-registry">Registry</span>
              </div>
              <div className="npi-source-body">
                {lookup.registry ? (
                  <>
                    <h3>{doctorName(lookup.registry)}</h3>
                    <p>{doctorAddress(lookup.registry) || 'No address'}</p>
                    <p>Phone: {lookup.registry.phone || '—'}</p>
                    <p>Last Updated: {lookup.registry.nppesLastUpdated || '—'}</p>
                  </>
                ) : <p>Not found in NPI Registry.</p>}
              </div>
            </div>
          </section>

          <section className="npi-review">
            <div className="npi-review-head">
              <div className="npi-review-heading">
                <h2>Address &amp; Contact Review</h2>
                <p>Tap the value you want for each field, then save your selection. Master_Doctor stays unchanged until you save.</p>
              </div>

              <div className="npi-review-meter">
                <div className="npi-meter-bar" role="img" aria-label={`${comparisonStats.selectedMaster} from Master, ${comparisonStats.selectedRegistry} from NPI`}>
                  <span
                    className="npi-meter-seg npi-meter-seg-master"
                    style={{ width: `${comparisonStats.total ? (comparisonStats.selectedMaster / comparisonStats.total) * 100 : 0}%` }}
                  />
                  <span
                    className="npi-meter-seg npi-meter-seg-registry"
                    style={{ width: `${comparisonStats.total ? (comparisonStats.selectedRegistry / comparisonStats.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="npi-meter-legend">
                  <span className="npi-meter-key npi-meter-key-master">Master {comparisonStats.selectedMaster}</span>
                  <span className="npi-meter-key npi-meter-key-registry">NPI {comparisonStats.selectedRegistry}</span>
                </div>
              </div>
            </div>

            <div className="npi-review-toolbar">
              <div className="npi-review-stats">
                <span className="npi-stat-chip"><b>{comparisonStats.total}</b> fields</span>
                <span className="npi-stat-chip npi-stat-chip-match"><b>{comparisonStats.matched}</b> match</span>
                <span className="npi-stat-chip npi-stat-chip-diff"><b>{comparisonStats.mismatched}</b> differ</span>
              </div>
              <div className="npi-review-tools">
                <div className="npi-segment" role="group" aria-label="Apply to all fields">
                  <button type="button" className="npi-segment-btn npi-segment-btn-master" onClick={() => setAll('MASTER_DOCTOR')}>
                    Use all Master
                  </button>
                  <button type="button" className="npi-segment-btn npi-segment-btn-registry" onClick={() => setAll('NPI_REGISTRY')}>
                    Use all NPI
                  </button>
                </div>
              </div>
            </div>

            <div className="npi-review-sections">
              {comparisonSections.filter((section) => section.id === 'practice-addresses').map((section) => {
                const rows = section.fields.map((field) => getRow(lookup, field.key, field.label));
                const diffCount = rows.filter((row) => !row.match).length;

                return (
                  <article className="npi-review-card" key={section.id}>
                    <header className="npi-review-card-head">
                      <div className="npi-review-card-title">
                        <h3>{section.title}</h3>
                        <small>{section.subtitle}</small>
                      </div>
                      <div className="npi-review-card-tools">
                        <span className={`npi-diff-pill ${diffCount ? '' : 'npi-diff-pill-clean'}`}>
                          {diffCount ? `${diffCount} different` : 'All match'}
                        </span>
                        <div className="npi-segment npi-segment-sm" role="group" aria-label={`Apply to ${section.title}`}>
                          <button type="button" className="npi-segment-btn npi-segment-btn-master" onClick={() => setSection('MASTER_DOCTOR', section)}>Master</button>
                          <button type="button" className="npi-segment-btn npi-segment-btn-registry" onClick={() => setSection('NPI_REGISTRY', section)}>NPI</button>
                        </div>
                      </div>
                    </header>

                    <div className="npi-field-list">
                      {rows.map((row) => {
                        const selectedSource = choices[String(row.key)] || row.defaultChoice || 'NPI_REGISTRY';
                        const masterSelected = selectedSource === 'MASTER_DOCTOR';
                        const registrySelected = selectedSource === 'NPI_REGISTRY';
                        return (
                          <div className={`npi-field-row ${row.match ? 'npi-field-row-match' : 'npi-field-row-diff'}`} key={String(row.key)}>
                            <div className="npi-field-label">
                              <span className="npi-field-name">{row.label}</span>
                              <span className={`npi-field-flag ${row.match ? 'npi-field-flag-match' : 'npi-field-flag-diff'}`}>
                                {row.match ? 'Match' : 'Differs'}
                              </span>
                            </div>
                            <div className="npi-field-options">
                              <button
                                type="button"
                                className={`npi-option npi-option-master ${masterSelected ? 'is-selected' : ''}`}
                                aria-pressed={masterSelected}
                                onClick={() => setChoices((c) => ({ ...c, [String(row.key)]: 'MASTER_DOCTOR' }))}
                              >
                                <span className="npi-option-top">
                                  <span className="npi-option-tag npi-option-tag-master">Master</span>
                                  <span className="npi-option-check" aria-hidden="true">✓</span>
                                </span>
                                <span className="npi-option-value">{normalizeForEmpty(row.masterValue)}</span>
                              </button>
                              <button
                                type="button"
                                className={`npi-option npi-option-registry ${registrySelected ? 'is-selected' : ''}`}
                                aria-pressed={registrySelected}
                                onClick={() => setChoices((c) => ({ ...c, [String(row.key)]: 'NPI_REGISTRY' }))}
                              >
                                <span className="npi-option-top">
                                  <span className="npi-option-tag npi-option-tag-registry">NPI</span>
                                  <span className="npi-option-check" aria-hidden="true">✓</span>
                                </span>
                                <span className="npi-option-value">{normalizeForEmpty(row.registryValue)}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}

              <article className="npi-review-card">
                <header className="npi-review-card-head">
                  <div className="npi-review-card-title">
                    <h3>Taxonomy Review</h3>
                    <small>Every taxonomy, with Primary Yes or No, state, and license. Choose the one to save.</small>
                  </div>
                  <span className="npi-diff-pill">{taxonomyChoices.length} taxonomies</span>
                </header>
                {taxonomyChoices.length ? (
                  <div className="npi-tax-table-wrap">
                    <table className="npi-tax-table">
                      <thead>
                        <tr>
                          <th>Use</th>
                          <th>Source</th>
                          <th>Code</th>
                          <th>Taxonomy</th>
                          <th>Primary</th>
                          <th>State</th>
                          <th>License</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taxonomyChoices.map((row) => {
                          const selected = chosenTaxonomy?.id === row.id;
                          return (
                            <tr key={row.id} className={selected ? 'is-selected' : undefined}>
                              <td>
                                <button
                                  type="button"
                                  className={`npi-tax-pick ${selected ? 'is-selected' : ''}`}
                                  aria-pressed={selected}
                                  onClick={() => setSelectedTaxonomyId(row.id)}
                                >
                                  {selected ? 'Selected' : 'Choose'}
                                </button>
                              </td>
                              <td>{row.source === 'MASTER_DOCTOR' ? 'Master' : 'NPI'}</td>
                              <td>{row.code || '—'}</td>
                              <td>{row.desc || '—'}</td>
                              <td>{row.primary}</td>
                              <td>{row.state || '—'}</td>
                              <td>{row.license || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="npi-tax-empty">No taxonomies were returned for this provider.</p>
                )}
              </article>

              {comparisonSections.filter((section) => section.id !== 'practice-addresses').map((section) => {
                const rows = section.fields.map((field) => getRow(lookup, field.key, field.label));
                const diffCount = rows.filter((row) => !row.match).length;

                return (
                  <article className="npi-review-card" key={section.id}>
                    <header className="npi-review-card-head">
                      <div className="npi-review-card-title">
                        <h3>{section.title}</h3>
                        <small>{section.subtitle}</small>
                      </div>
                      <div className="npi-review-card-tools">
                        <span className={`npi-diff-pill ${diffCount ? '' : 'npi-diff-pill-clean'}`}>
                          {diffCount ? `${diffCount} different` : 'All match'}
                        </span>
                        <div className="npi-segment npi-segment-sm" role="group" aria-label={`Apply to ${section.title}`}>
                          <button type="button" className="npi-segment-btn npi-segment-btn-master" onClick={() => setSection('MASTER_DOCTOR', section)}>Master</button>
                          <button type="button" className="npi-segment-btn npi-segment-btn-registry" onClick={() => setSection('NPI_REGISTRY', section)}>NPI</button>
                        </div>
                      </div>
                    </header>

                    <div className="npi-field-list">
                      {rows.map((row) => {
                        const selectedSource = choices[String(row.key)] || row.defaultChoice || 'NPI_REGISTRY';
                        const masterSelected = selectedSource === 'MASTER_DOCTOR';
                        const registrySelected = selectedSource === 'NPI_REGISTRY';
                        return (
                          <div className={`npi-field-row ${row.match ? 'npi-field-row-match' : 'npi-field-row-diff'}`} key={String(row.key)}>
                            <div className="npi-field-label">
                              <span className="npi-field-name">{row.label}</span>
                              <span className={`npi-field-flag ${row.match ? 'npi-field-flag-match' : 'npi-field-flag-diff'}`}>
                                {row.match ? 'Match' : 'Differs'}
                              </span>
                            </div>
                            <div className="npi-field-options">
                              <button
                                type="button"
                                className={`npi-option npi-option-master ${masterSelected ? 'is-selected' : ''}`}
                                aria-pressed={masterSelected}
                                onClick={() => setChoices((c) => ({ ...c, [String(row.key)]: 'MASTER_DOCTOR' }))}
                              >
                                <span className="npi-option-top">
                                  <span className="npi-option-tag npi-option-tag-master">Master</span>
                                  <span className="npi-option-check" aria-hidden="true">✓</span>
                                </span>
                                <span className="npi-option-value">{normalizeForEmpty(row.masterValue)}</span>
                              </button>
                              <button
                                type="button"
                                className={`npi-option npi-option-registry ${registrySelected ? 'is-selected' : ''}`}
                                aria-pressed={registrySelected}
                                onClick={() => setChoices((c) => ({ ...c, [String(row.key)]: 'NPI_REGISTRY' }))}
                              >
                                <span className="npi-option-top">
                                  <span className="npi-option-tag npi-option-tag-registry">NPI</span>
                                  <span className="npi-option-check" aria-hidden="true">✓</span>
                                </span>
                                <span className="npi-option-value">{normalizeForEmpty(row.registryValue)}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="npi-save-bar">
              <div className="npi-save-summary">
                <div className="npi-save-item"><span>Address</span><strong>{[selectedValues.address1, selectedValues.address2].filter(Boolean).join(', ') || '—'}</strong></div>
                <div className="npi-save-item"><span>City / State / ZIP</span><strong>{[selectedValues.city, selectedValues.state, selectedValues.postalCode].filter(Boolean).join(', ') || '—'}</strong></div>
                <div className="npi-save-item"><span>Phone</span><strong>{selectedValues.phone || '—'}</strong></div>
                <div className="npi-save-item">
                  <span>Taxonomy to save</span>
                  <strong>
                    {chosenTaxonomy
                      ? `${chosenTaxonomy.primary === '—' ? '' : `Primary ${chosenTaxonomy.primary} · `}${[chosenTaxonomy.code, chosenTaxonomy.desc].filter(Boolean).join(' - ') || '—'}`
                      : '—'}
                  </strong>
                </div>
                <div className="npi-save-item"><span>Fax</span><strong>{selectedValues.fax || '—'}</strong></div>
              </div>
              <button type="button" className="npi-save-btn" onClick={saveSelected} disabled={saving}>
                {saving ? 'Saving…' : 'Save Selection'}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
