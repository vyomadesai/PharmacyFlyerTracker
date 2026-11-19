import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

export const doctorsRoutes = Router();
doctorsRoutes.use(requireAuth);

const ACTIVE_DOCTOR_FILTER = `LTRIM(RTRIM(ISNULL(Doctor_IsActive, ' '))) <> 'N'`;
const ZIP_EXPR = `LTRIM(RTRIM(ISNULL(CAST(Doctor_AddressZip AS VARCHAR(20)), '')))`;

function stripPhoneExpr(column: string) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '(', ''), ')', ''), ' ', ''), '.', ''), '+', ''), '/', '')`;
}

function detectSearchBy(q: string) {
  if (/^\d{5}$/.test(q)) return 'zip';
  if (/^\d+$/.test(q)) return 'phone';
  return 'name';
}

const DOCTOR_SELECT = `
  d.ID,
  d.Doctor_NO,
  LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS Doctor_FirstName,
  LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS Doctor_LastName,
  LTRIM(RTRIM(ISNULL(d.Doctor_LIC, ''))) AS Doctor_LIC,
  LTRIM(RTRIM(ISNULL(d.Doctor_Type, ''))) AS Doctor_Type,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS Doctor_AddressStreet,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS Doctor_AddressCity,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS Doctor_AddressState,
  ${ZIP_EXPR.replace(/Doctor_AddressZip/g, 'd.Doctor_AddressZip')} AS Doctor_AddressZip,
  LTRIM(RTRIM(ISNULL(d.Doctor_Phone, ''))) AS Doctor_Phone,
  LTRIM(RTRIM(ISNULL(d.Doctor_MobileNo, ''))) AS Doctor_MobileNo,
  LTRIM(RTRIM(ISNULL(d.Doctor_Email, ''))) AS Doctor_Email,
  LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, ''))) AS Doctor_NPINo,
  CASE
    WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
      OR ${ZIP_EXPR.replace(/Doctor_AddressZip/g, 'd.Doctor_AddressZip')} IN ('33781', '33782')
      THEN CAST(27.8428 AS DECIMAL(10,7))
    ELSE NULL
  END AS DropoffLatitude,
  CASE
    WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
      OR ${ZIP_EXPR.replace(/Doctor_AddressZip/g, 'd.Doctor_AddressZip')} IN ('33781', '33782')
      THEN CAST(-82.6995 AS DECIMAL(10,7))
    ELSE NULL
  END AS DropoffLongitude,
  CASE
    WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
      OR ${ZIP_EXPR.replace(/Doctor_AddressZip/g, 'd.Doctor_AddressZip')} IN ('33781', '33782')
      THEN 'derived-pinellas-park-city-zip'
    ELSE NULL
  END AS DropoffCoordinateSource,
  CAST(NULL AS DATETIME2) AS DropoffGeocodedAt,
  (
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(mp.Practice_Name, '')))
    FROM dbo.Doctor_Location_Mapping dlm
    INNER JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id
    WHERE dlm.Doctor_No = d.Doctor_NO
      AND ISNULL(dlm.Mapping_IsActive, 0) = 1
    ORDER BY dlm.Practice_Id DESC
  ) AS Practice_Name
`;

doctorsRoutes.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);

  const searchBy = String(req.query.searchBy || detectSearchBy(q)).toLowerCase();
  const like = `%${q}%`;
  const digitsOnly = q.replace(/\D/g, '');
  const phoneLike = digitsOnly ? `%${digitsOnly}%` : like;

  const phoneExpr = stripPhoneExpr(`LTRIM(RTRIM(ISNULL(d.Doctor_Phone, '')))`);
  const mobileExpr = stripPhoneExpr(`LTRIM(RTRIM(ISNULL(d.Doctor_MobileNo, '')))`);
  const zipExpr = ZIP_EXPR.replace(/Doctor_AddressZip/g, 'd.Doctor_AddressZip');

  const practiceExists = `
    EXISTS (
      SELECT 1
      FROM dbo.Doctor_Location_Mapping dlm
      INNER JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id
      WHERE dlm.Doctor_No = d.Doctor_NO
        AND ISNULL(dlm.Mapping_IsActive, 0) = 1
        AND mp.Practice_Name LIKE @like
    )
  `;

  let whereClause = '';
  if (searchBy === 'phone') {
    whereClause = `
      (${phoneExpr} LIKE @phoneLike OR RIGHT(${phoneExpr}, 10) LIKE @phoneLike
       OR ${mobileExpr} LIKE @phoneLike OR RIGHT(${mobileExpr}, 10) LIKE @phoneLike)
    `;
  } else if (searchBy === 'zip') {
    whereClause = `${zipExpr} LIKE @like`;
  } else {
    whereClause = `
      d.Doctor_FirstName LIKE @like
      OR d.Doctor_LastName LIKE @like
      OR d.Doctor_AddressStreet LIKE @like
      OR d.Doctor_AddressCity LIKE @like
      OR d.Doctor_AddressState LIKE @like
      OR ${zipExpr} LIKE @like
      OR d.Doctor_NPINo LIKE @like
      OR ${practiceExists}
    `;
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('like', sql.NVarChar, like)
      .input('phoneLike', sql.NVarChar, phoneLike)
      .query(`
        SELECT TOP 50
          ${DOCTOR_SELECT}
        FROM dbo.Master_Doctor d
        WHERE ${ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')}
        AND (${whereClause})
        ORDER BY d.Doctor_LastName, d.Doctor_FirstName
      `);

    res.json(result.recordset);
  } catch (error) {
    console.error('Doctor search error:', error);
    return res.status(500).json({ message: 'Doctor search failed' });
  }
});

doctorsRoutes.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query(`
        SELECT TOP 1
          ${DOCTOR_SELECT}
        FROM dbo.Master_Doctor d
        WHERE d.ID = @id
          AND ${ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')}
      `);

    if (!result.recordset[0]) return res.status(404).json({ message: 'Doctor not found' });
    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Doctor lookup error:', error);
    return res.status(500).json({ message: 'Doctor lookup failed' });
  }
});
