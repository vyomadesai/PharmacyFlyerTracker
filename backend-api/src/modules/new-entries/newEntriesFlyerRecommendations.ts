import { getPool, sql } from '../../config/db.js';
import { loadCampaignSpecialtyRules, type CampaignSpecialtyRule } from '../route-planner/routePlannerMatching.js';
import { resolveSpecialityRecIdsFromTaxonomyLists } from './newEntriesNuccSpecialtyMap.js';

export type FlyerConfidence = 'strong' | 'medium' | 'weak';
export type FlyerMatchSource = 'master_doctor' | 'nucc_map' | 'manual';

export type FlyerRecommendation = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  confidence: FlyerConfidence;
  score: number;
  matchReasons: string[];
  matchSource: FlyerMatchSource;
};

export type FlyerRecommendationResponse = {
  activeCampaigns: Array<{
    campaignId: number;
    campaignName: string;
    flyerTitle: string | null;
  }>;
  recommendations: FlyerRecommendation[];
  preferManual: boolean;
  primaryRecommendation: FlyerRecommendation | null;
};

type SqlRequest = InstanceType<typeof sql.Request>;

const ACTIVE_DOCTOR_FILTER = `LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'`;

function levelSqlForRule(matchLevel: string, matchMode: string): string {
  const level = String(matchLevel || 'any').trim();
  const mode = String(matchMode || 'secondary_only').trim().toLowerCase();
  if (level === '1' || level === '2' || level === '3') {
    return `ps.Level = '${level}'`;
  }
  if (mode === 'primary_only') return `ps.Level = '1'`;
  if (mode === 'secondary_only') return `ps.Level = '2'`;
  return `ps.Level IN ('1', '2')`;
}

function specialtyMatchSql(rule: CampaignSpecialtyRule, index: number, request: SqlRequest): string | null {
  const parts: string[] = [];

  if (rule.specialityRecId != null && rule.specialityRecId > 0) {
    const param = `RuleRecId${index}`;
    request.input(param, sql.Int, rule.specialityRecId);
    parts.push(`sl.RecID = @${param}`);
  }

  if (rule.specialityCode) {
    const param = `RuleCode${index}`;
    request.input(param, sql.NVarChar, rule.specialityCode);
    parts.push(`UPPER(LTRIM(RTRIM(sl.SpecialityCode))) = UPPER(LTRIM(RTRIM(@${param})))`);
  }

  if (rule.description) {
    const param = `RuleDesc${index}`;
    request.input(param, sql.NVarChar, `%${rule.description}%`);
    parts.push(`sl.Description LIKE @${param}`);
  }

  if (!parts.length) return null;
  return `(${parts.join(' OR ')})`;
}

function buildRuleWhereClauses(rules: CampaignSpecialtyRule[], request: SqlRequest): string[] {
  const clauses: string[] = [];
  rules.forEach((rule, index) => {
    const specialtyMatch = specialtyMatchSql(rule, index, request);
    if (!specialtyMatch) return;
    const levelMatch = levelSqlForRule(rule.matchLevel, rule.matchMode);
    clauses.push(`(${specialtyMatch} AND ${levelMatch})`);
  });
  return clauses;
}

function flyerDisplayTitle(campaignName: string, flyerTitle: string | null) {
  return String(flyerTitle || campaignName || '').trim();
}

function normalizeNpis(npis: string[]) {
  return [...new Set(
    npis
      .map((npi) => String(npi || '').replace(/\D/g, ''))
      .filter((npi) => npi.length === 10),
  )];
}

async function listAllActiveCampaigns() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT
      c.CampaignId,
      c.CampaignName,
      c.FlyerTitle
    FROM dbo.PharmacyFlyer_Campaign c
    INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      ON cs.CampaignId = c.CampaignId AND cs.IsActive = 1
    WHERE c.IsActive = 1
    ORDER BY c.CampaignName
  `);

  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    campaignId: Number(row.CampaignId),
    campaignName: String(row.CampaignName || ''),
    flyerTitle: row.FlyerTitle != null ? String(row.FlyerTitle) : null,
  })).filter((row) => Number.isFinite(row.campaignId) && row.campaignId > 0);
}

async function loadActiveCampaignIds(): Promise<number[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT c.CampaignId
    FROM dbo.PharmacyFlyer_Campaign c
    INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      ON cs.CampaignId = c.CampaignId AND cs.IsActive = 1
    WHERE c.IsActive = 1
    ORDER BY c.CampaignId
  `);
  return (result.recordset as Array<{ CampaignId: number }>)
    .map((row) => Number(row.CampaignId))
    .filter((id) => Number.isFinite(id) && id > 0);
}

type StrongMatchRow = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  npi: string;
  specialityCode: string | null;
  specialityDescription: string | null;
  matchedLevel: string | null;
};

async function matchKnownProvidersToCampaigns(npis: string[]): Promise<StrongMatchRow[]> {
  const normalized = normalizeNpis(npis);
  if (!normalized.length) return [];

  const campaignIds = await loadActiveCampaignIds();
  const pool = await getPool();
  const allMatches: StrongMatchRow[] = [];

  for (const campaignId of campaignIds) {
    const loaded = await loadCampaignSpecialtyRules(campaignId);
    if (!loaded?.rules.length) continue;

    const request = pool.request().input('CampaignId', sql.Int, campaignId);
    normalized.forEach((npi, index) => request.input(`Npi${index}`, sql.VarChar, npi));
    const npiParams = normalized.map((_, index) => `@Npi${index}`).join(', ');
    const ruleClauses = buildRuleWhereClauses(loaded.rules, request);
    if (!ruleClauses.length) continue;

    const result = await request.query(`
      SELECT DISTINCT
        c.CampaignId,
        c.CampaignName,
        c.FlyerTitle,
        NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') AS Npi,
        sl.SpecialityCode,
        sl.Description AS SpecialityDescription,
        ps.Level AS MatchedLevel
      FROM dbo.Master_Doctor d
      INNER JOIN dbo.Master_PrescribSpeciality ps
        ON ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
        AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
      INNER JOIN dbo.Master_PrsSpecialitiesList sl
        ON sl.RecID = ps.SpecialityID
        AND ISNULL(sl.IsActive, 1) = 1
      INNER JOIN dbo.PharmacyFlyer_Campaign c
        ON c.CampaignId = @CampaignId
        AND c.IsActive = 1
      WHERE ${ACTIVE_DOCTOR_FILTER}
        AND NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') IN (${npiParams})
        AND (${ruleClauses.join(' OR ')})
    `);

    for (const row of result.recordset as Record<string, unknown>[]) {
      allMatches.push({
        campaignId: Number(row.CampaignId),
        campaignName: String(row.CampaignName || ''),
        flyerTitle: row.FlyerTitle != null ? String(row.FlyerTitle) : null,
        npi: String(row.Npi || ''),
        specialityCode: row.SpecialityCode != null ? String(row.SpecialityCode).trim() : null,
        specialityDescription: row.SpecialityDescription != null ? String(row.SpecialityDescription).trim() : null,
        matchedLevel: row.MatchedLevel != null ? String(row.MatchedLevel).trim() : null,
      });
    }
  }

  return allMatches;
}

type MediumMatchRow = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  specialityRecId: number;
  specialityCode: string | null;
  specialityDescription: string | null;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
};

async function matchTaxonomiesViaNuccMap(
  taxonomyCodes: string[],
  taxonomyDescs: string[],
): Promise<MediumMatchRow[]> {
  const resolved = await resolveSpecialityRecIdsFromTaxonomyLists(taxonomyCodes, taxonomyDescs);
  if (!resolved.length) return [];

  const pool = await getPool();
  const request = pool.request();
  const recIdParams = resolved.map((item, index) => {
    request.input(`RecId${index}`, sql.Int, item.specialityRecId);
    return `@RecId${index}`;
  });

  const result = await request.query(`
    SELECT DISTINCT
      c.CampaignId,
      c.CampaignName,
      c.FlyerTitle,
      cs.SpecialityRecID,
      sl.SpecialityCode,
      sl.Description AS SpecialityDescription
    FROM dbo.PharmacyFlyer_Campaign c
    INNER JOIN dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
      ON cs.CampaignId = c.CampaignId
      AND cs.IsActive = 1
      AND cs.SpecialityRecID IN (${recIdParams.join(', ')})
    INNER JOIN dbo.Master_PrsSpecialitiesList sl
      ON sl.RecID = cs.SpecialityRecID
    WHERE c.IsActive = 1
  `);

  const resolvedByRecId = new Map(resolved.map((item) => [item.specialityRecId, item]));
  const matches: MediumMatchRow[] = [];

  for (const row of result.recordset as Record<string, unknown>[]) {
    const specialityRecId = Number(row.SpecialityRecID);
    const source = resolvedByRecId.get(specialityRecId);
    if (!source) continue;

    matches.push({
      campaignId: Number(row.CampaignId),
      campaignName: String(row.CampaignName || ''),
      flyerTitle: row.FlyerTitle != null ? String(row.FlyerTitle) : null,
      specialityRecId,
      specialityCode: row.SpecialityCode != null ? String(row.SpecialityCode).trim() : source.specialityCode,
      specialityDescription: row.SpecialityDescription != null
        ? String(row.SpecialityDescription).trim()
        : source.specialityDescription,
      taxonomyCode: source.taxonomyCode,
      taxonomyDesc: source.taxonomyDesc,
    });
  }

  return matches;
}

function aggregateRecommendations(
  strongRows: StrongMatchRow[],
  mediumRows: MediumMatchRow[],
  highDensity: boolean,
): FlyerRecommendation[] {
  const byCampaign = new Map<number, FlyerRecommendation>();

  for (const row of strongRows) {
    const reason = [
      row.specialityCode || row.specialityDescription || 'Known provider specialty',
      row.matchedLevel ? `Level ${row.matchedLevel}` : null,
      row.npi ? `NPI ${row.npi}` : null,
    ].filter(Boolean).join(' · ');

    const existing = byCampaign.get(row.campaignId);
    if (existing && existing.matchSource === 'master_doctor') {
      existing.score += 25;
      if (reason && !existing.matchReasons.includes(reason)) existing.matchReasons.push(reason);
      continue;
    }

    byCampaign.set(row.campaignId, {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      flyerTitle: row.flyerTitle,
      confidence: 'strong',
      score: 100,
      matchReasons: reason ? [reason] : ['Known provider in database'],
      matchSource: 'master_doctor',
    });
  }

  for (const row of mediumRows) {
    if (byCampaign.has(row.campaignId)) continue;

    const reason = [
      row.taxonomyCode ? `NUCC ${row.taxonomyCode}` : null,
      row.taxonomyDesc ? row.taxonomyDesc : null,
      row.specialityCode || row.specialityDescription
        ? `Mapped to ${row.specialityCode || row.specialityDescription}`
        : null,
    ].filter(Boolean).join(' · ');

    byCampaign.set(row.campaignId, {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      flyerTitle: row.flyerTitle,
      confidence: 'medium',
      score: 50 + (row.taxonomyCode ? 5 : 0),
      matchReasons: reason ? [reason] : ['NUCC taxonomy mapped to campaign specialty'],
      matchSource: 'nucc_map',
    });
  }

  let recommendations = Array.from(byCampaign.values());

  if (highDensity) {
    recommendations = recommendations.map((item) => {
      let confidence: FlyerConfidence = item.confidence;
      let score = item.score;

      if (confidence === 'strong') {
        confidence = 'medium';
        score = Math.min(score, 65);
      } else if (confidence === 'medium') {
        confidence = 'weak';
        score = Math.min(score, 30);
      }

      return {
        ...item,
        confidence,
        score,
        matchReasons: [
          ...item.matchReasons,
          'High NPI density at address — confirm flyer manually',
        ],
      };
    });
  }

  return recommendations.sort((a, b) => b.score - a.score || a.campaignName.localeCompare(b.campaignName));
}

export async function buildFlyerRecommendations(input: {
  taxonomyCodes?: string[];
  taxonomyDescs?: string[];
  providerNpis?: string[];
  highDensity?: boolean;
  virtualOffice?: boolean;
}): Promise<FlyerRecommendationResponse> {
  const taxonomyCodes = (input.taxonomyCodes || []).map((v) => String(v || '').trim()).filter(Boolean);
  const taxonomyDescs = (input.taxonomyDescs || []).map((v) => String(v || '').trim());
  const providerNpis = input.providerNpis || [];
  const highDensity = Boolean(input.highDensity || input.virtualOffice);

  const activeCampaigns = await listAllActiveCampaigns();

  const strongRows = await matchKnownProvidersToCampaigns(providerNpis);
  const mediumRows = strongRows.length
    ? []
    : await matchTaxonomiesViaNuccMap(taxonomyCodes, taxonomyDescs);

  const recommendations = aggregateRecommendations(strongRows, mediumRows, highDensity);
  const hasStrong = recommendations.some(
    (item) => item.confidence === 'strong' && item.matchSource === 'master_doctor',
  );
  const preferManual = highDensity || (!hasStrong && !recommendations.some((item) => item.confidence === 'medium'));

  const primaryRecommendation = preferManual
    ? null
    : recommendations.find((item) => item.confidence === 'strong')
      || recommendations.find((item) => item.confidence === 'medium')
      || null;

  return {
    activeCampaigns,
    recommendations,
    preferManual,
    primaryRecommendation,
  };
}

export async function guessDropNamesFromTaxonomies(
  taxonomyCodes: string[],
  taxonomyDescs: string[],
  options?: {
    providerNpis?: string[];
    highDensity?: boolean;
    virtualOffice?: boolean;
  },
) {
  const result = await buildFlyerRecommendations({
    taxonomyCodes,
    taxonomyDescs,
    providerNpis: options?.providerNpis,
    highDensity: options?.highDensity,
    virtualOffice: options?.virtualOffice,
  });
  const dropNames = [...new Set(
    result.recommendations
      .map((item) => flyerDisplayTitle(item.campaignName, item.flyerTitle))
      .filter(Boolean),
  )];

  const primary = result.primaryRecommendation;
  return {
    activeCampaigns: result.activeCampaigns,
    recommendations: result.recommendations,
    preferManual: result.preferManual,
    primaryRecommendation: primary,
    dropNames,
    dropNamesText: dropNames.join(', '),
    primaryFlyer: primary
      ? {
          campaignId: primary.campaignId,
          campaignName: primary.campaignName,
          flyerTitle: primary.flyerTitle,
        }
      : null,
  };
}
