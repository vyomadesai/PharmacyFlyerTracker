import { getPool } from '../../config/db.js';
import {
  buildFlyerRecommendations,
  guessDropNamesFromTaxonomies as buildGuessDropNames,
} from './newEntriesFlyerRecommendations.js';

export type ActiveFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
  matchReason: string;
  recommended?: boolean;
};

export async function listAllActiveFlyers(): Promise<ActiveFlyer[]> {
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

export async function listActiveFlyersWithRecommendations(
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

  const recommendedById = new Map(result.recommendations.map((item) => [item.campaignId, item]));
  return result.activeCampaigns.map((campaign) => {
    const recommendation = recommendedById.get(campaign.campaignId);
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      flyerTitle: campaign.flyerTitle,
      matchReason: recommendation?.matchReasons.join('; ') || 'Active flyer',
      recommended: Boolean(recommendation),
      confidence: recommendation?.confidence,
      score: recommendation?.score,
      matchSource: recommendation?.matchSource,
    };
  }).sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return a.campaignName.localeCompare(b.campaignName);
  });
}

export { buildFlyerRecommendations, buildGuessDropNames as guessDropNamesFromTaxonomies };
