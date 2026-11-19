import { getPool, sql } from '../../config/db.js';
import { resolveSpecialityRecIdsFromTaxonomyLists } from './newEntriesNuccSpecialtyMap.js';

export type MatchedFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  matchReason: string;
};

async function listActiveCampaignsForTaxonomyMatch(): Promise<MatchedFlyer[]> {
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
    matchReason: 'Active flyer',
  })).filter((row) => Number.isFinite(row.campaignId) && row.campaignId > 0);
}

export async function matchActiveFlyersForTaxonomy(input: {
  taxonomyCode?: string | null;
  taxonomyDesc?: string | null;
  allowFallback?: boolean;
}) {
  const taxonomyCode = String(input.taxonomyCode || '').trim().toUpperCase();
  const taxonomyDesc = String(input.taxonomyDesc || '').trim();
  const allowFallback = input.allowFallback !== false;
  const codes = taxonomyCode ? [taxonomyCode] : [];
  const descs = taxonomyDesc ? [taxonomyDesc] : [];

  let resolved: Awaited<ReturnType<typeof resolveSpecialityRecIdsFromTaxonomyLists>> = [];
  try {
    resolved = await resolveSpecialityRecIdsFromTaxonomyLists(codes, descs);
  } catch {
    resolved = [];
  }

  if (!resolved.length) {
    if (!allowFallback) return [];
    return listActiveCampaignsForTaxonomyMatch();
  }

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
  const matches = new Map<number, MatchedFlyer>();

  for (const row of result.recordset as Record<string, unknown>[]) {
    const campaignId = Number(row.CampaignId);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;

    const source = resolvedByRecId.get(Number(row.SpecialityRecID));
    const specialityCode = String(row.SpecialityCode || source?.specialityCode || '').trim();
    const specialityDescription = String(row.SpecialityDescription || source?.specialityDescription || '').trim();

    const matchReason = [
      source?.taxonomyCode ? `NUCC ${source.taxonomyCode}` : null,
      source?.taxonomyDesc || null,
      specialityCode || specialityDescription || 'Mapped specialty',
    ].filter(Boolean).join(' · ');

    matches.set(campaignId, {
      campaignId,
      campaignName: String(row.CampaignName || ''),
      flyerTitle: row.FlyerTitle != null ? String(row.FlyerTitle) : null,
      matchReason: matchReason || 'NUCC taxonomy mapped to campaign specialty',
    });
  }

  if (!matches.size && allowFallback) {
    return listActiveCampaignsForTaxonomyMatch();
  }

  return Array.from(matches.values()).sort((a, b) => a.campaignName.localeCompare(b.campaignName));
}
