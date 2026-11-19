import { getPool, sql } from '../../config/db.js';
import {
  loadActiveNuccSpecialtyMappings,
  resolveSpecialityRecIdsFromTaxonomies,
} from '../new-entries/newEntriesNuccSpecialtyMap.js';
import { npiTaxonomyMatchesSpecialty } from '../route-planner/specialtyCatalog.js';
import type { UnifiedLocationEntity } from './unifiedLocationEntities.js';

export type MatchedFlyerHint = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  matchReason: string;
};

export type RecommendedFlyer = MatchedFlyerHint & {
  doctorNames: string[];
};

export type DoctorSpecialty = {
  code: string | null;
  description: string | null;
  level: string | null;
};

type CampaignFlyerRule = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  specialityRecId: number | null;
  specialityCode: string | null;
  description: string | null;
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function looksLikeSpecialtyCode(value: string | null | undefined) {
  return /^[A-Z]{2,8}$/i.test(String(value || '').trim());
}

function flyerDisplayTitle(campaignName: string, flyerTitle: string | null) {
  return String(flyerTitle || campaignName || '').trim();
}

function specialtyLabel(spec: DoctorSpecialty) {
  const code = clean(spec.code);
  const description = clean(spec.description);
  if (code && description && normalize(description) !== normalize(code)) {
    return `${code} · ${description}`;
  }
  return description || code || '';
}

export function formatSpecialtyLabel(code?: string | null, description?: string | null) {
  return specialtyLabel({ code: code || null, description: description || null, level: null });
}

export async function loadDoctorSpecialties(doctorIds: number[]): Promise<Map<number, DoctorSpecialty[]>> {
  const ids = [...new Set(doctorIds.filter((id) => Number.isFinite(id) && id > 0))];
  const byDoctor = new Map<number, DoctorSpecialty[]>();
  if (!ids.length) return byDoctor;

  const pool = await getPool();
  const request = pool.request();
  const params = ids.map((id, index) => {
    request.input(`DoctorId${index}`, sql.Int, id);
    return `@DoctorId${index}`;
  });

  const result = await request.query(`
    SELECT
      d.ID AS DoctorId,
      NULLIF(LTRIM(RTRIM(ISNULL(sl.SpecialityCode, ''))), '') AS SpecialityCode,
      NULLIF(LTRIM(RTRIM(ISNULL(sl.Description, ''))), '') AS SpecialityDescription,
      NULLIF(LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))), '') AS MatchLevel
    FROM dbo.Master_Doctor d
    INNER JOIN dbo.Master_PrescribSpeciality ps
      ON ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
      AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
    INNER JOIN dbo.Master_PrsSpecialitiesList sl
      ON sl.RecID = ps.SpecialityID
      AND ISNULL(sl.IsActive, 1) = 1
    WHERE d.ID IN (${params.join(', ')})
    ORDER BY
      CASE
        WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) IN ('1', 'P', 'Primary') THEN 0
        WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) = '2' THEN 1
        ELSE 2
      END,
      sl.SpecialityCode
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const doctorId = Number(row.DoctorId);
    if (!Number.isFinite(doctorId) || doctorId <= 0) continue;
    const list = byDoctor.get(doctorId) || [];
    list.push({
      code: clean(row.SpecialityCode),
      description: clean(row.SpecialityDescription),
      level: clean(row.MatchLevel),
    });
    byDoctor.set(doctorId, list);
  }

  return byDoctor;
}

export async function loadActiveCampaignFlyerRules(): Promise<CampaignFlyerRule[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      c.CampaignId,
      c.CampaignName,
      c.FlyerTitle,
      cs.SpecialityRecID,
      COALESCE(NULLIF(LTRIM(RTRIM(cs.SpecialityCode)), ''), sl.SpecialityCode) AS SpecialityCode,
      COALESCE(NULLIF(LTRIM(RTRIM(cs.Description)), ''), sl.Description) AS Description
    FROM dbo.PharmacyFlyer_Campaign c
    INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      ON cs.CampaignId = c.CampaignId
      AND cs.IsActive = 1
    LEFT JOIN dbo.Master_PrsSpecialitiesList sl
      ON sl.RecID = cs.SpecialityRecID
    WHERE c.IsActive = 1
    ORDER BY c.CampaignName, cs.CampaignSpecialtyV2Id
  `);

  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    campaignId: Number(row.CampaignId),
    campaignName: String(row.CampaignName || ''),
    flyerTitle: clean(row.FlyerTitle),
    specialityRecId: row.SpecialityRecID != null ? Number(row.SpecialityRecID) : null,
    specialityCode: clean(row.SpecialityCode),
    description: clean(row.Description),
  })).filter((row) => Number.isFinite(row.campaignId) && row.campaignId > 0);
}

function tokensForEntity(input: {
  specialty?: string | null;
  taxonomyCode?: string | null;
  extraSpecialties?: DoctorSpecialty[];
}) {
  const codes = new Set<string>();
  const descs = new Set<string>();

  const addCode = (value?: string | null) => {
    const code = normalizeCode(value);
    if (code) codes.add(code);
  };
  const addDesc = (value?: string | null) => {
    const desc = clean(value);
    if (desc) descs.add(desc);
  };

  if (looksLikeSpecialtyCode(input.specialty)) addCode(input.specialty);
  else addDesc(input.specialty);
  addCode(input.taxonomyCode);

  for (const spec of input.extraSpecialties || []) {
    addCode(spec.code);
    addDesc(spec.description);
  }

  return { codes, descs };
}

function ruleMatchesTokens(
  rule: CampaignFlyerRule,
  tokens: { codes: Set<string>; descs: Set<string> },
  mappedRecIds: Set<number>,
): string | null {
  const ruleCode = normalizeCode(rule.specialityCode);
  const ruleDesc = normalize(rule.description);

  if (rule.specialityRecId && mappedRecIds.has(rule.specialityRecId)) {
    return specialtyLabel({
      code: rule.specialityCode,
      description: rule.description,
      level: null,
    }) || 'Mapped specialty';
  }

  if (ruleCode && tokens.codes.has(ruleCode)) {
    return specialtyLabel({ code: rule.specialityCode, description: rule.description, level: null }) || ruleCode;
  }

  if (ruleDesc) {
    for (const desc of tokens.descs) {
      const haystack = normalize(desc);
      if (haystack.includes(ruleDesc) || ruleDesc.includes(haystack)) {
        return rule.description || desc;
      }
    }
  }

  if (ruleCode) {
    for (const desc of tokens.descs) {
      if (npiTaxonomyMatchesSpecialty(ruleCode, null, desc)) {
        return `${desc} → ${ruleCode}`;
      }
    }
    for (const code of tokens.codes) {
      if (npiTaxonomyMatchesSpecialty(ruleCode, code, null)) {
        return `${code} → ${ruleCode}`;
      }
    }
  }

  return null;
}

export function matchFlyersForSpecialty(input: {
  rules: CampaignFlyerRule[];
  specialty?: string | null;
  taxonomyCode?: string | null;
  extraSpecialties?: DoctorSpecialty[];
  mappedRecIds?: Set<number>;
}): MatchedFlyerHint[] {
  const tokens = tokensForEntity(input);
  if (!tokens.codes.size && !tokens.descs.size && !input.mappedRecIds?.size) return [];

  const mappedRecIds = input.mappedRecIds || new Set<number>();
  const byCampaign = new Map<number, MatchedFlyerHint>();

  for (const rule of input.rules) {
    if (byCampaign.has(rule.campaignId)) continue;
    const matchReason = ruleMatchesTokens(rule, tokens, mappedRecIds);
    if (!matchReason) continue;
    byCampaign.set(rule.campaignId, {
      campaignId: rule.campaignId,
      campaignName: rule.campaignName,
      flyerTitle: rule.flyerTitle,
      matchReason,
    });
  }

  return Array.from(byCampaign.values()).sort((a, b) => a.campaignName.localeCompare(b.campaignName));
}

export async function attachSpecialtyMatchedFlyers(
  entities: UnifiedLocationEntity[],
  specialtiesByDoctorId: Map<number, DoctorSpecialty[]>,
): Promise<{ entities: UnifiedLocationEntity[]; recommendedFlyers: RecommendedFlyer[] }> {
  const rules = await loadActiveCampaignFlyerRules();
  const mappings = await loadActiveNuccSpecialtyMappings();

  const recommendedByCampaign = new Map<number, RecommendedFlyer>();

  const nextEntities = entities.map((entity) => {
    if (entity.isOrganization) return entity;

    const extraSpecialties = entity.doctorId ? specialtiesByDoctorId.get(entity.doctorId) || [] : [];
    const mapped = resolveSpecialityRecIdsFromTaxonomies(
      [
        { code: entity.taxonomyCode, desc: entity.specialty },
        ...extraSpecialties.map((spec) => ({ code: spec.code, desc: spec.description })),
      ],
      mappings,
    );
    const mappedRecIds = new Set(mapped.map((item) => item.specialityRecId));
    const matches = matchFlyersForSpecialty({
      rules,
      specialty: entity.specialty,
      taxonomyCode: entity.taxonomyCode,
      extraSpecialties,
      mappedRecIds,
    });

    const primarySpecialty = extraSpecialties[0];
    const specialtyDisplay = primarySpecialty
      ? formatSpecialtyLabel(primarySpecialty.code, primarySpecialty.description) || entity.specialty
      : entity.specialty;

    const plannedFlyer: MatchedFlyerHint | null = entity.campaignId || entity.campaignName || entity.flyerTitle
      ? {
          campaignId: entity.campaignId || 0,
          campaignName: entity.campaignName || '',
          flyerTitle: entity.flyerTitle,
          matchReason: 'On today\'s flyer list',
        }
      : null;

    const allMatches = plannedFlyer && entity.flyerTitle
      ? [
          plannedFlyer,
          ...matches.filter((match) => flyerDisplayTitle(match.campaignName, match.flyerTitle)
            !== flyerDisplayTitle(entity.campaignName || '', entity.flyerTitle)),
        ]
      : matches;

    const primary = entity.flyerTitle
      ? plannedFlyer
      : matches[0] || null;

    for (const match of allMatches) {
      if (!match.campaignId && !match.flyerTitle && !match.campaignName) continue;
      const key = match.campaignId || Number(`${match.campaignName}`);
      const campaignKey = match.campaignId > 0 ? match.campaignId : key;
      if (!Number.isFinite(campaignKey) || campaignKey <= 0) continue;
      const existing = recommendedByCampaign.get(campaignKey);
      if (existing) {
        if (!existing.doctorNames.includes(entity.displayName)) existing.doctorNames.push(entity.displayName);
        continue;
      }
      recommendedByCampaign.set(campaignKey, {
        campaignId: match.campaignId,
        campaignName: match.campaignName,
        flyerTitle: match.flyerTitle,
        matchReason: match.matchReason,
        doctorNames: [entity.displayName],
      });
    }

    if (!primary) {
      return specialtyDisplay && specialtyDisplay !== entity.specialty
        ? { ...entity, specialty: specialtyDisplay }
        : entity;
    }

    return {
      ...entity,
      specialty: specialtyDisplay || entity.specialty,
      flyerTitle: entity.flyerTitle || primary.flyerTitle || primary.campaignName,
      campaignName: entity.campaignName || primary.campaignName,
      campaignId: entity.campaignId || primary.campaignId || null,
      matchReason: entity.flyerTitle
        ? entity.matchReason
        : `${entity.matchReason} · Flyer: ${flyerDisplayTitle(primary.campaignName, primary.flyerTitle)}`,
    };
  });

  const recommendedFlyers = Array.from(recommendedByCampaign.values())
    .filter((flyer) => flyer.campaignId > 0)
    .sort((a, b) => a.campaignName.localeCompare(b.campaignName));

  return { entities: nextEntities, recommendedFlyers };
}
