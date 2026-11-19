import { getPool, sql } from '../../config/db.js';
import { expandSpecialtyRules, loadUnifiedSpecialties } from './specialtyCatalog.js';

type SqlRequest = InstanceType<typeof sql.Request>;

export type CampaignSpecialtyRule = {
  campaignSpecialtyV2Id: number;
  campaignId: number;
  specialityRecId: number | null;
  specialityCode: string | null;
  description: string | null;
  matchLevel: string;
  matchMode: string;
  taxonomyCodes?: string[];
};

export type MatchedDoctorRow = {
  doctorId: number;
  doctorNo: number | null;
  doctorName: string;
  firstName: string | null;
  lastName: string | null;
  npi: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
  matchedSpecialityCode: string | null;
  matchedSpecialityDescription: string | null;
  matchedLevel: string | null;
  source: 'local' | 'npi';
  registryProviderId: number | null;
  practiceName: string | null;
  practiceId: number | null;
  locationId: number | null;
  locationName: string | null;
  locationAddressStreet: string | null;
  locationAddressCity: string | null;
  locationAddressZip: string | null;
  locationPhone: string | null;
};

const ACTIVE_DOCTOR_FILTER = `LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'`;

const PHONE_DIGITS = (column: string) =>
  `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(${column}, ''))), '-', ''), '(', ''), ')', ''), ' ', ''), '.', ''), '+', ''), '/', ''), 10)`;

/** Phone consistency between prescriber row and mapping row (when mapping phone is set). */
const MAPPING_PHONE_MATCH = `
  (
    NULLIF(LTRIM(RTRIM(dlm.Doctor_Phone)), '') IS NULL
    OR ${PHONE_DIGITS('dlm.Doctor_Phone')} = ${PHONE_DIGITS('COALESCE(d.Doctor_Phone, d.Doctor_MobileNo)')}
  )
`;

const ACTIVE_MAPPING_DLM_FILTERS = `
  ISNULL(dlm.Mapping_IsActive, 0) = 1
  AND dlm.Location_Id IS NOT NULL
  AND ${MAPPING_PHONE_MATCH}
`;

const ACTIVE_MAPPING_FILTERS = `
  ${ACTIVE_MAPPING_DLM_FILTERS}
  AND ISNULL(ml.Location_IsActive, 1) = 1
`;

const HAS_ACTIVE_LOCATION_MAPPING = `
  EXISTS (
    SELECT 1
    FROM dbo.Doctor_Location_Mapping dlm
    INNER JOIN dbo.Master_Location ml ON ml.ID = dlm.Location_Id
    WHERE dlm.Doctor_No = d.Doctor_NO
      AND ${ACTIVE_MAPPING_FILTERS}
  )
`;

/** Route planner includes only doctors with an active Doctor_Location_Mapping row. */
const MAPPED_DOCTOR_ONLY = `
  AND ${HAS_ACTIVE_LOCATION_MAPPING}
`;

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

function specialtyMatchSql(
  rule: CampaignSpecialtyRule,
  index: number,
  request: SqlRequest,
): string | null {
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

function isNpiTaxonomyCode(value: string | null | undefined) {
  return /^[0-9]{3}[A-Z0-9]{7,}$/i.test(String(value || '').trim());
}

function npiTaxonomyMatchSql(
  rule: CampaignSpecialtyRule,
  index: number,
  request: SqlRequest,
): string | null {
  const codes = [...new Set(
    (rule.taxonomyCodes?.length
      ? rule.taxonomyCodes
      : (rule.specialityCode && isNpiTaxonomyCode(rule.specialityCode) ? [rule.specialityCode] : [])
    ).map((code) => code.trim().toUpperCase()).filter(Boolean),
  )];
  if (!codes.length) return null;
  const params = codes.map((code, codeIndex) => {
    const param = `NpiTaxCode${index}_${codeIndex}`;
    request.input(param, sql.VarChar(20), code);
    return `@${param}`;
  });
  return `UPPER(LTRIM(RTRIM(t.TaxonomyCode))) IN (${params.join(', ')})`;
}

function buildNpiTaxonomyRuleClauses(rules: CampaignSpecialtyRule[], request: SqlRequest): string[] {
  const clauses: string[] = [];
  rules.forEach((rule, index) => {
    const taxonomyMatch = npiTaxonomyMatchSql(rule, index, request);
    if (!taxonomyMatch) return;
    clauses.push(`(${taxonomyMatch})`);
  });
  return clauses;
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

function campaignFrequencyDays(campaign: Record<string, unknown>): number | null {
  const days = Number(campaign.FrequencyInDays);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : null;
}

function recentDropFilterSql(): string {
  return `
    AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT del.SubmittedAt AS LastDropAt
        FROM dbo.PharmacyFlyer_Delivery del
        WHERE del.CampaignId = @CampaignId
          AND del.DoctorId = d.ID
          AND ISNULL(del.FlyerDelivered, 1) = 1
        UNION ALL
        SELECT rd.CompletedAt AS LastDropAt
        FROM dbo.PharmacyFlyer_RoutePlanDropV2 rd
        WHERE rd.CampaignId = @CampaignId
          AND rd.DoctorId = d.ID
          AND rd.Status = 'completed'
          AND rd.CompletedAt IS NOT NULL
      ) recent
      WHERE recent.LastDropAt >= DATEADD(day, -@FrequencyInDays, SYSDATETIME())
    )
  `;
}

export async function loadCampaignSpecialtyRules(campaignId: number) {
  const pool = await getPool();

  const campaignResult = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`
      SELECT TOP 1
        CampaignId,
        CampaignName,
        Description,
        FlyerTitle,
        IsActive,
        COALESCE(FrequencyInDays, DefaultVisitFrequencyDays) AS FrequencyInDays
      FROM dbo.PharmacyFlyer_Campaign
      WHERE CampaignId = @CampaignId
    `);

  const campaign = campaignResult.recordset[0] as Record<string, unknown> | undefined;
  if (!campaign) return null;

  const rulesResult = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`
      SELECT
        CampaignSpecialtyV2Id,
        CampaignId,
        SpecialityRecID,
        SpecialityCode,
        Description,
        MatchLevel,
        MatchMode
      FROM dbo.PharmacyFlyer_CampaignSpecialtyV2
      WHERE CampaignId = @CampaignId AND IsActive = 1
      ORDER BY CampaignSpecialtyV2Id
    `);

  const rules: CampaignSpecialtyRule[] = rulesResult.recordset.map((row: Record<string, unknown>) => ({
    campaignSpecialtyV2Id: Number(row.CampaignSpecialtyV2Id),
    campaignId: Number(row.CampaignId),
    specialityRecId: row.SpecialityRecID != null ? Number(row.SpecialityRecID) : null,
    specialityCode: row.SpecialityCode != null ? String(row.SpecialityCode).trim() : null,
    description: row.Description != null ? String(row.Description).trim() : null,
    matchLevel: String(row.MatchLevel || 'any'),
    matchMode: String(row.MatchMode || 'secondary_only'),
  }));

  const catalog = await loadUnifiedSpecialties();
  return { campaign, rules: expandSpecialtyRules(rules, catalog) };
}

export async function findMatchingDoctorsForCampaign(
  campaignId: number,
  includeUnmapped = false,
): Promise<{
  campaign: Record<string, unknown>;
  doctors: MatchedDoctorRow[];
} | null> {
  const loaded = await loadCampaignSpecialtyRules(campaignId);
  if (!loaded) return null;

  const { campaign, rules } = loaded;
  if (!rules.length) {
    return { campaign, doctors: [] };
  }

  const pool = await getPool();
  const request = pool.request().input('CampaignId', sql.Int, campaignId);
  const ruleClauses = buildRuleWhereClauses(rules, request);
  const npiTaxonomyClauses = buildNpiTaxonomyRuleClauses(rules, request);

  if (!ruleClauses.length && !npiTaxonomyClauses.length) {
    const registryDoctors = await findNpiRegistryDoctorsForRules(rules, []);
    return { campaign, doctors: registryDoctors };
  }

  // Visit cadence is now location-based (computed per stop), so the admin
  // location list shows every matched location regardless of recent visits.
  const frequencyFilter = '';

  const specialtyMatchesCte = ruleClauses.length ? `
    SpecialtyMatches AS (
      SELECT
        d.ID AS DoctorId,
        d.Doctor_NO AS DoctorNoRaw,
        TRY_CONVERT(INT, d.Doctor_NO) AS DoctorNo,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS DoctorName,
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS FirstName,
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS LastName,
        NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') AS Npi,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
        LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
        NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS Phone,
        sl.SpecialityCode AS MatchedSpecialityCode,
        sl.Description AS MatchedSpecialityDescription,
        ps.Level AS MatchedLevel,
        ROW_NUMBER() OVER (
          PARTITION BY d.ID
          ORDER BY
            CASE ps.Level WHEN '2' THEN 1 WHEN '1' THEN 2 WHEN '3' THEN 3 ELSE 4 END,
            sl.SpecialityCode,
            sl.Description
        ) AS DoctorRank
      FROM dbo.Master_Doctor d
      INNER JOIN dbo.Master_PrescribSpeciality ps
        ON ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
        AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
      INNER JOIN dbo.Master_PrsSpecialitiesList sl
        ON sl.RecID = ps.SpecialityID
        AND ISNULL(sl.IsActive, 1) = 1
      WHERE ${ACTIVE_DOCTOR_FILTER}
        AND (${ruleClauses.join(' OR ')})
        ${frequencyFilter}
    ),` : '';

  const npiTaxonomyMatchesCte = npiTaxonomyClauses.length ? `
    NpiTaxonomyMatches AS (
      SELECT
        d.ID AS DoctorId,
        d.Doctor_NO AS DoctorNoRaw,
        TRY_CONVERT(INT, d.Doctor_NO) AS DoctorNo,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS DoctorName,
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS FirstName,
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS LastName,
        NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') AS Npi,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
        LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
        NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS Phone,
        t.TaxonomyCode AS MatchedSpecialityCode,
        t.TaxonomyDescription AS MatchedSpecialityDescription,
        'npi' AS MatchedLevel,
        ROW_NUMBER() OVER (
          PARTITION BY d.ID
          ORDER BY t.TaxonomyCode, t.TaxonomyDescription
        ) AS DoctorRank
      FROM dbo.Master_Doctor d
      INNER JOIN dbo.PharmacyFlyer_NPI_Registry_Data n
        ON REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(CAST(d.Doctor_NPINo AS VARCHAR(20)), ''))), ' ', ''), '-', '') = n.Npi
        AND n.Status = 'Active'
      INNER JOIN dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy t
        ON t.RegistryProviderId = n.RegistryProviderId
        AND t.IsPrimary = 1
      WHERE ${ACTIVE_DOCTOR_FILTER}
        AND (${npiTaxonomyClauses.join(' OR ')})
        ${frequencyFilter}
    ),` : '';

  const eligibleUnionParts: string[] = [];
  if (ruleClauses.length) eligibleUnionParts.push(`SELECT * FROM SpecialtyMatches WHERE DoctorRank = 1`);
  if (npiTaxonomyClauses.length) {
    eligibleUnionParts.push(`
      SELECT * FROM NpiTaxonomyMatches WHERE DoctorRank = 1
      ${ruleClauses.length ? `AND NOT EXISTS (
        SELECT 1 FROM SpecialtyMatches sm
        WHERE sm.DoctorId = NpiTaxonomyMatches.DoctorId AND sm.DoctorRank = 1
      )` : ''}
    `);
  }

  const result = await request.query(`
    WITH
    ${specialtyMatchesCte}
    ${npiTaxonomyMatchesCte}
    EligibleDoctors AS (
      ${eligibleUnionParts.join(' UNION ALL ')}
    ),
    MappedDoctors AS (
      SELECT
        ed.DoctorId,
        ed.DoctorNo,
        ed.DoctorName,
        ed.FirstName,
        ed.LastName,
        ed.Npi,
        ed.AddressStreet,
        ed.AddressCity,
        ed.AddressState,
        ed.AddressZip,
        ed.Phone,
        ed.MatchedSpecialityCode,
        ed.MatchedSpecialityDescription,
        ed.MatchedLevel,
        NULLIF(LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))), '') AS PracticeName,
        dlm.Practice_Id AS PracticeId,
        dlm.Location_Id AS LocationId,
        NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_Name, ''))), '') AS LocationName,
        NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_AddressStreet, ''))), '') AS LocationAddressStreet,
        NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, ''))), '') AS LocationAddressCity,
        NULLIF(LTRIM(RTRIM(ISNULL(CAST(ml.Location_AddressZip AS VARCHAR(20)), ''))), '') AS LocationAddressZip,
        NULLIF(LTRIM(RTRIM(COALESCE(dlm.Doctor_Phone, ml.Location_Phone, ''))), '') AS LocationPhone
      FROM EligibleDoctors ed
      INNER JOIN dbo.Master_Doctor d ON d.ID = ed.DoctorId
      INNER JOIN dbo.Doctor_Location_Mapping dlm
        ON dlm.Doctor_No = d.Doctor_NO
        AND ${ACTIVE_MAPPING_DLM_FILTERS}
      LEFT JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id
      INNER JOIN dbo.Master_Location ml ON ml.ID = dlm.Location_Id
        AND ISNULL(ml.Location_IsActive, 1) = 1
    )
    SELECT
      DoctorId,
      DoctorNo,
      DoctorName,
      FirstName,
      LastName,
      Npi,
      AddressStreet,
      AddressCity,
      AddressState,
      AddressZip,
      Phone,
      MatchedSpecialityCode,
      MatchedSpecialityDescription,
      MatchedLevel,
      PracticeName,
      PracticeId,
      LocationId,
      LocationName,
      LocationAddressStreet,
      LocationAddressCity,
      LocationAddressZip,
      LocationPhone
    FROM MappedDoctors
    ${includeUnmapped ? `
    UNION ALL
    SELECT
      ed.DoctorId,
      ed.DoctorNo,
      ed.DoctorName,
      ed.FirstName,
      ed.LastName,
      ed.Npi,
      ed.AddressStreet,
      ed.AddressCity,
      ed.AddressState,
      ed.AddressZip,
      ed.Phone,
      ed.MatchedSpecialityCode,
      ed.MatchedSpecialityDescription,
      ed.MatchedLevel,
      NULL AS PracticeName,
      NULL AS PracticeId,
      NULL AS LocationId,
      NULL AS LocationName,
      ed.AddressStreet AS LocationAddressStreet,
      ed.AddressCity AS LocationAddressCity,
      ed.AddressZip AS LocationAddressZip,
      ed.Phone AS LocationPhone
    FROM EligibleDoctors ed
    INNER JOIN dbo.Master_Doctor d ON d.ID = ed.DoctorId
    WHERE NOT EXISTS (
      SELECT 1
      FROM dbo.Doctor_Location_Mapping dlm
      INNER JOIN dbo.Master_Location ml ON ml.ID = dlm.Location_Id
        AND ISNULL(ml.Location_IsActive, 1) = 1
      WHERE dlm.Doctor_No = d.Doctor_NO
        AND ${ACTIVE_MAPPING_DLM_FILTERS}
    )` : ''}
    ORDER BY LastName, FirstName, DoctorId, LocationId
  `);

  const doctors: MatchedDoctorRow[] = result.recordset.map((row: Record<string, unknown>) => ({
    doctorId: Number(row.DoctorId),
    doctorNo: row.DoctorNo != null ? Number(row.DoctorNo) : null,
    doctorName: String(row.DoctorName || '').trim(),
    firstName: row.FirstName != null ? String(row.FirstName).trim() : null,
    lastName: row.LastName != null ? String(row.LastName).trim() : null,
    npi: row.Npi != null ? String(row.Npi).trim() : null,
    addressStreet: row.AddressStreet != null ? String(row.AddressStreet).trim() : null,
    addressCity: row.AddressCity != null ? String(row.AddressCity).trim() : null,
    addressState: row.AddressState != null ? String(row.AddressState).trim() : null,
    addressZip: row.AddressZip != null ? String(row.AddressZip).trim() : null,
    phone: row.Phone != null ? String(row.Phone).trim() : null,
    matchedSpecialityCode: row.MatchedSpecialityCode != null ? String(row.MatchedSpecialityCode).trim() : null,
    matchedSpecialityDescription: row.MatchedSpecialityDescription != null
      ? String(row.MatchedSpecialityDescription).trim()
      : null,
    matchedLevel: row.MatchedLevel != null ? String(row.MatchedLevel).trim() : null,
    source: 'local',
    registryProviderId: null,
    practiceName: row.PracticeName != null ? String(row.PracticeName).trim() : null,
    practiceId: row.PracticeId != null ? Number(row.PracticeId) : null,
    locationId: row.LocationId != null ? Number(row.LocationId) : null,
    locationName: row.LocationName != null ? String(row.LocationName).trim() : null,
    locationAddressStreet: row.LocationAddressStreet != null ? String(row.LocationAddressStreet).trim() : null,
    locationAddressCity: row.LocationAddressCity != null ? String(row.LocationAddressCity).trim() : null,
    locationAddressZip: row.LocationAddressZip != null ? String(row.LocationAddressZip).trim() : null,
    locationPhone: row.LocationPhone != null ? String(row.LocationPhone).trim() : null,
  }));

  const registryDoctors = (await findNpiRegistryDoctorsForRules(rules, doctors))
    .filter((doctor) => doctor.source === 'npi');

  return { campaign, doctors: [...doctors, ...registryDoctors] };
}

function normalizeNpi(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function normalizePersonName(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nameDedupeKey(value: unknown) {
  return normalizePersonName(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function dedupeDoctorRows(rows: MatchedDoctorRow[], options?: { byName?: boolean }): MatchedDoctorRow[] {
  const byName = options?.byName !== false;
  const seenIds = new Set<number>();
  const seenNpis = new Set<string>();
  const seenNames = new Set<string>();
  const unique: MatchedDoctorRow[] = [];

  for (const row of rows) {
    const npi = normalizeNpi(row.npi);
    const nameKey = nameDedupeKey(row.doctorName);
    if (row.doctorId > 0 && seenIds.has(row.doctorId)) continue;
    if (npi && seenNpis.has(npi)) continue;
    if (byName && nameKey && seenNames.has(nameKey)) continue;

    if (row.doctorId > 0) seenIds.add(row.doctorId);
    if (npi) seenNpis.add(npi);
    if (nameKey) seenNames.add(nameKey);

    unique.push({
      ...row,
      doctorName: normalizePersonName(row.doctorName) || row.doctorName,
      npi: npi || row.npi,
    });
  }

  return unique;
}

function collectTaxonomyCodes(rules: CampaignSpecialtyRule[]) {
  return [...new Set(
    rules.flatMap((rule) => {
      const fromRule = rule.taxonomyCodes || [];
      const fromCode = rule.specialityCode && isNpiTaxonomyCode(rule.specialityCode)
        ? [rule.specialityCode]
        : [];
      return [...fromRule, ...fromCode].map((code) => code.trim().toUpperCase()).filter(Boolean);
    }),
  )];
}

async function findNpiRegistryDoctorsForRules(
  rules: CampaignSpecialtyRule[],
  existing: MatchedDoctorRow[],
): Promise<MatchedDoctorRow[]> {
  const codes = collectTaxonomyCodes(rules);
  if (!codes.length) return [];

  const existingNpis = new Set(
    existing
      .map((doctor) => String(doctor.npi || '').replace(/\D/g, '').slice(-10))
      .filter((npi) => npi.length === 10),
  );
  const existingDoctorIds = new Set(existing.map((doctor) => doctor.doctorId).filter((id) => id > 0));

  const pool = await getPool();
  const request = pool.request();
  const params = codes.map((code, index) => {
    const param = `RegTax${index}`;
    request.input(param, sql.VarChar(20), code);
    return `@${param}`;
  });

  const result = await request.query(`
    SELECT *
    FROM (
      SELECT
        d.ID AS MasterDoctorId,
        TRY_CONVERT(INT, d.Doctor_NO) AS DoctorNo,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS MasterDoctorName,
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS MasterFirstName,
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS MasterLastName,
        p.RegistryProviderId,
        p.Npi,
        p.ProviderName,
        COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))), ''), p.PrimaryStreetLine1) AS AddressStreet,
        COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))), ''), p.PrimaryCity) AS AddressCity,
        COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))), ''), p.PrimaryState) AS AddressState,
        COALESCE(NULLIF(LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))), ''), p.PrimaryPostalCode) AS AddressZip,
        COALESCE(
          NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), ''),
          p.PrimaryPhone
        ) AS Phone,
        t.TaxonomyCode,
        t.TaxonomyDescription,
        ROW_NUMBER() OVER (
          PARTITION BY TRY_CONVERT(BIGINT, p.Npi)
          ORDER BY CASE WHEN d.ID IS NOT NULL THEN 0 ELSE 1 END, t.TaxonomyCode
        ) AS rn
      FROM dbo.PharmacyFlyer_NPI_Registry_Data p
      INNER JOIN dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy t
        ON t.RegistryProviderId = p.RegistryProviderId
        AND t.IsPrimary = 1
      LEFT JOIN (
        SELECT
          d.ID,
          d.Doctor_NO,
          d.Doctor_FirstName,
          d.Doctor_LastName,
          d.Doctor_AddressStreet,
          d.Doctor_AddressCity,
          d.Doctor_AddressState,
          d.Doctor_AddressZip,
          d.Doctor_Phone,
          d.Doctor_MobileNo,
          d.Doctor_NPINo,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(
              TRY_CONVERT(BIGINT, d.Doctor_NPINo),
              CAST(d.ID AS BIGINT)
            )
            ORDER BY d.ID
          ) AS doctor_rn
        FROM dbo.Master_Doctor d
        WHERE LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'
      ) d
        ON TRY_CONVERT(BIGINT, d.Doctor_NPINo) = TRY_CONVERT(BIGINT, p.Npi)
        AND d.doctor_rn = 1
      WHERE p.Status = 'Active'
        AND p.NpiType LIKE 'NPI-1%'
        AND UPPER(LTRIM(RTRIM(t.TaxonomyCode))) IN (${params.join(', ')})
    ) ranked
    WHERE ranked.rn = 1
  `);

  const doctors: MatchedDoctorRow[] = [];
  for (const row of result.recordset as Record<string, unknown>[]) {
    const npi = String(row.Npi || '').replace(/\D/g, '').slice(-10);
    if (npi.length !== 10 || existingNpis.has(npi)) continue;
    existingNpis.add(npi);

    const masterDoctorId = Number(row.MasterDoctorId) || 0;
    if (masterDoctorId > 0 && existingDoctorIds.has(masterDoctorId)) continue;
    if (masterDoctorId > 0) existingDoctorIds.add(masterDoctorId);

    const registryProviderId = Number(row.RegistryProviderId) || 0;
    const isLocal = masterDoctorId > 0;
    const name = isLocal
      ? (String(row.MasterDoctorName || '').trim() || String(row.ProviderName || '').trim() || npi)
      : (String(row.ProviderName || '').trim() || npi);
    const parts = name.split(/\s+/);
    doctors.push({
      doctorId: isLocal ? masterDoctorId : (registryProviderId > 0 ? -registryProviderId : 0),
      doctorNo: row.DoctorNo != null ? Number(row.DoctorNo) : null,
      doctorName: name,
      firstName: isLocal
        ? (row.MasterFirstName != null ? String(row.MasterFirstName).trim() : null)
        : (parts.length > 1 ? parts.slice(0, -1).join(' ') : name),
      lastName: isLocal
        ? (row.MasterLastName != null ? String(row.MasterLastName).trim() : null)
        : (parts.length > 1 ? parts[parts.length - 1] : null),
      npi,
      addressStreet: row.AddressStreet != null ? String(row.AddressStreet).trim() : null,
      addressCity: row.AddressCity != null ? String(row.AddressCity).trim() : null,
      addressState: row.AddressState != null ? String(row.AddressState).trim() : null,
      addressZip: row.AddressZip != null ? String(row.AddressZip).replace(/\D/g, '').slice(0, 5) : null,
      phone: row.Phone != null ? String(row.Phone).trim() : null,
      matchedSpecialityCode: row.TaxonomyCode != null ? String(row.TaxonomyCode).trim() : null,
      matchedSpecialityDescription: row.TaxonomyDescription != null ? String(row.TaxonomyDescription).trim() : null,
      matchedLevel: isLocal ? 'local-npi' : 'npi',
      source: isLocal ? 'local' : 'npi',
      registryProviderId: registryProviderId || null,
      practiceName: null,
      practiceId: null,
      locationId: null,
      locationName: null,
      locationAddressStreet: row.AddressStreet != null ? String(row.AddressStreet).trim() : null,
      locationAddressCity: row.AddressCity != null ? String(row.AddressCity).trim() : null,
      locationAddressZip: row.AddressZip != null ? String(row.AddressZip).replace(/\D/g, '').slice(0, 5) : null,
      locationPhone: row.Phone != null ? String(row.Phone).trim() : null,
    });
  }

  doctors.sort((a, b) => (a.lastName || a.doctorName).localeCompare(b.lastName || b.doctorName));
  return doctors;
}

/**
 * Lightweight doctor COUNT for coverage progress ("X of Y covered this cycle").
 * No geocoding. When applyFrequencyFilter is false it counts the full campaign
 * target set (Y); when true it counts the still-uncovered set (remaining).
 */
export async function countMatchingDoctorsForCampaign(
  campaignId: number,
  applyFrequencyFilter: boolean,
): Promise<{ campaign: Record<string, unknown>; count: number } | null> {
  const loaded = await loadCampaignSpecialtyRules(campaignId);
  if (!loaded) return null;

  const { campaign, rules } = loaded;
  if (!rules.length) return { campaign, count: 0 };

  const pool = await getPool();
  const request = pool.request().input('CampaignId', sql.Int, campaignId);
  const ruleClauses = buildRuleWhereClauses(rules, request);
  if (!ruleClauses.length) return { campaign, count: 0 };

  let frequencyFilter = '';
  if (applyFrequencyFilter) {
    const frequencyDays = campaignFrequencyDays(campaign);
    if (frequencyDays) {
      request.input('FrequencyInDays', sql.Int, frequencyDays);
      frequencyFilter = recentDropFilterSql();
    }
  }

  const result = await request.query(`
    SELECT COUNT(DISTINCT d.ID) AS DoctorCount
    FROM dbo.Master_Doctor d
    INNER JOIN dbo.Master_PrescribSpeciality ps
      ON ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
      AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
    INNER JOIN dbo.Master_PrsSpecialitiesList sl
      ON sl.RecID = ps.SpecialityID
      AND ISNULL(sl.IsActive, 1) = 1
    WHERE ${ACTIVE_DOCTOR_FILTER}
      AND (${ruleClauses.join(' OR ')})
      ${frequencyFilter}
      ${MAPPED_DOCTOR_ONLY}
  `);

  return { campaign, count: Number(result.recordset[0]?.DoctorCount ?? 0) };
}

/** Total target set (Y), covered, and remaining (still eligible) for a campaign. */
export async function getCampaignCoverage(campaignId: number) {
  const total = await countMatchingDoctorsForCampaign(campaignId, false);
  if (!total) return null;
  const remainingResult = await countMatchingDoctorsForCampaign(campaignId, true);
  const remaining = remainingResult ? remainingResult.count : total.count;
  const covered = Math.max(0, total.count - remaining);
  const frequencyInDays = campaignFrequencyDays(total.campaign);
  return {
    campaign: total.campaign,
    total: total.count,
    covered,
    remaining,
    frequencyInDays,
  };
}

export async function previewDoctorsForSpecialtyInputs(
  specialties: Array<{
    specialityRecId?: number | null;
    specialityCode?: string | null;
    description?: string | null;
    matchLevel?: string;
    matchMode?: string;
  }>,
) {
  const catalog = await loadUnifiedSpecialties();
  const rules: CampaignSpecialtyRule[] = specialties.map((specialty, index) => ({
    campaignSpecialtyV2Id: index + 1,
    campaignId: 0,
    specialityRecId: specialty.specialityRecId != null ? Number(specialty.specialityRecId) : null,
    specialityCode: specialty.specialityCode != null ? String(specialty.specialityCode).trim() : null,
    description: specialty.description != null ? String(specialty.description).trim() : null,
    matchLevel: specialty.matchLevel || 'any',
    matchMode: specialty.matchMode || 'secondary_only',
  })).filter((rule) => (rule.specialityRecId != null && rule.specialityRecId > 0) || rule.specialityCode || rule.description);

  const expanded = expandSpecialtyRules(rules, catalog);
  const specialtyLocals = await findLocalDoctorsForPreview(expanded);
  const registryMatches = await findNpiRegistryDoctorsForRules(expanded, specialtyLocals);
  const localDoctors = dedupeDoctorRows(specialtyLocals, { byName: false });
  const npiDoctors = dedupeDoctorRows(
    registryMatches.map((doctor) => ({ ...doctor, source: 'npi' as const, matchedLevel: doctor.matchedLevel === 'local-npi' ? 'npi' : doctor.matchedLevel })),
  );
  const doctors = [...localDoctors, ...npiDoctors];

  return {
    specialties: expanded.map((rule) => ({
      specialityRecId: rule.specialityRecId,
      specialityCode: rule.specialityCode,
      description: rule.description,
      taxonomyCodes: rule.taxonomyCodes || [],
    })),
    counts: {
      local: localDoctors.length,
      npi: npiDoctors.length,
      total: doctors.length,
    },
    localDoctors,
    npiDoctors,
  };
}

async function findLocalDoctorsForPreview(rules: CampaignSpecialtyRule[]): Promise<MatchedDoctorRow[]> {
  const recIds = [...new Set(rules.map((rule) => Number(rule.specialityRecId)).filter((id) => id > 0))];
  const codes = [...new Set(
    rules
      .map((rule) => String(rule.specialityCode || '').trim().toUpperCase())
      .filter((code) => code && !/^[0-9]{3}[A-Z0-9]{7,}$/i.test(code)),
  )];
  if (!recIds.length && !codes.length) return [];

  const pool = await getPool();
  const request = pool.request();
  const recParams = recIds.map((id, index) => {
    const param = `PrevRec${index}`;
    request.input(param, sql.Int, id);
    return `@${param}`;
  });
  const codeParams = codes.map((code, index) => {
    const param = `PrevCode${index}`;
    request.input(param, sql.NVarChar, code);
    return `@${param}`;
  });
  const recFilter = recParams.length ? `sl.RecID IN (${recParams.join(', ')})` : '1 = 0';
  const codeFilter = codeParams.length
    ? `UPPER(LTRIM(RTRIM(sl.SpecialityCode))) IN (${codeParams.join(', ')})`
    : '1 = 0';

  const result = await request.query(`
    SELECT *
    FROM (
      SELECT
        d.ID AS DoctorId,
        TRY_CONVERT(INT, d.Doctor_NO) AS DoctorNo,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS DoctorName,
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS FirstName,
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS LastName,
        NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') AS Npi,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
        LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
        NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS Phone,
        sl.SpecialityCode AS MatchedSpecialityCode,
        sl.Description AS MatchedSpecialityDescription,
        ps.Level AS MatchedLevel,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(
            TRY_CONVERT(BIGINT, d.Doctor_NPINo),
            CAST(d.ID AS BIGINT)
          )
          ORDER BY d.ID
        ) AS rn
      FROM dbo.Master_Doctor d
      INNER JOIN dbo.Master_PrescribSpeciality ps
        ON ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
        AND (
          ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
          OR ps.PresNo = d.ID
        )
      INNER JOIN dbo.Master_PrsSpecialitiesList sl
        ON sl.RecID = ps.SpecialityID
        AND ISNULL(sl.IsActive, 1) = 1
      WHERE ${ACTIVE_DOCTOR_FILTER}
        AND (${recFilter} OR ${codeFilter})
    ) ranked
    WHERE ranked.rn = 1
  `);

  const seenIds = new Set<number>();
  const seenNpis = new Set<string>();
  const doctors: MatchedDoctorRow[] = [];
  for (const row of result.recordset as Record<string, unknown>[]) {
    const doctorId = Number(row.DoctorId);
    const npi = row.Npi != null ? String(row.Npi).replace(/\D/g, '').slice(-10) : '';
    if (!doctorId || seenIds.has(doctorId)) continue;
    if (npi.length === 10 && seenNpis.has(npi)) continue;
    seenIds.add(doctorId);
    if (npi.length === 10) seenNpis.add(npi);
    doctors.push({
      doctorId,
      doctorNo: row.DoctorNo != null ? Number(row.DoctorNo) : null,
      doctorName: String(row.DoctorName || '').trim(),
      firstName: row.FirstName != null ? String(row.FirstName).trim() : null,
      lastName: row.LastName != null ? String(row.LastName).trim() : null,
      npi: row.Npi != null ? String(row.Npi).trim() : null,
      addressStreet: row.AddressStreet != null ? String(row.AddressStreet).trim() : null,
      addressCity: row.AddressCity != null ? String(row.AddressCity).trim() : null,
      addressState: row.AddressState != null ? String(row.AddressState).trim() : null,
      addressZip: row.AddressZip != null ? String(row.AddressZip).trim() : null,
      phone: row.Phone != null ? String(row.Phone).trim() : null,
      matchedSpecialityCode: row.MatchedSpecialityCode != null ? String(row.MatchedSpecialityCode).trim() : null,
      matchedSpecialityDescription: row.MatchedSpecialityDescription != null ? String(row.MatchedSpecialityDescription).trim() : null,
      matchedLevel: row.MatchedLevel != null ? String(row.MatchedLevel).trim() : null,
      source: 'local',
      registryProviderId: null,
      practiceName: null,
      practiceId: null,
      locationId: null,
      locationName: null,
      locationAddressStreet: row.AddressStreet != null ? String(row.AddressStreet).trim() : null,
      locationAddressCity: row.AddressCity != null ? String(row.AddressCity).trim() : null,
      locationAddressZip: row.AddressZip != null ? String(row.AddressZip).trim() : null,
      locationPhone: row.Phone != null ? String(row.Phone).trim() : null,
    });
  }
  return doctors;
}


