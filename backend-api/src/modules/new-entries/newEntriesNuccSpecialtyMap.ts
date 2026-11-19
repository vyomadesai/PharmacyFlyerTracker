import { getPool } from '../../config/db.js';

export type NuccSpecialtyMapping = {
  nuccSpecialtyMapId: number;
  taxonomyCode: string | null;
  taxonomyDescPattern: string | null;
  specialityRecId: number;
  specialityCode: string | null;
  specialityDescription: string | null;
  priority: number;
};

export type TaxonomyInput = {
  code: string | null;
  desc: string | null;
};

function normalizeNuccCode(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function normalizeDesc(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function descPatternMatches(pattern: string | null, taxonomyDesc: string | null) {
  const needle = normalizeDesc(pattern).replace(/%/g, '');
  const haystack = normalizeDesc(taxonomyDesc);
  if (!needle || !haystack) return false;
  return haystack.includes(needle);
}

export async function loadActiveNuccSpecialtyMappings(): Promise<NuccSpecialtyMapping[]> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        m.NuccSpecialtyMapId,
        m.TaxonomyCode,
        m.TaxonomyDescPattern,
        m.SpecialityRecID,
        m.Priority,
        sl.SpecialityCode,
        sl.Description AS SpecialityDescription
      FROM dbo.PharmacyFlyer_NuccSpecialtyMap m
      INNER JOIN dbo.Master_PrsSpecialitiesList sl
        ON sl.RecID = m.SpecialityRecID
        AND ISNULL(sl.IsActive, 1) = 1
      WHERE m.IsActive = 1
      ORDER BY m.Priority DESC, m.NuccSpecialtyMapId
    `);

    return (result.recordset as Record<string, unknown>[]).map((row) => ({
      nuccSpecialtyMapId: Number(row.NuccSpecialtyMapId),
      taxonomyCode: row.TaxonomyCode != null ? normalizeNuccCode(row.TaxonomyCode) : null,
      taxonomyDescPattern: row.TaxonomyDescPattern != null ? String(row.TaxonomyDescPattern).trim() : null,
      specialityRecId: Number(row.SpecialityRecID),
      specialityCode: row.SpecialityCode != null ? String(row.SpecialityCode).trim() : null,
      specialityDescription: row.SpecialityDescription != null ? String(row.SpecialityDescription).trim() : null,
      priority: Number(row.Priority) || 0,
    }));
  } catch {
    return [];
  }
}

export function resolveSpecialityRecIdsFromTaxonomies(
  taxonomies: TaxonomyInput[],
  mappings: NuccSpecialtyMapping[],
): Array<{
  specialityRecId: number;
  specialityCode: string | null;
  specialityDescription: string | null;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  priority: number;
}> {
  const hits = new Map<number, {
    specialityRecId: number;
    specialityCode: string | null;
    specialityDescription: string | null;
    taxonomyCode: string | null;
    taxonomyDesc: string | null;
    priority: number;
  }>();

  for (const taxonomy of taxonomies) {
    const code = taxonomy.code ? normalizeNuccCode(taxonomy.code) : null;
    const desc = taxonomy.desc ? String(taxonomy.desc).trim() : null;
    if (!code && !desc) continue;

    for (const mapping of mappings) {
      const codeMatch = Boolean(code && mapping.taxonomyCode && code === mapping.taxonomyCode);
      const descMatch = Boolean(
        mapping.taxonomyDescPattern
        && desc
        && descPatternMatches(mapping.taxonomyDescPattern, desc),
      );
      if (!codeMatch && !descMatch) continue;

      const existing = hits.get(mapping.specialityRecId);
      if (existing && existing.priority >= mapping.priority) continue;

      hits.set(mapping.specialityRecId, {
        specialityRecId: mapping.specialityRecId,
        specialityCode: mapping.specialityCode,
        specialityDescription: mapping.specialityDescription,
        taxonomyCode: code,
        taxonomyDesc: desc,
        priority: mapping.priority,
      });
    }
  }

  return Array.from(hits.values()).sort((a, b) => b.priority - a.priority);
}

export async function resolveSpecialityRecIdsFromTaxonomyLists(
  taxonomyCodes: string[],
  taxonomyDescs: string[],
) {
  const taxonomies: TaxonomyInput[] = [];
  taxonomyCodes.forEach((code, index) => {
    taxonomies.push({
      code: code || null,
      desc: taxonomyDescs[index] || null,
    });
  });
  taxonomyDescs.forEach((desc, index) => {
    if (!String(desc || '').trim()) return;
    taxonomies.push({
      code: taxonomyCodes[index] || null,
      desc,
    });
  });

  const uniqueTaxonomies = new Map<string, TaxonomyInput>();
  for (const item of taxonomies) {
    const key = `${item.code || ''}|${item.desc || ''}`;
    if (!uniqueTaxonomies.has(key)) uniqueTaxonomies.set(key, item);
  }

  const mappings = await loadActiveNuccSpecialtyMappings();
  return resolveSpecialityRecIdsFromTaxonomies([...uniqueTaxonomies.values()], mappings);
}
