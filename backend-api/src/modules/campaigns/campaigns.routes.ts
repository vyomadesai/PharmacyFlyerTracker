import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { buildPaginatedResponse, parsePaginationQuery } from '../../utils/pagination.js';

export const campaignsRoutes = Router();
campaignsRoutes.use(requireAuth);

campaignsRoutes.get('/', async (req, res) => {
  const pool = await getPool();
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const selectColumns = `
    CampaignId, CampaignName, Description, StartDate, EndDate, IsActive, CreatedDate,
    FlyerIdentifier, FlyerCategory, FlyerTitle, FlyerFileUrl, TargetAudience, DefaultVisitFrequencyDays
  `;

  if (pagination) {
    const [countResult, dataResult] = await Promise.all([
      pool.request().query(`SELECT COUNT(*) AS total FROM dbo.PharmacyFlyer_Campaign`),
      pool.request()
        .input('Offset', sql.Int, pagination.offset)
        .input('PageSize', sql.Int, pagination.pageSize)
        .query(`
          SELECT ${selectColumns}
          FROM dbo.PharmacyFlyer_Campaign
          ORDER BY CreatedDate DESC
          OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
        `),
    ]);

    const total = Number(countResult.recordset[0]?.total || 0);
    res.json(buildPaginatedResponse(dataResult.recordset, total, pagination));
    return;
  }

  const result = await pool.request().query(`
    SELECT ${selectColumns}
    FROM dbo.PharmacyFlyer_Campaign
    ORDER BY CreatedDate DESC
  `);
  res.json(result.recordset);
});

campaignsRoutes.get('/active', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CampaignId, CampaignName, Description, StartDate, EndDate, IsActive,
           FlyerIdentifier, FlyerCategory, FlyerTitle, FlyerFileUrl, TargetAudience, DefaultVisitFrequencyDays
    FROM dbo.PharmacyFlyer_Campaign
    WHERE IsActive = 1
    ORDER BY CampaignName
  `);
  res.json(result.recordset);
});

campaignsRoutes.post('/', async (req, res) => {
  const { campaignName, description, startDate, endDate, flyerIdentifier, flyerCategory, flyerTitle, flyerFileUrl, targetAudience, defaultVisitFrequencyDays } = req.body;
  if (!campaignName) return res.status(400).json({ message: 'Campaign name is required' });

  const pool = await getPool();
  const result = await pool.request()
    .input('CampaignName', sql.NVarChar, campaignName)
    .input('Description', sql.NVarChar, description || null)
    .input('StartDate', sql.Date, startDate || null)
    .input('EndDate', sql.Date, endDate || null)
    .input('FlyerIdentifier', sql.NVarChar, flyerIdentifier || null)
    .input('FlyerCategory', sql.NVarChar, flyerCategory || null)
    .input('FlyerTitle', sql.NVarChar, flyerTitle || campaignName || null)
    .input('FlyerFileUrl', sql.NVarChar, flyerFileUrl || null)
    .input('TargetAudience', sql.NVarChar, targetAudience || null)
    .input('DefaultVisitFrequencyDays', sql.Int, defaultVisitFrequencyDays ? Number(defaultVisitFrequencyDays) : null)
    .input('CreatedBy', sql.Int, req.user?.userId || null)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_Campaign (
        CampaignName, Description, StartDate, EndDate, FlyerIdentifier, FlyerCategory,
        FlyerTitle, FlyerFileUrl, TargetAudience, DefaultVisitFrequencyDays, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        @CampaignName, @Description, @StartDate, @EndDate, @FlyerIdentifier, @FlyerCategory,
        @FlyerTitle, @FlyerFileUrl, @TargetAudience, @DefaultVisitFrequencyDays, @CreatedBy
      )
    `);

  res.status(201).json(result.recordset[0]);
});
