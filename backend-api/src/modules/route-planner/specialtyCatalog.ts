import { getPool } from '../../config/db.js';

export type ExpandableSpecialtyRule = {
  specialityRecId: number | null;
  specialityCode: string | null;
  description: string | null;
  taxonomyCodes?: string[];
};

export type UnifiedSpecialty = {
  RecID: number;
  SpecialityCode: string;
  Description: string;
  source: 'local' | 'npi' | 'matched';
  taxonomyCodes: string[];
  npiDescriptions: string[];
};

type LocalSpecialty = {
  RecID: number;
  SpecialityCode: string;
  Description: string;
};

type NpiTaxonomy = {
  TaxonomyCode: string;
  TaxonomyDescription: string;
};

type NuccMapRow = {
  taxonomyCode: string | null;
  taxonomyDescPattern: string | null;
  specialityRecId: number;
};

/** Local MDP codes that are routing flags, not clinical specialties. */
const ROUTING_CODES = new Set(['RR']);

/**
 * Local Master_PrsSpecialitiesList code → NPI taxonomy description needles.
 * Needles match TaxonomyDescription (case-insensitive contains).
 */
const LOCAL_TO_NPI_NEEDLES: Record<string, string[]> = {
  CAR: ['cardiovascular disease', 'interventional cardiology', 'cardiac electrophysiology', 'pediatric cardiology', 'cardiothoracic'],
  ENDO: ['endocrin'],
  DER: ['dermatol'],
  GAS: ['gastroenter'],
  GYN: ['gynecol', 'obstetrics & gynecology', 'obstetrics and gynecology'],
  ID: ['infectious disease'],
  NEP: ['nephrol'],
  NEU: ['neurology', 'neurologist', 'child neurology', 'pediatric neurology'],
  OPT: ['ophthalm'],
  PM: ['pain medicine', 'pain management', 'interventional pain'],
  PCP: ['family medicine', 'primary care'],
  PSY: ['psychiatr'],
  PUL: ['pulmonary'],
  RHE: ['rheumatol'],
  URO: ['urolog'],
};

const PCP_EXACT_TAXONOMY_CODES = new Set(['207Q00000X', '207R00000X', '261QP2300X', '363LP2300X']);

/** The 15 clinical specialties shown in Flyer Builder. Unknown-provider search uses only these. */
const TRACKED_DOCTOR_SPECIALTIES: { code: string; label: string }[] = [
  { code: 'CAR', label: 'cardiologist' },
  { code: 'ENDO', label: 'endocrinologist' },
  { code: 'PCP', label: 'primary care' },
  { code: 'PSY', label: 'psychiatrist' },
  { code: 'PM', label: 'pain management' },
  { code: 'DER', label: 'dermatology' },
  { code: 'GAS', label: 'gastroenterology' },
  { code: 'NEU', label: 'neurologist' },
  { code: 'GYN', label: 'gynecologist' },
  { code: 'OPT', label: 'ophthalmologist' },
  { code: 'PUL', label: 'pulmonologist' },
  { code: 'URO', label: 'urologist' },
  { code: 'ID', label: 'infectious disease' },
  { code: 'RHE', label: 'rheumatologist' },
  { code: 'NEP', label: 'nephrologist' },
];

function normalize(value: unknown) {
  return String(value || '').trim();
}

function normalizeCode(value: unknown) {
  return normalize(value).toUpperCase();
}

function isNpiTaxonomyCode(value: string | null | undefined) {
  return /^[0-9]{3}[A-Z0-9]{7,}$/i.test(String(value || '').trim());
}

function descMatchesNeedles(description: string, needles: string[]) {
  const haystack = description.toLowerCase();
  return needles.some((needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}`, 'i').test(haystack);
  });
}

/** True when an NPI taxonomy is one of the 15 doctor specialties. */
export function matchesTrackedDoctorSpecialty(
  taxonomyCode?: string | null,
  taxonomyDescription?: string | null,
) {
  const code = normalizeCode(taxonomyCode);
  const description = normalize(taxonomyDescription).toLowerCase();
  if (TRACKED_DOCTOR_SPECIALTIES.some((specialty) => specialty.code === code)) return true;
  return TRACKED_DOCTOR_SPECIALTIES.some((specialty) => {
    if (npiTaxonomyMatchesSpecialty(specialty.code, taxonomyCode, taxonomyDescription)) return true;
    return description.includes(specialty.label);
  });
}

export function npiTaxonomyMatchesSpecialty(
  specialityCode: string,
  taxonomyCode?: string | null,
  taxonomyDescription?: string | null,
) {
  return npiMatchesLocal(
    { RecID: 0, SpecialityCode: specialityCode, Description: '' },
    {
      TaxonomyCode: normalize(taxonomyCode),
      TaxonomyDescription: normalize(taxonomyDescription),
    },
  );
}

function npiMatchesLocal(local: LocalSpecialty, taxonomy: NpiTaxonomy) {
  const code = normalizeCode(local.SpecialityCode);
  const taxCode = normalizeCode(taxonomy.TaxonomyCode);
  const taxDesc = taxonomy.TaxonomyDescription;

  if (code === 'PCP') {
    if (PCP_EXACT_TAXONOMY_CODES.has(taxCode)) return true;
    const lower = taxDesc.toLowerCase();
    if (lower === 'family medicine' || lower === 'internal medicine') return true;
    if (lower.includes('primary care')) return true;
    if (lower.startsWith('family medicine,')) return true;
    return false;
  }

  const needles = LOCAL_TO_NPI_NEEDLES[code];
  if (!needles?.length) {
    const localDesc = local.Description.toLowerCase().replace(/s\s*$/, '');
    return localDesc.length >= 4 && taxDesc.toLowerCase().includes(localDesc);
  }
  return descMatchesNeedles(taxDesc, needles);
}

function mapPatternMatches(pattern: string, taxonomyDesc: string) {
  const needle = pattern.replace(/%/g, '').trim().toLowerCase();
  return needle.length > 0 && taxonomyDesc.toLowerCase().includes(needle);
}

export async function loadUnifiedSpecialties(): Promise<UnifiedSpecialty[]> {
  const pool = await getPool();

  const [localResult, npiResult, mapResult] = await Promise.all([
    pool.request().query(`
      SELECT RecID, SpecialityCode, Description
      FROM dbo.Master_PrsSpecialitiesList
      WHERE ISNULL(IsActive, 1) = 1
        AND NULLIF(LTRIM(RTRIM(SpecialityCode)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(Description)), '') IS NOT NULL
      ORDER BY Description
    `),
    pool.request().query(`
      SELECT DISTINCT
        LTRIM(RTRIM(TaxonomyCode)) AS TaxonomyCode,
        LTRIM(RTRIM(TaxonomyDescription)) AS TaxonomyDescription
      FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy
      WHERE IsPrimary = 1
        AND NULLIF(LTRIM(RTRIM(TaxonomyCode)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(TaxonomyDescription)), '') IS NOT NULL
    `),
    pool.request().query(`
      SELECT
        NULLIF(LTRIM(RTRIM(TaxonomyCode)), '') AS TaxonomyCode,
        NULLIF(LTRIM(RTRIM(TaxonomyDescPattern)), '') AS TaxonomyDescPattern,
        SpecialityRecID
      FROM dbo.PharmacyFlyer_NuccSpecialtyMap
      WHERE IsActive = 1
    `).catch(() => ({ recordset: [] })),
  ]);

  const localRows: LocalSpecialty[] = (localResult.recordset as Record<string, unknown>[])
    .map((row) => ({
      RecID: Number(row.RecID),
      SpecialityCode: normalize(row.SpecialityCode),
      Description: normalize(row.Description),
    }))
    .filter((row) => row.RecID > 0 && !ROUTING_CODES.has(normalizeCode(row.SpecialityCode)));

  const npiRows: NpiTaxonomy[] = (npiResult.recordset as Record<string, unknown>[]).map((row) => ({
    TaxonomyCode: normalizeCode(row.TaxonomyCode),
    TaxonomyDescription: normalize(row.TaxonomyDescription),
  }));

  const mapRows: NuccMapRow[] = (mapResult.recordset as Record<string, unknown>[]).map((row) => ({
    taxonomyCode: row.TaxonomyCode != null ? normalizeCode(row.TaxonomyCode) : null,
    taxonomyDescPattern: row.TaxonomyDescPattern != null ? String(row.TaxonomyDescPattern) : null,
    specialityRecId: Number(row.SpecialityRecID),
  }));

  const unified: UnifiedSpecialty[] = [];

  for (const local of localRows) {
    const fromMap = npiRows.filter((taxonomy) =>
      mapRows.some((mapping) => {
        if (mapping.specialityRecId !== local.RecID) return false;
        if (mapping.taxonomyCode && mapping.taxonomyCode === taxonomy.TaxonomyCode) return true;
        if (mapping.taxonomyDescPattern && mapPatternMatches(mapping.taxonomyDescPattern, taxonomy.TaxonomyDescription)) {
          return true;
        }
        return false;
      }),
    );
    const fromKeywords = npiRows.filter((taxonomy) => npiMatchesLocal(local, taxonomy));
    const matched = new Map<string, NpiTaxonomy>();
    for (const row of [...fromMap, ...fromKeywords]) {
      matched.set(row.TaxonomyCode, row);
    }

    const taxonomyCodes = [...matched.keys()];

    unified.push({
      RecID: local.RecID,
      SpecialityCode: local.SpecialityCode,
      Description: local.Description,
      source: taxonomyCodes.length ? 'matched' : 'local',
      taxonomyCodes,
      npiDescriptions: [...matched.values()].map((row) => `${row.TaxonomyCode} — ${row.TaxonomyDescription}`),
    });
  }

  return unified;
}

export function expandSpecialtyRules<T extends ExpandableSpecialtyRule>(
  rules: T[],
  catalog: UnifiedSpecialty[],
): T[] {
  return rules.map((rule) => {
    const recId = rule.specialityRecId != null && rule.specialityRecId > 0 ? rule.specialityRecId : null;
    const code = normalizeCode(rule.specialityCode);
    const desc = normalize(rule.description).toLowerCase();

    const hit = catalog.find((item) => {
      if (recId && item.RecID === recId) return true;
      if (code && (normalizeCode(item.SpecialityCode) === code || item.taxonomyCodes.includes(code))) return true;
      if (desc && item.Description.toLowerCase() === desc) return true;
      if (desc && item.npiDescriptions.some((label) => label.toLowerCase().includes(desc))) return true;
      return false;
    });

    if (!hit) {
      return {
        ...rule,
        taxonomyCodes: isNpiTaxonomyCode(rule.specialityCode) ? [normalizeCode(rule.specialityCode)] : [],
      };
    }

    return {
      ...rule,
      specialityRecId: hit.RecID > 0 ? hit.RecID : rule.specialityRecId,
      specialityCode: hit.SpecialityCode || rule.specialityCode,
      description: hit.Description || rule.description,
      taxonomyCodes: hit.taxonomyCodes.length
        ? hit.taxonomyCodes
        : (isNpiTaxonomyCode(rule.specialityCode) ? [normalizeCode(rule.specialityCode)] : []),
    };
  });
}
