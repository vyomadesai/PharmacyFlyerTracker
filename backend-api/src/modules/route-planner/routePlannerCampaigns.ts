import { getPool, sql } from '../../config/db.js';

type SpecialtyInput = {
  specialityRecId?: number | null;
  specialityCode?: string | null;
  description?: string | null;
  matchLevel?: string;
};

export type RoutePlannerCampaignInput = {
  campaignName: string;
  description?: string | null;
  matchMode: string;
  specialties: SpecialtyInput[];
};

async function assertRoutePlannerCampaign(campaignId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`
      SELECT TOP 1 c.CampaignId, c.CampaignName, c.IsActive
      FROM dbo.PharmacyFlyer_Campaign c
      WHERE c.CampaignId = @CampaignId
        AND EXISTS (
          SELECT 1 FROM dbo.PharmacyFlyer_CampaignSpecialtyV2 cs WHERE cs.CampaignId = c.CampaignId
        )
    `);
  return result.recordset[0] as Record<string, unknown> | undefined;
}

export async function updateRoutePlannerCampaign(campaignId: number, input: RoutePlannerCampaignInput) {
  const existing = await assertRoutePlannerCampaign(campaignId);
  if (!existing) return null;

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input('CampaignId', sql.Int, campaignId)
      .input('CampaignName', sql.NVarChar, input.campaignName)
      .input('Description', sql.NVarChar, input.description ?? null)
      .input('FlyerTitle', sql.NVarChar, input.campaignName)
      .query(`
        UPDATE dbo.PharmacyFlyer_Campaign
        SET CampaignName = @CampaignName,
            Description = @Description,
            FlyerTitle = @FlyerTitle,
            LastModifiedDate = SYSDATETIME()
        WHERE CampaignId = @CampaignId
      `);

    await new sql.Request(transaction)
      .input('CampaignId', sql.Int, campaignId)
      .query(`
        UPDATE dbo.PharmacyFlyer_CampaignSpecialtyV2
        SET IsActive = 0
        WHERE CampaignId = @CampaignId
      `);

    const insertedSpecialties: Record<string, unknown>[] = [];
    for (const specialty of input.specialties) {
      const insertResult = await new sql.Request(transaction)
        .input('CampaignId', sql.Int, campaignId)
        .input('SpecialityRecID', sql.Int, specialty.specialityRecId ?? null)
        .input('SpecialityCode', sql.NVarChar, specialty.specialityCode ?? null)
        .input('Description', sql.NVarChar, specialty.description ?? null)
        .input('MatchLevel', sql.VarChar, specialty.matchLevel ?? 'any')
        .input('MatchMode', sql.VarChar, input.matchMode)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_CampaignSpecialtyV2 (
            CampaignId, SpecialityRecID, SpecialityCode, Description, MatchLevel, MatchMode
          )
          OUTPUT INSERTED.*
          VALUES (
            @CampaignId, @SpecialityRecID, @SpecialityCode, @Description, @MatchLevel, @MatchMode
          )
        `);
      insertedSpecialties.push(insertResult.recordset[0]);
    }

    await transaction.commit();

    return {
      campaignId,
      campaignName: input.campaignName,
      description: input.description ?? null,
      flyerTitle: input.campaignName,
      matchMode: input.matchMode,
      specialties: insertedSpecialties.map((row) => ({
        campaignSpecialtyV2Id: row.CampaignSpecialtyV2Id,
        campaignId: row.CampaignId,
        specialityRecId: row.SpecialityRecID,
        specialityCode: row.SpecialityCode,
        description: row.Description,
        matchLevel: row.MatchLevel,
        matchMode: row.MatchMode,
        isActive: row.IsActive,
        createdDate: row.CreatedDate,
      })),
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function setRoutePlannerCampaignActive(campaignId: number, isActive: boolean) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`
      SELECT TOP 1 c.CampaignId, c.CampaignName
      FROM dbo.PharmacyFlyer_Campaign c
      WHERE c.CampaignId = @CampaignId
        AND EXISTS (
          SELECT 1 FROM dbo.PharmacyFlyer_CampaignSpecialtyV2 cs WHERE cs.CampaignId = c.CampaignId
        )
    `);
  if (!existing.recordset[0]) return null;

  await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('IsActive', sql.Bit, isActive ? 1 : 0)
    .query(`
      UPDATE dbo.PharmacyFlyer_Campaign
      SET IsActive = @IsActive, LastModifiedDate = SYSDATETIME()
      WHERE CampaignId = @CampaignId
    `);

  if (isActive) {
    const activeSpec = await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .query(`
        SELECT COUNT(*) AS Cnt
        FROM dbo.PharmacyFlyer_CampaignSpecialtyV2
        WHERE CampaignId = @CampaignId AND IsActive = 1
      `);
    if (Number(activeSpec.recordset[0]?.Cnt ?? 0) === 0) {
      await pool.request()
        .input('CampaignId', sql.Int, campaignId)
        .query(`
          UPDATE cs
          SET cs.IsActive = 1
          FROM dbo.PharmacyFlyer_CampaignSpecialtyV2 cs
          INNER JOIN (
            SELECT MAX(CampaignSpecialtyV2Id) AS CampaignSpecialtyV2Id
            FROM dbo.PharmacyFlyer_CampaignSpecialtyV2
            WHERE CampaignId = @CampaignId
            GROUP BY ISNULL(SpecialityRecID, -1), ISNULL(SpecialityCode, ''), ISNULL(Description, '')
          ) latest ON latest.CampaignSpecialtyV2Id = cs.CampaignSpecialtyV2Id
        `);
    }
  }

  return {
    campaignId,
    isActive,
    campaignName: existing.recordset[0].CampaignName,
  };
}

export async function deleteRoutePlannerCampaign(campaignId: number) {
  const existing = await assertRoutePlannerCampaign(campaignId);
  if (!existing) return null;

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Remove flyer-builder specialty rules so the campaign drops from builder lists.
    // Keep dbo.PharmacyFlyer_Campaign for saved routes / historical FK references.
    await new sql.Request(transaction)
      .input('CampaignId', sql.Int, campaignId)
      .query(`
        DELETE FROM dbo.PharmacyFlyer_CampaignSpecialtyV2
        WHERE CampaignId = @CampaignId
      `);

    await new sql.Request(transaction)
      .input('CampaignId', sql.Int, campaignId)
      .query(`
        UPDATE dbo.PharmacyFlyer_Campaign
        SET IsActive = 0, LastModifiedDate = SYSDATETIME()
        WHERE CampaignId = @CampaignId
      `);

    await transaction.commit();
    return { campaignId, deleted: true };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
