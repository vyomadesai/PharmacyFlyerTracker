import { getPool, sql } from '../config/db.js';

const ACTIVE_DOCTOR_FILTER = (alias = 'd') =>
  `LTRIM(RTRIM(ISNULL(${alias}.Doctor_IsActive, ' '))) <> 'N'`;
const zipExpr = (alias = 'd') =>
  `LTRIM(RTRIM(ISNULL(CAST(${alias}.Doctor_AddressZip AS VARCHAR(20)), '')))`;
const NPI_EXPR = `NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(10)))), '')`;

let doctorInfoByNpiEnabled: boolean | undefined;

export type DoctorTargetingFilters = {
  npi?: string | null;
  name?: string | null;
  specialty?: string | null;
  customSpecialty?: string | null;
  doctorType?: string | null;
  taxonomyCode?: string | null;
  requirePrimaryTaxonomy?: boolean | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  marketId?: number | null;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  radiusMiles?: number | null;
  hasPhone?: boolean | null;
  hasFax?: boolean | null;
  limit?: number;
};

export type TargetedDoctorRow = {
  DoctorId: number;
  NPI: string | null;
  DoctorName: string;
  FirstName: string | null;
  LastName: string | null;
  Specialty: string | null;
  CustomSpecialtyText: string | null;
  DoctorType: string;
  PrimaryAddress: string | null;
  SecondaryAddress: string | null;
  City: string | null;
  State: string | null;
  Zip: string | null;
  Phone: string | null;
  Fax: string | null;
  LicenseNumber: string | null;
  TaxonomyCode: string | null;
  PrimaryTaxonomy: boolean | null;
  TaxonomyDescription: string | null;
  PracticeName: string | null;
  Latitude: number | null;
  Longitude: number | null;
  CoordinateSource: string | null;
  DistanceMiles: number | null;
  LocalRecordCount: number;
  DuplicateDoctorIds: string | null;
};

async function usesDoctorInfoByNpi() {
  if (doctorInfoByNpiEnabled !== undefined) return doctorInfoByNpiEnabled;

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT 1 AS HasNpi
    FROM sys.columns c
    INNER JOIN sys.objects o ON c.object_id = o.object_id
    INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
    WHERE s.name = 'dbo' AND o.name = 'PharmacyFlyer_DoctorInfo' AND c.name = 'NPI'
  `);

  doctorInfoByNpiEnabled = Boolean(result.recordset[0]);
  return doctorInfoByNpiEnabled;
}

function coordinateSql(alias = 'd') {
  const zip = zipExpr(alias);
  return {
    latitude: `
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${alias}.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
          OR ${zip} IN ('33781', '33782')
          THEN CAST(27.8428 AS DECIMAL(10,7))
        ELSE NULL
      END
    `,
    longitude: `
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${alias}.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
          OR ${zip} IN ('33781', '33782')
          THEN CAST(-82.6995 AS DECIMAL(10,7))
        ELSE NULL
      END
    `,
    source: `
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${alias}.Doctor_AddressCity, '')))) = 'PINELLAS PARK'
          OR ${zip} IN ('33781', '33782')
          THEN 'derived-pinellas-park-city-zip'
        ELSE NULL
      END
    `,
  };
}

function doctorTypeCaseSql(specialtyExpr: string, taxonomyCodeExpr: string) {
  return `
    CASE
      WHEN ${taxonomyCodeExpr} LIKE '207Q%' OR ${taxonomyCodeExpr} LIKE '207R00000X' OR ${specialtyExpr} LIKE '%PRIMARY%'
        OR ${specialtyExpr} LIKE '%FAMILY%' OR ${specialtyExpr} LIKE '%INTERNAL MED%'
        OR ${specialtyExpr} LIKE '%GENERAL PRACT%'
        THEN 'primary_care'
      WHEN ${specialtyExpr} IS NOT NULL AND LTRIM(RTRIM(${specialtyExpr})) <> ''
        OR ${taxonomyCodeExpr} IS NOT NULL AND LTRIM(RTRIM(${taxonomyCodeExpr})) <> ''
        THEN 'specialist'
      ELSE 'any'
    END
  `;
}

function haversineSql(latExpr: string, lonExpr: string, latParam: string, lonParam: string) {
  return `
    (3958.8 * 2 * ATN2(
      SQRT(
        POWER(SIN((RADIANS(${latExpr}) - RADIANS(${latParam})) / 2.0), 2)
        + COS(RADIANS(${latParam})) * COS(RADIANS(${latExpr}))
        * POWER(SIN((RADIANS(${lonExpr}) - RADIANS(${lonParam})) / 2.0), 2)
      ),
      SQRT(1.0 - (
        POWER(SIN((RADIANS(${latExpr}) - RADIANS(${latParam})) / 2.0), 2)
        + COS(RADIANS(${latParam})) * COS(RADIANS(${latExpr}))
        * POWER(SIN((RADIANS(${lonExpr}) - RADIANS(${lonParam})) / 2.0), 2)
      ))
    ))
  `;
}

async function attachDuplicateDoctorIds(rows: TargetedDoctorRow[]) {
  const npis = [...new Set(rows.filter((row) => row.LocalRecordCount > 1 && row.NPI).map((row) => row.NPI as string))];
  if (!npis.length) {
    return rows.map((row) => ({
      ...row,
      DuplicateDoctorIds: row.LocalRecordCount > 1 ? row.DuplicateDoctorIds : String(row.DoctorId),
    }));
  }

  const pool = await getPool();
  const request = pool.request();
  const npiParams = npis.map((npi, index) => {
    request.input(`Npi${index}`, sql.VarChar, npi);
    return `@Npi${index}`;
  });

  const mdNpiExpr = `NULLIF(LTRIM(RTRIM(CAST(md.Doctor_NPINo AS VARCHAR(10)))), '')`;
  const duplicateResult = await request.query(`
    SELECT
      ${mdNpiExpr} AS NPI,
      STRING_AGG(CAST(md.ID AS VARCHAR(20)), ',') WITHIN GROUP (ORDER BY md.ID) AS DuplicateDoctorIds
    FROM dbo.Master_Doctor md WITH (NOLOCK)
    WHERE ${mdNpiExpr} IN (${npiParams.join(', ')})
    GROUP BY ${mdNpiExpr}
  `);

  const duplicateMap = new Map<string, string>(
    duplicateResult.recordset.map((row: { NPI: string; DuplicateDoctorIds: string }) => [row.NPI, row.DuplicateDoctorIds]),
  );

  return rows.map((row) => ({
    ...row,
    DuplicateDoctorIds: row.NPI && duplicateMap.has(row.NPI)
      ? duplicateMap.get(row.NPI)!
      : String(row.DoctorId),
  }));
}

export async function searchTargetedDoctors(filters: DoctorTargetingFilters) {
  const pool = await getPool();
  const coords = coordinateSql('d');
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const includeDoctorInfo = await usesDoctorInfoByNpi();
  const doctorInfoSpecialty = includeDoctorInfo ? `NULLIF(LTRIM(RTRIM(pdi.PriSpec)), '')` : 'NULL';
  const specialtyExpr = `COALESCE(${doctorInfoSpecialty}, NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), ''))`;

  let centerLat = filters.centerLatitude ?? null;
  let centerLng = filters.centerLongitude ?? null;
  let radiusMiles = filters.radiusMiles ?? null;

  if (filters.marketId) {
    const marketResult = await pool.request()
      .input('MarketId', sql.Int, filters.marketId)
      .query(`
        SELECT TOP 1 CenterLatitude, CenterLongitude, RadiusMiles
        FROM dbo.PharmacyFlyer_Market
        WHERE MarketId = @MarketId AND IsActive = 1
      `);
    const market = marketResult.recordset[0];
    if (market) {
      centerLat = centerLat ?? (market.CenterLatitude != null ? Number(market.CenterLatitude) : null);
      centerLng = centerLng ?? (market.CenterLongitude != null ? Number(market.CenterLongitude) : null);
      radiusMiles = radiusMiles ?? (market.RadiusMiles != null ? Number(market.RadiusMiles) : null);
    }
  }

  const taxonomyCodeExpr = `NULLIF(LTRIM(RTRIM(nrc.TaxonomyCode)), '')`;
  const doctorTypeExpr = doctorTypeCaseSql(specialtyExpr, taxonomyCodeExpr);
  const distanceExpr = centerLat != null && centerLng != null
    ? haversineSql(coords.latitude, coords.longitude, '@CenterLatitude', '@CenterLongitude')
    : null;

  const baseWhereParts = [ACTIVE_DOCTOR_FILTER('d')];
  if (filters.npi) baseWhereParts.push(`${NPI_EXPR} LIKE @NpiLike`);
  if (filters.city) {
    baseWhereParts.push(`(UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) LIKE UPPER(@CityLike))`);
  }
  if (filters.state) {
    baseWhereParts.push(`(UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, '')))) = UPPER(@State))`);
  }
  if (filters.zip) baseWhereParts.push(`(${zipExpr('d')} LIKE @ZipLike)`);
  if (radiusMiles != null && centerLat != null && centerLng != null) {
    baseWhereParts.push(`(
      ${coords.latitude} IS NOT NULL AND ${coords.longitude} IS NOT NULL
      AND ${distanceExpr} <= @RadiusMiles
    )`);
  }

  const enrichedWhereParts: string[] = [];
  if (filters.name) {
    enrichedWhereParts.push(`(
      d.Doctor_FirstName LIKE @NameLike OR d.Doctor_LastName LIKE @NameLike
      OR CONCAT(d.Doctor_FirstName, ' ', d.Doctor_LastName) LIKE @NameLike
      OR CONCAT(nrc.FirstName, ' ', nrc.LastName) LIKE @NameLike
    )`);
  }
  if (filters.specialty) enrichedWhereParts.push(`${specialtyExpr} LIKE @SpecialtyLike`);
  if (filters.customSpecialty) enrichedWhereParts.push(`${specialtyExpr} LIKE @CustomSpecialtyLike`);
  if (filters.taxonomyCode) enrichedWhereParts.push(`${taxonomyCodeExpr} = @TaxonomyCode`);
  if (filters.requirePrimaryTaxonomy === true) {
    enrichedWhereParts.push(`(${taxonomyCodeExpr} IS NOT NULL)`);
  }
  if (filters.doctorType && filters.doctorType !== 'any') {
    enrichedWhereParts.push(`${doctorTypeExpr} = @DoctorType`);
  }
  if (filters.hasPhone === true) {
    enrichedWhereParts.push(`(NULLIF(LTRIM(RTRIM(COALESCE(nrc.Phone, d.Doctor_Phone, d.Doctor_MobileNo))), '') IS NOT NULL)`);
  }
  if (filters.hasFax === true) {
    enrichedWhereParts.push(`(NULLIF(LTRIM(RTRIM(nrc.Fax)), '') IS NOT NULL)`);
  }

  const enrichedWhereClause = enrichedWhereParts.length
    ? `WHERE ${enrichedWhereParts.join(' AND ')}`
    : '';

  const doctorInfoCte = includeDoctorInfo
    ? `
      DoctorInfoByNpi AS (
        SELECT
          LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) AS NPI,
          LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) AS PriSpec,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10))))
            ORDER BY
              CASE WHEN LTRIM(RTRIM(ISNULL(pdi.pri_spec, ''))) <> '' THEN 0 ELSE 1 END,
              pdi.adrs_id
          ) AS NpiRank
        FROM dbo.PharmacyFlyer_DoctorInfo pdi WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(10)))) <> ''
      ),
    `
    : '';

  const doctorInfoJoin = includeDoctorInfo
    ? `LEFT JOIN DoctorInfoByNpi pdi ON pdi.NPI = ${NPI_EXPR} AND pdi.NpiRank = 1`
    : '';

  const request = pool.request()
    .input('NpiLike', sql.NVarChar, filters.npi ? `%${filters.npi.replace(/\D/g, '')}%` : null)
    .input('NameLike', sql.NVarChar, filters.name ? `%${filters.name}%` : null)
    .input('SpecialtyLike', sql.NVarChar, filters.specialty ? `%${filters.specialty}%` : null)
    .input('CustomSpecialtyLike', sql.NVarChar, filters.customSpecialty ? `%${filters.customSpecialty}%` : null)
    .input('TaxonomyCode', sql.VarChar, filters.taxonomyCode || null)
    .input('CityLike', sql.NVarChar, filters.city ? `%${filters.city}%` : null)
    .input('State', sql.NVarChar, filters.state || null)
    .input('ZipLike', sql.NVarChar, filters.zip ? `%${filters.zip}%` : null)
    .input('DoctorType', sql.VarChar, filters.doctorType && filters.doctorType !== 'any' ? filters.doctorType : null)
    .input('CenterLatitude', sql.Decimal(10, 7), centerLat)
    .input('CenterLongitude', sql.Decimal(10, 7), centerLng)
    .input('RadiusMiles', sql.Decimal(8, 2), radiusMiles)
    .input('Limit', sql.Int, limit);

  const query = `
    WITH
    ${doctorInfoCte}
    PracticeByDoctor AS (
      SELECT
        dlm.Doctor_No,
        LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))) AS PracticeName,
        ROW_NUMBER() OVER (PARTITION BY dlm.Doctor_No ORDER BY dlm.Practice_Id DESC) AS PracticeRank
      FROM dbo.Doctor_Location_Mapping dlm WITH (NOLOCK)
      INNER JOIN dbo.Master_Practice mp WITH (NOLOCK) ON mp.ID = dlm.Practice_Id
      WHERE ISNULL(dlm.Mapping_IsActive, 0) = 1
    ),
    BaseDoctors AS (
      SELECT d.*
      FROM dbo.Master_Doctor d WITH (NOLOCK)
      WHERE ${baseWhereParts.join(' AND ')}
    ),
    Enriched AS (
      SELECT
        d.ID AS DoctorId,
        ${NPI_EXPR} AS NPI,
        LTRIM(RTRIM(COALESCE(nrc.FirstName, d.Doctor_FirstName, ''))) AS FirstName,
        LTRIM(RTRIM(COALESCE(nrc.LastName, d.Doctor_LastName, ''))) AS LastName,
        LTRIM(RTRIM(CONCAT(
          COALESCE(nrc.FirstName, d.Doctor_FirstName, ''), ' ',
          COALESCE(nrc.LastName, d.Doctor_LastName, '')
        ))) AS DoctorName,
        ${specialtyExpr} AS Specialty,
        CAST(NULL AS NVARCHAR(300)) AS CustomSpecialtyText,
        ${doctorTypeExpr} AS DoctorType,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.Address1)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressStreet)), '')) AS PrimaryAddress,
        NULLIF(LTRIM(RTRIM(nrc.Address2)), '') AS SecondaryAddress,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.City)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressCity)), '')) AS City,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.State)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_AddressState)), '')) AS State,
        ${zipExpr('d')} AS Zip,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Phone)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_MobileNo)), '')) AS Phone,
        NULLIF(LTRIM(RTRIM(nrc.Fax)), '') AS Fax,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.LicenseNumber)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_LIC)), '')) AS LicenseNumber,
        ${taxonomyCodeExpr} AS TaxonomyCode,
        CASE WHEN ${taxonomyCodeExpr} IS NOT NULL THEN CAST(1 AS BIT) ELSE NULL END AS PrimaryTaxonomy,
        COALESCE(NULLIF(LTRIM(RTRIM(nrc.TaxonomyDesc)), ''), NULLIF(LTRIM(RTRIM(d.Doctor_Type)), '')) AS TaxonomyDescription,
        pb.PracticeName,
        ${coords.latitude} AS Latitude,
        ${coords.longitude} AS Longitude,
        ${coords.source} AS CoordinateSource,
        ${distanceExpr ? `CAST(${distanceExpr} AS DECIMAL(10, 2))` : 'CAST(NULL AS DECIMAL(10, 2))'} AS DistanceMiles,
        COALESCE(nrc.MasterDoctorID, d.ID) AS CanonicalDoctorId
      FROM BaseDoctors d
      LEFT JOIN dbo.npiRegisteryConfig nrc WITH (NOLOCK) ON nrc.NPI = ${NPI_EXPR}
      ${doctorInfoJoin}
      LEFT JOIN PracticeByDoctor pb ON pb.Doctor_No = d.Doctor_NO AND pb.PracticeRank = 1
      ${enrichedWhereClause}
    ),
    Grouped AS (
      SELECT
        e.*,
        COUNT(*) OVER (
          PARTITION BY COALESCE(NULLIF(e.NPI, ''), CONCAT('NO-NPI-', CAST(e.DoctorId AS VARCHAR(20))))
        ) AS LocalRecordCount,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(e.NPI, ''), CONCAT('NO-NPI-', CAST(e.DoctorId AS VARCHAR(20))))
          ORDER BY
            CASE WHEN e.CanonicalDoctorId = e.DoctorId THEN 0 ELSE 1 END,
            e.DoctorId
        ) AS NpiRank
      FROM Enriched e
    )
    SELECT TOP (@Limit)
      DoctorId,
      NPI,
      DoctorName,
      FirstName,
      LastName,
      Specialty,
      CustomSpecialtyText,
      DoctorType,
      PrimaryAddress,
      SecondaryAddress,
      City,
      State,
      Zip,
      Phone,
      Fax,
      LicenseNumber,
      TaxonomyCode,
      PrimaryTaxonomy,
      TaxonomyDescription,
      PracticeName,
      Latitude,
      Longitude,
      CoordinateSource,
      DistanceMiles,
      LocalRecordCount,
      CAST(NULL AS VARCHAR(500)) AS DuplicateDoctorIds
    FROM Grouped
    WHERE NpiRank = 1
    ORDER BY
      CASE WHEN DistanceMiles IS NULL THEN 1 ELSE 0 END,
      DistanceMiles,
      DoctorName
  `;

  const result = await request.query(query);
  return attachDuplicateDoctorIds(result.recordset as TargetedDoctorRow[]);
}

export async function applyConfigFilters(config: Record<string, unknown>): Promise<DoctorTargetingFilters> {
  const filters: DoctorTargetingFilters = {};

  if (config.DoctorType && String(config.DoctorType) !== 'any') {
    filters.doctorType = String(config.DoctorType);
  }
  if (config.TaxonomyCode) filters.taxonomyCode = String(config.TaxonomyCode);
  if (config.RequirePrimaryTaxonomy != null) {
    filters.requirePrimaryTaxonomy = Boolean(config.RequirePrimaryTaxonomy);
  }
  if (config.MarketId) filters.marketId = Number(config.MarketId);
  if (config.CenterLatitude != null) filters.centerLatitude = Number(config.CenterLatitude);
  if (config.CenterLongitude != null) filters.centerLongitude = Number(config.CenterLongitude);
  if (config.RadiusMiles != null) filters.radiusMiles = Number(config.RadiusMiles);

  if (config.SpecialtySource === 'backend' && config.SpecialtyValue) {
    filters.specialty = String(config.SpecialtyValue);
  }
  if (config.SpecialtySource === 'custom' && config.CustomSpecialtyText) {
    filters.customSpecialty = String(config.CustomSpecialtyText);
  } else if (config.SpecialtyValue && !filters.specialty) {
    filters.specialty = String(config.SpecialtyValue);
  }

  return filters;
}
