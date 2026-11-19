import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdmin, requireAdminOrManager } from '../../middleware/role.middleware.js';
import { cleanString, haversineSql, parseCoordinate, parseOptionalBoolean } from '../../utils/geography.js';

export const pharmaciesRoutes = Router();
pharmaciesRoutes.use(requireAuth);

const PHARMACY_SELECT = `
  p.PharmacyId,
  p.PharmacyName,
  p.Address1,
  p.Address2,
  p.City,
  p.State,
  p.Zip,
  p.Phone,
  p.Fax,
  p.Latitude,
  p.Longitude,
  p.MarketId,
  p.LegacyPharmacyInfoNo,
  p.IsActive,
  p.CreatedAt,
  p.UpdatedAt,
  m.MarketName,
  m.MarketNumber
`;

function validatePharmacyPayload(body: Record<string, unknown>, isUpdate = false) {
  const pharmacyName = cleanString(body.pharmacyName);
  if (!isUpdate && !pharmacyName) {
    return { error: 'pharmacyName is required.' };
  }

  const latitude = body.latitude === undefined || body.latitude === null || body.latitude === ''
    ? null
    : parseCoordinate(body.latitude);
  const longitude = body.longitude === undefined || body.longitude === null || body.longitude === ''
    ? null
    : parseCoordinate(body.longitude);

  if (body.latitude !== undefined && body.latitude !== null && body.latitude !== '' && latitude === null) {
    return { error: 'latitude must be a valid number.' };
  }
  if (body.longitude !== undefined && body.longitude !== null && body.longitude !== '' && longitude === null) {
    return { error: 'longitude must be a valid number.' };
  }

  const marketId = body.marketId === undefined || body.marketId === null || body.marketId === ''
    ? null
    : Number(body.marketId);
  if (body.marketId !== undefined && body.marketId !== null && body.marketId !== '' && !Number.isFinite(marketId)) {
    return { error: 'marketId must be a valid number.' };
  }

  const legacyPharmacyInfoNo = body.legacyPharmacyInfoNo === undefined || body.legacyPharmacyInfoNo === null || body.legacyPharmacyInfoNo === ''
    ? null
    : Number(body.legacyPharmacyInfoNo);

  const isActive = parseOptionalBoolean(body.isActive);

  return {
    pharmacyName,
    address1: cleanString(body.address1),
    address2: cleanString(body.address2),
    city: cleanString(body.city),
    state: cleanString(body.state),
    zip: cleanString(body.zip),
    phone: cleanString(body.phone),
    fax: cleanString(body.fax),
    latitude,
    longitude,
    marketId,
    legacyPharmacyInfoNo: Number.isFinite(legacyPharmacyInfoNo) ? legacyPharmacyInfoNo : null,
    isActive,
  };
}

pharmaciesRoutes.get('/', requireAdminOrManager, async (req, res) => {
  try {
    const q = cleanString(req.query.q) || cleanString(req.query.search);
    const marketId = req.query.marketId ? Number(req.query.marketId) : null;
    const activeOnly = parseOptionalBoolean(req.query.activeOnly) === true;
    const latitude = parseCoordinate(req.query.latitude ?? req.query.lat);
    const longitude = parseCoordinate(req.query.longitude ?? req.query.lng);
    const radiusMiles = req.query.radiusMiles ? Number(req.query.radiusMiles) : null;

    const pool = await getPool();
    const request = pool.request()
      .input('MarketId', sql.Int, Number.isFinite(marketId) ? marketId : null)
      .input('Like', sql.NVarChar, q ? `%${q}%` : null)
      .input('Latitude', sql.Decimal(10, 7), latitude)
      .input('Longitude', sql.Decimal(10, 7), longitude)
      .input('RadiusMiles', sql.Decimal(8, 2), Number.isFinite(radiusMiles) ? radiusMiles : null);

    const distanceExpr = latitude !== null && longitude !== null
      ? haversineSql('p', '@Latitude', '@Longitude')
      : null;

    const result = await request.query(`
      SELECT TOP 500
        ${PHARMACY_SELECT}
        ${distanceExpr ? `, CAST(${distanceExpr} AS DECIMAL(10, 2)) AS DistanceMiles` : ''}
      FROM dbo.PharmacyFlyer_Pharmacy p
      LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = p.MarketId
      WHERE (@MarketId IS NULL OR p.MarketId = @MarketId)
        AND (${activeOnly ? 1 : 0} = 0 OR p.IsActive = 1)
        AND (
          @Like IS NULL
          OR p.PharmacyName LIKE @Like
          OR p.Address1 LIKE @Like
          OR p.City LIKE @Like
          OR p.Zip LIKE @Like
        )
        AND (
          @RadiusMiles IS NULL
          OR @Latitude IS NULL
          OR @Longitude IS NULL
          OR (
            p.Latitude IS NOT NULL
            AND p.Longitude IS NOT NULL
            AND ${distanceExpr} <= @RadiusMiles
          )
        )
      ORDER BY ${distanceExpr ? 'DistanceMiles ASC,' : ''} p.PharmacyName
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error('Pharmacies list error:', error);
    res.status(500).json({ message: 'Could not load pharmacies' });
  }
});

pharmaciesRoutes.get('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const pharmacyId = Number(req.params.id);
    if (!Number.isFinite(pharmacyId)) return res.status(400).json({ message: 'Invalid pharmacy id' });

    const pool = await getPool();
    const result = await pool.request()
      .input('PharmacyId', sql.Int, pharmacyId)
      .query(`
        SELECT TOP 1 ${PHARMACY_SELECT}
        FROM dbo.PharmacyFlyer_Pharmacy p
        LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = p.MarketId
        WHERE p.PharmacyId = @PharmacyId
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Pharmacy not found' });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Pharmacy lookup error:', error);
    res.status(500).json({ message: 'Could not load pharmacy' });
  }
});

pharmaciesRoutes.post('/', requireAdmin, async (req, res) => {
  try {
    const validated = validatePharmacyPayload(req.body || {});
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    if (validated.marketId) {
      const pool = await getPool();
      const market = await pool.request()
        .input('MarketId', sql.Int, validated.marketId)
        .query(`SELECT TOP 1 MarketId FROM dbo.PharmacyFlyer_Market WHERE MarketId = @MarketId`);
      if (!market.recordset[0]) return res.status(400).json({ message: 'Market not found.' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('PharmacyName', sql.NVarChar, validated.pharmacyName)
      .input('Address1', sql.NVarChar, validated.address1)
      .input('Address2', sql.NVarChar, validated.address2)
      .input('City', sql.NVarChar, validated.city)
      .input('State', sql.NVarChar, validated.state)
      .input('Zip', sql.NVarChar, validated.zip)
      .input('Phone', sql.NVarChar, validated.phone)
      .input('Fax', sql.NVarChar, validated.fax)
      .input('Latitude', sql.Decimal(10, 7), validated.latitude)
      .input('Longitude', sql.Decimal(10, 7), validated.longitude)
      .input('MarketId', sql.Int, validated.marketId)
      .input('LegacyPharmacyInfoNo', sql.Int, validated.legacyPharmacyInfoNo)
      .input('IsActive', sql.Bit, validated.isActive ?? true)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Pharmacy (
          PharmacyName, Address1, Address2, City, State, Zip, Phone, Fax,
          Latitude, Longitude, MarketId, LegacyPharmacyInfoNo, IsActive
        )
        OUTPUT INSERTED.*
        VALUES (
          @PharmacyName, @Address1, @Address2, @City, @State, @Zip, @Phone, @Fax,
          @Latitude, @Longitude, @MarketId, @LegacyPharmacyInfoNo, @IsActive
        )
      `);

    res.status(201).json(result.recordset[0]);
  } catch (error) {
    console.error('Pharmacy create error:', error);
    res.status(500).json({ message: 'Could not create pharmacy' });
  }
});

pharmaciesRoutes.put('/:id', requireAdmin, async (req, res) => {
  try {
    const pharmacyId = Number(req.params.id);
    if (!Number.isFinite(pharmacyId)) return res.status(400).json({ message: 'Invalid pharmacy id' });

    const validated = validatePharmacyPayload(req.body || {}, true);
    if ('error' in validated) return res.status(400).json({ message: validated.error });

    const pool = await getPool();
    const existing = await pool.request()
      .input('PharmacyId', sql.Int, pharmacyId)
      .query(`SELECT TOP 1 * FROM dbo.PharmacyFlyer_Pharmacy WHERE PharmacyId = @PharmacyId`);

    const current = existing.recordset[0];
    if (!current) return res.status(404).json({ message: 'Pharmacy not found' });

    const nextMarketId = validated.marketId ?? current.MarketId;
    if (nextMarketId) {
      const market = await pool.request()
        .input('MarketId', sql.Int, nextMarketId)
        .query(`SELECT TOP 1 MarketId FROM dbo.PharmacyFlyer_Market WHERE MarketId = @MarketId`);
      if (!market.recordset[0]) return res.status(400).json({ message: 'Market not found.' });
    }

    const result = await pool.request()
      .input('PharmacyId', sql.Int, pharmacyId)
      .input('PharmacyName', sql.NVarChar, validated.pharmacyName ?? current.PharmacyName)
      .input('Address1', sql.NVarChar, validated.address1 ?? current.Address1)
      .input('Address2', sql.NVarChar, validated.address2 ?? current.Address2)
      .input('City', sql.NVarChar, validated.city ?? current.City)
      .input('State', sql.NVarChar, validated.state ?? current.State)
      .input('Zip', sql.NVarChar, validated.zip ?? current.Zip)
      .input('Phone', sql.NVarChar, validated.phone ?? current.Phone)
      .input('Fax', sql.NVarChar, validated.fax ?? current.Fax)
      .input('Latitude', sql.Decimal(10, 7), validated.latitude ?? current.Latitude)
      .input('Longitude', sql.Decimal(10, 7), validated.longitude ?? current.Longitude)
      .input('MarketId', sql.Int, nextMarketId)
      .input('LegacyPharmacyInfoNo', sql.Int, validated.legacyPharmacyInfoNo ?? current.LegacyPharmacyInfoNo)
      .input('IsActive', sql.Bit, validated.isActive ?? current.IsActive)
      .query(`
        UPDATE dbo.PharmacyFlyer_Pharmacy
        SET
          PharmacyName = @PharmacyName,
          Address1 = @Address1,
          Address2 = @Address2,
          City = @City,
          State = @State,
          Zip = @Zip,
          Phone = @Phone,
          Fax = @Fax,
          Latitude = @Latitude,
          Longitude = @Longitude,
          MarketId = @MarketId,
          LegacyPharmacyInfoNo = @LegacyPharmacyInfoNo,
          IsActive = @IsActive,
          UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE PharmacyId = @PharmacyId
      `);

    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Pharmacy update error:', error);
    res.status(500).json({ message: 'Could not update pharmacy' });
  }
});
