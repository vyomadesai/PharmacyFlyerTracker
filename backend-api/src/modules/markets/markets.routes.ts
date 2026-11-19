import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager } from '../../middleware/role.middleware.js';
import { cleanString, parseCoordinate, parseOptionalBoolean } from '../../utils/geography.js';

export const marketsRoutes = Router();
marketsRoutes.use(requireAuth);

const MARKET_SELECT = `
  MarketId,
  MarketName,
  MarketNumber,
  CenterAddress,
  CenterCity,
  CenterState,
  CenterZip,
  CenterLatitude,
  CenterLongitude,
  RadiusMiles,
  IsActive,
  CreatedAt,
  UpdatedAt
`;

function validateMarketPayload(body: Record<string, unknown>, isUpdate = false) {
  const marketName = cleanString(body.marketName);
  const marketNumber = cleanString(body.marketNumber);

  if (!isUpdate && (!marketName || !marketNumber)) {
    return { error: 'marketName and marketNumber are required.' };
  }

  const centerLatitude = body.centerLatitude === undefined || body.centerLatitude === null || body.centerLatitude === ''
    ? null
    : parseCoordinate(body.centerLatitude);
  const centerLongitude = body.centerLongitude === undefined || body.centerLongitude === null || body.centerLongitude === ''
    ? null
    : parseCoordinate(body.centerLongitude);

  if (body.centerLatitude !== undefined && body.centerLatitude !== null && body.centerLatitude !== '' && centerLatitude === null) {
    return { error: 'centerLatitude must be a valid number.' };
  }
  if (body.centerLongitude !== undefined && body.centerLongitude !== null && body.centerLongitude !== '' && centerLongitude === null) {
    return { error: 'centerLongitude must be a valid number.' };
  }

  const radiusMiles = body.radiusMiles === undefined || body.radiusMiles === null || body.radiusMiles === ''
    ? 10
    : Number(body.radiusMiles);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    return { error: 'radiusMiles must be a positive number.' };
  }

  const isActive = parseOptionalBoolean(body.isActive);

  return {
    marketName,
    marketNumber,
    centerAddress: cleanString(body.centerAddress),
    centerCity: cleanString(body.centerCity),
    centerState: cleanString(body.centerState),
    centerZip: cleanString(body.centerZip),
    centerLatitude,
    centerLongitude,
    radiusMiles,
    isActive,
  };
}

marketsRoutes.get('/active', requireAdminOrManager, async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ${MARKET_SELECT}
      FROM dbo.PharmacyFlyer_Market
      WHERE IsActive = 1
      ORDER BY MarketName
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error('Active markets error:', error);
    res.status(500).json({ message: 'Could not load active markets' });
  }
});

marketsRoutes.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const activeOnly = parseOptionalBoolean(req.query.activeOnly) === true;
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ${MARKET_SELECT}
      FROM dbo.PharmacyFlyer_Market
      WHERE (${activeOnly ? 1 : 0} = 0 OR IsActive = 1)
      ORDER BY MarketName
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error('Markets list error:', error);
    res.status(500).json({ message: 'Could not load markets' });
  }
});

marketsRoutes.get('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const marketId = Number(req.params.id);
    if (!Number.isFinite(marketId)) return res.status(400).json({ message: 'Invalid market id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('MarketId', sql.Int, marketId)
      .query(`
        SELECT TOP 1 ${MARKET_SELECT}
        FROM dbo.PharmacyFlyer_Market
        WHERE MarketId = @MarketId
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Market not found' });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Market lookup error:', error);
    res.status(500).json({ message: 'Could not load market' });
  }
});

marketsRoutes.post('/', requireAdmin, async (req, res) => {
  try {
    const validated = validateMarketPayload(req.body || {});
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    const pool = await getPool();
    const result = await pool.request()
      .input('MarketName', sql.NVarChar, validated.marketName)
      .input('MarketNumber', sql.NVarChar, validated.marketNumber)
      .input('CenterAddress', sql.NVarChar, validated.centerAddress)
      .input('CenterCity', sql.NVarChar, validated.centerCity)
      .input('CenterState', sql.NVarChar, validated.centerState)
      .input('CenterZip', sql.NVarChar, validated.centerZip)
      .input('CenterLatitude', sql.Decimal(10, 7), validated.centerLatitude)
      .input('CenterLongitude', sql.Decimal(10, 7), validated.centerLongitude)
      .input('RadiusMiles', sql.Decimal(8, 2), validated.radiusMiles)
      .input('IsActive', sql.Bit, validated.isActive ?? true)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Market (
          MarketName, MarketNumber, CenterAddress, CenterCity, CenterState, CenterZip,
          CenterLatitude, CenterLongitude, RadiusMiles, IsActive
        )
        OUTPUT INSERTED.*
        VALUES (
          @MarketName, @MarketNumber, @CenterAddress, @CenterCity, @CenterState, @CenterZip,
          @CenterLatitude, @CenterLongitude, @RadiusMiles, @IsActive
        )
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error: any) {
    console.error('Market create error:', error);
    if (String(error?.message || '').includes('UQ_PharmacyFlyer_Market_MarketNumber')) {
      return res.status(409).json({ message: 'Market number already exists.' });
    }
    res.status(500).json({ message: 'Could not create market' });
  }
});

marketsRoutes.put('/:id', requireAdmin, async (req, res) => {
  try {
    const marketId = Number(req.params.id);
    if (!Number.isFinite(marketId)) return res.status(400).json({ message: 'Invalid market id' });

    const validated = validateMarketPayload(req.body || {}, true);
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    const pool = await getPool();
    const existing = await pool.request()
      .input('MarketId', sql.Int, marketId)
      .query(`SELECT TOP 1 ${MARKET_SELECT} FROM dbo.PharmacyFlyer_Market WHERE MarketId = @MarketId`);

    const current = existing.recordset[0];
    if (!current) return res.status(404).json({ message: 'Market not found' });

    const result = await pool.request()
      .input('MarketId', sql.Int, marketId)
      .input('MarketName', sql.NVarChar, validated.marketName ?? current.MarketName)
      .input('MarketNumber', sql.NVarChar, validated.marketNumber ?? current.MarketNumber)
      .input('CenterAddress', sql.NVarChar, validated.centerAddress ?? current.CenterAddress)
      .input('CenterCity', sql.NVarChar, validated.centerCity ?? current.CenterCity)
      .input('CenterState', sql.NVarChar, validated.centerState ?? current.CenterState)
      .input('CenterZip', sql.NVarChar, validated.centerZip ?? current.CenterZip)
      .input('CenterLatitude', sql.Decimal(10, 7), validated.centerLatitude ?? current.CenterLatitude)
      .input('CenterLongitude', sql.Decimal(10, 7), validated.centerLongitude ?? current.CenterLongitude)
      .input('RadiusMiles', sql.Decimal(8, 2), validated.radiusMiles ?? current.RadiusMiles)
      .input('IsActive', sql.Bit, validated.isActive ?? current.IsActive)
      .query(`
        UPDATE dbo.PharmacyFlyer_Market
        SET
          MarketName = @MarketName,
          MarketNumber = @MarketNumber,
          CenterAddress = @CenterAddress,
          CenterCity = @CenterCity,
          CenterState = @CenterState,
          CenterZip = @CenterZip,
          CenterLatitude = @CenterLatitude,
          CenterLongitude = @CenterLongitude,
          RadiusMiles = @RadiusMiles,
          IsActive = @IsActive,
          UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE MarketId = @MarketId
      `);

    res.json(result.recordset[0]);
  } catch (error: any) {
    console.error('Market update error:', error);
    if (String(error?.message || '').includes('UQ_PharmacyFlyer_Market_MarketNumber')) {
      return res.status(409).json({ message: 'Market number already exists.' });
    }
    res.status(500).json({ message: 'Could not update market' });
  }
});
