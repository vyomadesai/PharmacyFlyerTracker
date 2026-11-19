import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireAdminOrManager, requireAnyAuthenticatedRole } from '../../middleware/role.middleware.js';
import { getNppesCitySearchVariants, normalizeCityForNppes } from '../../services/nppesLookup.js';
import { providerMatchesSearchStreet } from '../../utils/streetAddressMatch.js';

export const npiRegisteryConfigRoutes = Router();
npiRegisteryConfigRoutes.use(requireAuth);

const NPPES_API_BASE = 'https://npiregistry.cms.hhs.gov/api/';
const ACTIVE_DOCTOR_FILTER = `LTRIM(RTRIM(ISNULL(Doctor_IsActive, ' '))) <> 'N'`;

type AnyRecord = Record<string, any>;

type FlattenedDoctor = {
  source: 'MASTER_DOCTOR' | 'NPI_REGISTRY';
  masterDoctorId: number | null;
  npi: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  credential: string | null;
  sex: string | null;
  status: string | null;
  enumerationDate: string | null;
  nppesLastUpdated: string | null;
  licenseNumber: string | null;
  taxonomyCode: string | null;
  taxonomyDesc: string | null;
  taxonomyState: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  fax: string | null;
  practiceName: string | null;
  isPracticeMapped: boolean | null;
  isLocalMapped: boolean | null;
  raw: AnyRecord;
};

function cleanNpi(value: unknown) {
  if (value === null || value === undefined) return null;
  const npi = String(value).trim().replace(/\D/g, '');
  return npi.length === 10 ? npi : null;
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function readBooleanFlag(value: unknown) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return Boolean(value);
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePhone(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '');
}

function normalizeLicense(value: unknown) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = cleaned.match(/^([A-Z]+)0*(\d+)$/);
  if (match) return `${match[1]}${match[2]}`;
  return cleaned;
}

function toSqlDate(value: unknown) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function doctorToMobileShape(doctor: FlattenedDoctor, resultSource: 'LOCAL' | 'NPI_REGISTRY', npiMatchesLocal = false) {
  const raw = doctor.raw || {};
  const registryOrgName = resultSource === 'NPI_REGISTRY' ? cleanString(raw.basic?.organization_name) : null;
  const displayFirstName = doctor.firstName || registryOrgName || '';
  const displayLastName = doctor.lastName || '';
  return {
    ID: resultSource === 'LOCAL' ? Number(doctor.masterDoctorId || raw.ID || 0) : 0,
    Doctor_NO: raw.Doctor_NO || null,
    Doctor_FirstName: displayFirstName,
    Doctor_LastName: displayLastName,
    Doctor_LIC: doctor.licenseNumber || '',
    Doctor_Type: doctor.taxonomyDesc || raw.Doctor_Type || '',
    Doctor_AddressStreet: doctor.address1 || '',
    Doctor_AddressCity: doctor.city || '',
    Doctor_AddressState: doctor.state || '',
    Doctor_AddressZip: doctor.postalCode || '',
    Doctor_Phone: doctor.phone || '',
    Doctor_MobileNo: raw.Doctor_MobileNo || '',
    Doctor_Email: raw.Doctor_Email || '',
    Doctor_NPINo: doctor.npi || '',
    Practice_Name: resultSource === 'LOCAL' ? (raw.Practice_Name || '') : 'NPI Registry',
    PriSpec: doctor.taxonomyDesc || raw.Doctor_Type || '',
    DropoffLatitude: resultSource === 'LOCAL' ? (raw.DropoffLatitude || null) : null,
    DropoffLongitude: resultSource === 'LOCAL' ? (raw.DropoffLongitude || null) : null,
    DropoffCoordinateSource: resultSource === 'LOCAL' ? (raw.DropoffCoordinateSource || null) : null,
    ResultSource: resultSource,
    NpiRegistryOnly: resultSource === 'NPI_REGISTRY' && !npiMatchesLocal,
    NpiMatchesLocal: resultSource === 'NPI_REGISTRY' && npiMatchesLocal
  };
}

async function ensureConfigTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.npiRegisteryConfig', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.npiRegisteryConfig
      (
        ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_npiRegisteryConfig PRIMARY KEY,
        NPI VARCHAR(10) NOT NULL,
        MasterDoctorID INT NULL,
        SelectedSource VARCHAR(30) NOT NULL,
        FirstName NVARCHAR(100) NULL,
        MiddleName NVARCHAR(100) NULL,
        LastName NVARCHAR(100) NULL,
        Credential NVARCHAR(50) NULL,
        Sex VARCHAR(10) NULL,
        LicenseNumber VARCHAR(50) NULL,
        TaxonomyCode VARCHAR(20) NULL,
        TaxonomyDesc NVARCHAR(255) NULL,
        Address1 NVARCHAR(200) NULL,
        Address2 NVARCHAR(200) NULL,
        City NVARCHAR(100) NULL,
        State VARCHAR(10) NULL,
        PostalCode VARCHAR(20) NULL,
        Phone VARCHAR(30) NULL,
        Fax VARCHAR(30) NULL,
        NppesLastUpdated DATE NULL,
        RegistryFetchedAt DATETIME2 NULL,
        MasterDoctorJson NVARCHAR(MAX) NULL,
        NpiRegistryJson NVARCHAR(MAX) NULL,
        SelectedJson NVARCHAR(MAX) NULL,
        ComparisonJson NVARCHAR(MAX) NULL,
        CreatedBy NVARCHAR(100) NULL,
        UpdatedBy NVARCHAR(100) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_npiRegisteryConfig_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_npiRegisteryConfig_UpdatedAt DEFAULT SYSUTCDATETIME()
      );
      CREATE UNIQUE INDEX UX_npiRegisteryConfig_NPI ON dbo.npiRegisteryConfig(NPI);
    END;
  `);
}

async function fetchNppes(params: Record<string, string | number | undefined | null>) {
  const url = new URL(NPPES_API_BASE);
  url.searchParams.set('version', '2.1');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') url.searchParams.set(key, String(value).trim());
  });
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`NPPES HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ result_count?: number; results?: AnyRecord[] }>;
}

function flattenNppesRecord(record: AnyRecord | null | undefined): FlattenedDoctor | null {
  if (!record) return null;
  const basic = record.basic || {};
  const isOrganization = String(record.enumeration_type || '').toUpperCase() === 'NPI-2';
  const organizationName = cleanString(basic.organization_name);
  const addresses: AnyRecord[] = record.addresses || [];
  const taxonomies: AnyRecord[] = record.taxonomies || [];
  const address = addresses.find((a) => a.address_purpose === 'LOCATION') || addresses.find((a) => a.address_purpose === 'MAILING') || {};
  const taxonomy = taxonomies.find((t) => t.primary === true) || taxonomies[0] || {};
  return {
    source: 'NPI_REGISTRY', masterDoctorId: null, npi: cleanNpi(record.number),
    firstName: isOrganization ? null : cleanString(basic.first_name),
    middleName: isOrganization ? null : cleanString(basic.middle_name),
    lastName: isOrganization ? organizationName : cleanString(basic.last_name),
    credential: cleanString(basic.credential), sex: cleanString(basic.sex), status: cleanString(basic.status),
    enumerationDate: cleanString(basic.enumeration_date), nppesLastUpdated: cleanString(basic.last_updated),
    licenseNumber: normalizeLicense(taxonomy.license) || null, taxonomyCode: cleanString(taxonomy.code), taxonomyDesc: cleanString(taxonomy.desc), taxonomyState: cleanString(taxonomy.state),
    address1: cleanString(address.address_1), address2: cleanString(address.address_2), city: cleanString(address.city), state: cleanString(address.state), postalCode: cleanString(address.postal_code),
    phone: normalizePhone(address.telephone_number) || null, fax: normalizePhone(address.fax_number) || null, practiceName: null,
    isPracticeMapped: null, isLocalMapped: false, raw: record
  };
}

function flattenMasterDoctor(row: AnyRecord | null | undefined): FlattenedDoctor | null {
  if (!row) return null;
  return {
    source: 'MASTER_DOCTOR', masterDoctorId: Number(row.ID || 0), npi: cleanNpi(row.Doctor_NPINo),
    firstName: cleanString(row.Doctor_FirstName), middleName: null, lastName: cleanString(row.Doctor_LastName), credential: null, sex: null, status: cleanString(row.Doctor_IsActive), enumerationDate: null, nppesLastUpdated: null,
    licenseNumber: normalizeLicense(row.Doctor_LIC) || null, taxonomyCode: null, taxonomyDesc: cleanString(row.Doctor_Type), taxonomyState: null,
    address1: cleanString(row.Doctor_AddressStreet), address2: null, city: cleanString(row.Doctor_AddressCity), state: cleanString(row.Doctor_AddressState), postalCode: cleanString(row.Doctor_AddressZip),
    phone: normalizePhone(row.Doctor_Phone) || normalizePhone(row.Doctor_MobileNo) || null, fax: null,
    practiceName: cleanString(row.Practice_Name),
    isPracticeMapped: readBooleanFlag(row.IsPracticeMapped),
    isLocalMapped: null,
    raw: row
  };
}

function buildComparison(master: FlattenedDoctor | null, registry: FlattenedDoctor | null) {
  const rows: Array<{ key: keyof FlattenedDoctor; label: string; normalizer: (value: unknown) => string }> = [
    { key: 'firstName', label: 'First Name', normalizer: normalizeText }, { key: 'middleName', label: 'Middle Name', normalizer: normalizeText }, { key: 'lastName', label: 'Last Name', normalizer: normalizeText },
    { key: 'credential', label: 'Credential', normalizer: normalizeText }, { key: 'sex', label: 'Sex', normalizer: normalizeText }, { key: 'licenseNumber', label: 'License', normalizer: normalizeLicense }, { key: 'taxonomyCode', label: 'Taxonomy Code', normalizer: normalizeText },
    { key: 'taxonomyDesc', label: 'Taxonomy Description', normalizer: normalizeText }, { key: 'address1', label: 'Address 1', normalizer: normalizeText }, { key: 'address2', label: 'Address 2', normalizer: normalizeText },
    { key: 'city', label: 'City', normalizer: normalizeText }, { key: 'state', label: 'State', normalizer: normalizeText }, { key: 'postalCode', label: 'Zip', normalizer: normalizeText },
    { key: 'phone', label: 'Phone', normalizer: normalizePhone }, { key: 'fax', label: 'Fax', normalizer: normalizePhone }
  ];
  return rows.map((row) => {
    const masterValue = master?.[row.key] ? String(master[row.key]) : '';
    const registryValue = registry?.[row.key] ? String(registry[row.key]) : '';
    return { key: row.key, label: row.label, masterValue, registryValue, match: row.normalizer(masterValue) === row.normalizer(registryValue), defaultChoice: registryValue ? 'NPI_REGISTRY' : 'MASTER_DOCTOR' };
  });
}

const MASTER_SELECT = `
  d.ID, d.Doctor_NO,
  LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))) AS Doctor_FirstName,
  LTRIM(RTRIM(ISNULL(d.Doctor_LastName, ''))) AS Doctor_LastName,
  LTRIM(RTRIM(ISNULL(d.Doctor_LIC, ''))) AS Doctor_LIC,
  LTRIM(RTRIM(ISNULL(d.Doctor_Type, ''))) AS Doctor_Type,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS Doctor_AddressStreet,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS Doctor_AddressCity,
  LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS Doctor_AddressState,
  LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS Doctor_AddressZip,
  LTRIM(RTRIM(ISNULL(d.Doctor_Phone, ''))) AS Doctor_Phone,
  LTRIM(RTRIM(ISNULL(d.Doctor_MobileNo, ''))) AS Doctor_MobileNo,
  LTRIM(RTRIM(ISNULL(d.Doctor_Email, ''))) AS Doctor_Email,
  LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, ''))) AS Doctor_NPINo,
  LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ''))) AS Doctor_IsActive,
  CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK' OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781','33782') THEN CAST(27.8428 AS DECIMAL(10,7)) ELSE NULL END AS DropoffLatitude,
  CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK' OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781','33782') THEN CAST(-82.6995 AS DECIMAL(10,7)) ELSE NULL END AS DropoffLongitude,
  CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) = 'PINELLAS PARK' OR LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN ('33781','33782') THEN 'derived-pinellas-park-city-zip' ELSE NULL END AS DropoffCoordinateSource,
  (SELECT TOP 1 LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))) FROM dbo.Doctor_Location_Mapping dlm INNER JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id WHERE dlm.Doctor_No = d.Doctor_NO AND ISNULL(dlm.Mapping_IsActive, 0) = 1 ORDER BY dlm.Practice_Id DESC) AS Practice_Name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM dbo.Doctor_Location_Mapping dlm
    WHERE dlm.Doctor_No = d.Doctor_NO
      AND ISNULL(dlm.Mapping_IsActive, 0) = 1
  ) THEN 1 ELSE 0 END AS IsPracticeMapped
`;

async function getMasterDoctorByNpi(npi: string) {
  const pool = await getPool();
  const result = await pool.request().input('NPI', sql.VarChar(10), npi).query(`SELECT TOP 1 ${MASTER_SELECT} FROM dbo.Master_Doctor d WITH (NOLOCK) WHERE LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(15)))) = @NPI ORDER BY d.ID;`);
  return result.recordset[0] || null;
}

async function loadMasterDoctorsByNpis(npis: string[]) {
  const unique = [...new Set(npis.map((npi) => cleanNpi(npi)).filter(Boolean) as string[])];
  const byNpi = new Map<string, FlattenedDoctor>();
  if (!unique.length) return byNpi;

  const pool = await getPool();
  const chunkSize = 100;
  for (let start = 0; start < unique.length; start += chunkSize) {
    const chunk = unique.slice(start, start + chunkSize);
    const request = pool.request();
    chunk.forEach((npi, index) => request.input(`Npi${index}`, sql.VarChar(10), npi));
    const inClause = chunk.map((_, index) => `@Npi${index}`).join(', ');
    const result = await request.query(`
      SELECT ${MASTER_SELECT}
      FROM dbo.Master_Doctor d WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(15)))) IN (${inClause})
    `);
    for (const row of result.recordset || []) {
      const flat = flattenMasterDoctor(row);
      if (flat?.npi && !byNpi.has(flat.npi)) byNpi.set(flat.npi, flat);
    }
  }

  return byNpi;
}

async function searchMasterDoctors(term: string, limit: number, offset = 0) {
  const pool = await getPool();
  const like = `%${term}%`;
  const result = await pool.request()
    .input('like', sql.NVarChar(200), like)
    .input('limit', sql.Int, limit)
    .input('offset', sql.Int, offset)
    .query(`
    SELECT ${MASTER_SELECT}
    FROM dbo.Master_Doctor d WITH (NOLOCK)
    WHERE ${ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')}
      AND (d.Doctor_FirstName LIKE @like OR d.Doctor_LastName LIKE @like OR CONCAT(d.Doctor_FirstName, ' ', d.Doctor_LastName) LIKE @like OR CONCAT(d.Doctor_LastName, ' ', d.Doctor_FirstName) LIKE @like OR d.Doctor_AddressCity LIKE @like OR d.Doctor_NPINo LIKE @like)
    ORDER BY d.Doctor_LastName, d.Doctor_FirstName
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `);
  return (result.recordset || []).map(flattenMasterDoctor).filter(Boolean) as FlattenedDoctor[];
}

async function countMasterDoctors(term: string) {
  const pool = await getPool();
  const like = `%${term}%`;
  const result = await pool.request().input('like', sql.NVarChar(200), like).query(`
    SELECT COUNT(1) AS total
    FROM dbo.Master_Doctor d WITH (NOLOCK)
    WHERE ${ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')}
      AND (d.Doctor_FirstName LIKE @like OR d.Doctor_LastName LIKE @like OR CONCAT(d.Doctor_FirstName, ' ', d.Doctor_LastName) LIKE @like OR CONCAT(d.Doctor_LastName, ' ', d.Doctor_FirstName) LIKE @like OR d.Doctor_AddressCity LIKE @like OR d.Doctor_NPINo LIKE @like);
  `);
  return Number(result.recordset[0]?.total || 0);
}

type NpiSearchFilters = {
  npi: string | null;
  npiType: string | null;
  taxonomyDescription: string | null;
  providerFirstName: string | null;
  providerLastName: string | null;
  organizationName: string | null;
  authorizedOfficialFirstName: string | null;
  authorizedOfficialLastName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  addressType: string | null;
  address1: string | null;
  phone: string | null;
};

function applyMasterDoctorFilters(request: { input: (name: string, type: unknown, value: unknown) => unknown }, filters: NpiSearchFilters, where: string[]) {
  if (filters.npi) {
    request.input('npi', sql.VarChar(10), filters.npi);
    where.push("LTRIM(RTRIM(CAST(ISNULL(d.Doctor_NPINo, '') AS VARCHAR(15)))) = @npi");
  }
  if (filters.providerFirstName) {
    request.input('firstName', sql.NVarChar(120), `%${filters.providerFirstName}%`);
    where.push('d.Doctor_FirstName LIKE @firstName');
  }
  if (filters.providerLastName) {
    request.input('lastName', sql.NVarChar(120), `%${filters.providerLastName}%`);
    where.push('d.Doctor_LastName LIKE @lastName');
  }
  if (filters.organizationName) {
    request.input('organizationName', sql.NVarChar(200), `%${filters.organizationName}%`);
    where.push('(d.Doctor_Type LIKE @organizationName OR d.Doctor_AddressStreet LIKE @organizationName)');
  }
  if (filters.taxonomyDescription) {
    request.input('taxonomyDescription', sql.NVarChar(200), `%${filters.taxonomyDescription}%`);
    where.push('d.Doctor_Type LIKE @taxonomyDescription');
  }
  if (filters.city) {
    request.input('city', sql.NVarChar(120), `%${filters.city}%`);
    where.push('d.Doctor_AddressCity LIKE @city');
  }
  if (filters.state) {
    request.input('state', sql.NVarChar(20), filters.state.toUpperCase());
    where.push("UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, '')))) = @state");
  }
  if (filters.postalCode) {
    request.input('postalCode', sql.NVarChar(20), `${filters.postalCode.replace(/\s+/g, '')}%`);
    where.push("REPLACE(LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))), ' ', '') LIKE @postalCode");
  }
  if (filters.address1) {
    request.input('address1', sql.NVarChar(200), `%${filters.address1}%`);
    where.push('d.Doctor_AddressStreet LIKE @address1');
  }
  if (filters.phone) {
    const digits = normalizePhone(filters.phone);
    if (digits) {
      request.input('phone', sql.NVarChar(30), `%${digits}%`);
      where.push(`(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(d.Doctor_Phone, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') LIKE @phone
        OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(d.Doctor_MobileNo, ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') LIKE @phone
      )`);
    }
  }
}

async function searchMasterDoctorsByFilters(filters: NpiSearchFilters, limit: number, offset = 0) {
  const pool = await getPool();
  const request = pool.request();
  request.input('limit', sql.Int, limit);
  request.input('offset', sql.Int, offset);

  const where: string[] = [
    ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')
  ];
  applyMasterDoctorFilters(request, filters, where);

  const result = await request.query(`
    SELECT ${MASTER_SELECT}
    FROM dbo.Master_Doctor d WITH (NOLOCK)
    WHERE ${where.join(' AND ')}
    ORDER BY d.Doctor_LastName, d.Doctor_FirstName
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `);

  return (result.recordset || []).map(flattenMasterDoctor).filter(Boolean) as FlattenedDoctor[];
}

async function countMasterDoctorsByFilters(filters: NpiSearchFilters) {
  const pool = await getPool();
  const request = pool.request();
  const where: string[] = [
    ACTIVE_DOCTOR_FILTER.replace(/Doctor_IsActive/g, 'd.Doctor_IsActive')
  ];
  applyMasterDoctorFilters(request, filters, where);

  const result = await request.query(`
    SELECT COUNT(1) AS total
    FROM dbo.Master_Doctor d WITH (NOLOCK)
    WHERE ${where.join(' AND ')};
  `);

  return Number(result.recordset[0]?.total || 0);
}

function hasStructuredSearch(filters: NpiSearchFilters) {
  return Boolean(
    filters.npi
    || filters.taxonomyDescription
    || filters.providerFirstName
    || filters.providerLastName
    || filters.organizationName
    || filters.authorizedOfficialFirstName
    || filters.authorizedOfficialLastName
    || filters.city
    || filters.state
    || filters.country
    || filters.postalCode
    || filters.address1
    || filters.phone
  );
}

function hasNppesQueryableFilters(filters: NpiSearchFilters) {
  return Boolean(
    filters.npi
    || filters.taxonomyDescription
    || filters.providerFirstName
    || filters.providerLastName
    || filters.organizationName
    || filters.authorizedOfficialFirstName
    || filters.authorizedOfficialLastName
    || filters.city
    || filters.state
    || (filters.country && filters.country.toLowerCase() !== 'any')
    || filters.postalCode
  );
}

function registrySearchHint(filters: NpiSearchFilters) {
  const usesPostFilter = Boolean(filters.address1 || filters.phone);
  if (!usesPostFilter || hasNppesQueryableFilters(filters)) {
    if (usesPostFilter) {
      return 'NPI Registry scans up to 1,200 city/taxonomy matches from CMS, then narrows by Street or Phone (same approach as npiregistry.cms.hhs.gov — phone is not a direct API filter).';
    }
    return null;
  }
  return 'NPI Registry needs City, Postal Code, NPI, or Taxonomy when using Street or Phone. Local Master_Doctor results still include Street and Phone.';
}

function registryRecordMatchesAddressFilter(record: FlattenedDoctor, address1: string | null) {
  if (!address1?.trim()) return true;
  if (providerMatchesSearchStreet(record, address1)) return true;

  const addresses: AnyRecord[] = Array.isArray(record.raw?.addresses) ? record.raw.addresses : [];
  return addresses.some((entry) => providerMatchesSearchStreet(
    { address1: cleanString(entry.address_1), address2: cleanString(entry.address_2) },
    address1,
  ));
}

function registryRecordMatchesPhoneFilter(record: FlattenedDoctor, phone: string | null) {
  if (!phone) return true;
  const digits = normalizePhone(phone);
  if (!digits) return true;
  const needle = digits.length >= 10 ? digits.slice(-10) : digits;
  const matchesDigits = (value: unknown) => {
    const hay = normalizePhone(value);
    if (!hay) return false;
    if (hay.includes(digits)) return true;
    if (needle.length >= 7 && hay.slice(-10) === needle) return true;
    return false;
  };
  if (matchesDigits(record.phone)) return true;
  const addresses: AnyRecord[] = Array.isArray(record.raw?.addresses) ? record.raw.addresses : [];
  return addresses.some((entry) => matchesDigits(entry.telephone_number));
}

function nppesEnumerationType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'individual' || normalized === 'npi-1' || normalized === '1') return 'NPI-1';
  if (normalized === 'organization' || normalized === 'npi-2' || normalized === '2') return 'NPI-2';
  return null;
}

function valueOrNullForAny(value: unknown) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  return cleaned.toUpperCase() === 'ANY' ? null : cleaned;
}

function paginateTotalPages(total: number, limit: number) {
  if (!total || !limit) return 0;
  return Math.ceil(total / limit);
}

function emptySearchPagination(limit: number) {
  const blank = { page: 1, total: 0, totalPages: 0 };
  return { limit, local: blank, registry: blank };
}

function applyRegistryPostFilters(records: FlattenedDoctor[], filters: NpiSearchFilters) {
  if (!filters.address1 && !filters.phone) return records;
  return records.filter((record) => registryRecordMatchesAddressFilter(record, filters.address1) && registryRecordMatchesPhoneFilter(record, filters.phone));
}

function flattenNppesResults(response: { results?: AnyRecord[] }) {
  const byNpi = new Map<string, FlattenedDoctor>();
  for (const record of response.results || []) {
    const flat = flattenNppesRecord(record);
    if (flat?.npi && !byNpi.has(flat.npi)) byNpi.set(flat.npi, flat);
  }
  return Array.from(byNpi.values());
}

function buildNppesSearchParams(filters: NpiSearchFilters, cityOverride?: string | null) {
  const params: Record<string, string | number | undefined | null> = {};
  const enumerationType = nppesEnumerationType(filters.npiType);
  if (enumerationType) params.enumeration_type = enumerationType;
  if (filters.npi) params.number = filters.npi;
  if (filters.taxonomyDescription) params.taxonomy_description = filters.taxonomyDescription;
  if (filters.providerFirstName) params.first_name = `${filters.providerFirstName}*`;
  if (filters.providerLastName) params.last_name = `${filters.providerLastName}*`;
  if (filters.organizationName) params.organization_name = `${filters.organizationName}*`;
  if (filters.authorizedOfficialFirstName) params.authorized_official_first_name = `${filters.authorizedOfficialFirstName}*`;
  if (filters.authorizedOfficialLastName) params.authorized_official_last_name = `${filters.authorizedOfficialLastName}*`;
  if (cityOverride) {
    params.city = cityOverride;
  } else if (filters.city) {
    params.city = normalizeCityForNppes(filters.city);
  }
  if (filters.state) {
    params.state = filters.state;
  } else if (filters.city || filters.postalCode) {
    params.state = 'FL';
  }
  if (filters.country && filters.country.toLowerCase() !== 'any') params.country_code = filters.country;
  if (filters.postalCode) params.postal_code = filters.postalCode;
  if (filters.addressType && filters.addressType.toLowerCase() !== 'any') params.address_purpose = filters.addressType;
  return params;
}

async function searchNppesByNamePaginated(term: string, city: string, state: string, limit: number, offset: number) {
  const cleaned = term.trim();
  if (cleaned.length < 2) return { records: [] as FlattenedDoctor[], total: 0 };

  const fetchLimit = 200;
  const base: Record<string, string | number | undefined> = { enumeration_type: 'NPI-1', limit: fetchLimit };
  if (city) base.city = normalizeCityForNppes(city) || city;
  if (state) base.state = state;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const searches = parts.length >= 2
    ? [fetchNppes({ ...base, first_name: `${parts[0]}*`, last_name: `${parts[1]}*` }), fetchNppes({ ...base, first_name: `${parts[1]}*`, last_name: `${parts[0]}*` })]
    : [fetchNppes({ ...base, first_name: `${cleaned}*` }), fetchNppes({ ...base, last_name: `${cleaned}*` })];

  const settled = await Promise.allSettled(searches);
  const byNpi = new Map<string, FlattenedDoctor>();
  let total = 0;
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue;
    total = Math.max(total, Number(item.value.result_count || 0));
    for (const record of item.value.results || []) {
      const flat = flattenNppesRecord(record);
      if (flat?.npi && !byNpi.has(flat.npi)) byNpi.set(flat.npi, flat);
    }
  }

  const merged = Array.from(byNpi.values());
  return {
    records: merged.slice(offset, offset + limit),
    total: Math.max(total, merged.length)
  };
}

async function searchNppesByName(term: string, city: string, state: string, limit: number) {
  const result = await searchNppesByNamePaginated(term, city, state, limit, 0);
  return result.records;
}

async function searchNppesByFiltersPaginated(filters: NpiSearchFilters, limit: number, offset: number) {
  if (!hasNppesQueryableFilters(filters)) return { records: [] as FlattenedDoctor[], total: 0 };

  const needsPostFilter = Boolean(filters.address1 || filters.phone);
  const params = buildNppesSearchParams(filters);
  params.limit = 200;
  params.skip = Math.min(offset, 1000);

  const response = await fetchNppes(params);
  const filtered = applyRegistryPostFilters(flattenNppesResults(response), filters);
  const rawCount = (response.results || []).length;

  if (needsPostFilter) {
    return {
      records: filtered,
      total: filtered.length,
      rawCount,
    };
  }

  const records = filtered.slice(0, limit);
  const hasMore = rawCount >= 200;
  const total = hasMore ? offset + filtered.length + 1 : offset + filtered.length;

  return { records, total, rawCount };
}

async function searchNppesByFilters(filters: NpiSearchFilters, limit: number) {
  const result = await searchNppesByFiltersPaginated(filters, limit, 0);
  return result.records;
}

async function getNppesByExactNpi(npi: string) {
  try {
    const response = await fetchNppes({ number: npi });
    return flattenNppesRecord(response.results?.[0]);
  } catch (error) {
    console.warn(`NPI Registery exact lookup failed for ${npi}:`, error);
    return null;
  }
}

async function getRegistryRecordsForLocalDoctors(localDoctors: FlattenedDoctor[], limit: number) {
  const uniqueNpis = Array.from(new Set(localDoctors.map((doctor) => doctor.npi).filter(Boolean) as string[])).slice(0, limit);
  const settled = await Promise.allSettled(uniqueNpis.map((npi) => getNppesByExactNpi(npi)));
  const records: FlattenedDoctor[] = [];

  for (const item of settled) {
    if (item.status !== 'fulfilled') continue;
    if (item.value?.npi) records.push(item.value);
  }

  return records;
}

async function getRegistryRecordsForMissingLocalNpis(
  localDoctors: FlattenedDoctor[],
  registryByNpi: Map<string, FlattenedDoctor>,
  limit: number
) {
  const missingNpis = Array.from(new Set(
    localDoctors
      .map((doctor) => doctor.npi)
      .filter((npi): npi is string => Boolean(npi && !registryByNpi.has(npi)))
  )).slice(0, limit);

  if (!missingNpis.length) return [] as FlattenedDoctor[];

  const settled = await Promise.allSettled(missingNpis.map((npi) => getNppesByExactNpi(npi)));
  const records: FlattenedDoctor[] = [];

  for (const item of settled) {
    if (item.status !== 'fulfilled') continue;
    if (item.value?.npi) {
      item.value.isLocalMapped = true;
      records.push(item.value);
    }
  }

  return records;
}

function mergeRegistryRecords(...lists: FlattenedDoctor[][]) {
  const byNpi = new Map<string, FlattenedDoctor>();

  for (const list of lists) {
    for (const doctor of list) {
      if (!doctor?.npi) continue;
      if (!byNpi.has(doctor.npi)) byNpi.set(doctor.npi, doctor);
    }
  }

  return Array.from(byNpi.values());
}

function applyMappingFlags(
  registry: FlattenedDoctor[],
  masterByNpi: Map<string, FlattenedDoctor>,
) {
  for (const doctor of registry) {
    doctor.isLocalMapped = Boolean(doctor.npi && masterByNpi.has(doctor.npi));
  }
}

function sortDoctorsByNameFlat(a: FlattenedDoctor, b: FlattenedDoctor) {
  const nameA = [a.lastName, a.firstName].filter(Boolean).join(' ').toUpperCase();
  const nameB = [b.lastName, b.firstName].filter(Boolean).join(' ').toUpperCase();
  return nameA.localeCompare(nameB);
}

async function categorizeSearchResults(
  allLocal: FlattenedDoctor[],
  allRegistry: FlattenedDoctor[],
) {
  const registryByNpi = new Map<string, FlattenedDoctor>();
  const registryWithoutNpi: FlattenedDoctor[] = [];

  for (const doc of allRegistry) {
    if (doc.npi) {
      if (!registryByNpi.has(doc.npi)) registryByNpi.set(doc.npi, doc);
    } else {
      registryWithoutNpi.push(doc);
    }
  }

  const masterByNpi = await loadMasterDoctorsByNpis([...registryByNpi.keys()]);
  applyMappingFlags(allRegistry, masterByNpi);

  const matched: Array<{ local: FlattenedDoctor; registry: FlattenedDoctor }> = [];
  const registryNew: FlattenedDoctor[] = [...registryWithoutNpi];
  const registryNpis = new Set<string>();

  for (const [npi, registryDoc] of registryByNpi) {
    registryNpis.add(npi);
    const masterDoc = masterByNpi.get(npi);
    if (masterDoc) {
      matched.push({ local: masterDoc, registry: registryDoc });
    } else {
      registryNew.push(registryDoc);
    }
  }

  const localOnly: FlattenedDoctor[] = [];
  for (const doc of allLocal) {
    if (!doc.npi || !registryNpis.has(doc.npi)) localOnly.push(doc);
  }

  const registryAllByNpi = new Map<string, FlattenedDoctor>();
  for (const doc of allRegistry) {
    if (doc.npi) {
      if (!registryAllByNpi.has(doc.npi)) registryAllByNpi.set(doc.npi, doc);
    } else {
      registryAllByNpi.set(`__no_npi_${registryAllByNpi.size}`, doc);
    }
  }
  const registryAll = Array.from(registryAllByNpi.values()).sort(sortDoctorsByNameFlat);
  matched.sort((a, b) => sortDoctorsByNameFlat(a.local, b.local));
  localOnly.sort(sortDoctorsByNameFlat);
  registryNew.sort(sortDoctorsByNameFlat);

  return { matched, registryAll, registryNew, localOnly, masterByNpi };
}

function buildRegistryByNpi(registry: FlattenedDoctor[]) {
  const registryByNpi = new Map<string, FlattenedDoctor>();
  for (const doc of registry) {
    if (doc.npi && !registryByNpi.has(doc.npi)) registryByNpi.set(doc.npi, doc);
  }
  return registryByNpi;
}

function sortDoctorsByName(a: FlattenedDoctor, b: FlattenedDoctor) {
  const nameA = [a.lastName, a.firstName].filter(Boolean).join(' ').toUpperCase();
  const nameB = [b.lastName, b.firstName].filter(Boolean).join(' ').toUpperCase();
  return nameA.localeCompare(nameB);
}

type ResultFilterField = 'all' | 'practiceName' | 'primaryAddress' | 'secondaryAddress' | 'phone' | 'taxonomy';

function parseResultFilterField(value: unknown): ResultFilterField {
  const field = String(value || 'all').trim().toLowerCase();
  if (field === 'practicename' || field === 'practice_name' || field === 'practice-name') return 'practiceName';
  if (field === 'primaryaddress' || field === 'primary_address' || field === 'primary-address') return 'primaryAddress';
  if (field === 'secondaryaddress' || field === 'secondary_address' || field === 'secondary-address') return 'secondaryAddress';
  if (field === 'phone' || field === 'phonenumber' || field === 'phone_number') return 'phone';
  if (field === 'taxonomy') return 'taxonomy';
  return 'all';
}

function formatAddressParts(parts: Array<unknown>) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function doctorAddressLine(doctor: FlattenedDoctor) {
  return [doctor.address1, doctor.address2, doctor.city, doctor.state, doctor.postalCode].filter(Boolean).join(', ');
}

function primaryPracticeAddressText(doctor: FlattenedDoctor) {
  if (doctor.source === 'NPI_REGISTRY' && doctor.raw) {
    const addresses: AnyRecord[] = doctor.raw.addresses || [];
    const primary = addresses.find((entry) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
      || addresses[0];
    if (primary) {
      return formatAddressParts([
        primary.address_1,
        primary.address_2,
        primary.city,
        primary.state,
        primary.postal_code,
        primary.country_code,
      ]);
    }
  }
  return doctorAddressLine(doctor);
}

function secondaryPracticeAddressesText(doctor: FlattenedDoctor) {
  if (doctor.source !== 'NPI_REGISTRY' || !doctor.raw) return '';
  const addresses: AnyRecord[] = doctor.raw.addresses || [];
  const primary = addresses.find((entry) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
    || addresses[0];
  const primaryText = primary
    ? formatAddressParts([
      primary.address_1,
      primary.address_2,
      primary.city,
      primary.state,
      primary.postal_code,
      primary.country_code,
    ])
    : '';
  const seen = new Set<string>();
  if (primaryText) seen.add(primaryText.toUpperCase());

  return addresses
    .map((entry) => formatAddressParts([
      entry.address_1,
      entry.address_2,
      entry.city,
      entry.state,
      entry.postal_code,
      entry.country_code,
    ]))
    .filter(Boolean)
    .filter((text) => {
      const key = text.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' | ');
}

function practiceNameText(doctor: FlattenedDoctor) {
  if (doctor.source === 'MASTER_DOCTOR') {
    const raw = doctor.raw || {};
    return String(doctor.practiceName || raw.Practice_Name || raw.practice_name || raw.PracticeName || '').trim();
  }

  const raw = doctor.raw || {};
  const basic = raw.basic || {};
  const isOrganization = String(raw.enumeration_type || '').toUpperCase() === 'NPI-2';
  if (isOrganization) {
    return String(basic.organization_name || doctor.lastName || '').trim();
  }

  return String(basic.organization_name || '').trim()
    || [doctor.firstName, doctor.middleName, doctor.lastName, doctor.credential].filter(Boolean).join(' ').trim();
}

function doctorPhoneText(doctor: FlattenedDoctor) {
  if (doctor.phone) return doctor.phone;
  if (doctor.source === 'NPI_REGISTRY' && doctor.raw) {
    const addresses: AnyRecord[] = doctor.raw.addresses || [];
    const primary = addresses.find((entry) => String(entry?.address_purpose || '').toUpperCase() === 'LOCATION')
      || addresses[0];
    if (primary?.telephone_number) return String(primary.telephone_number).trim();
  }
  const raw = doctor.raw || {};
  return String(raw.Doctor_Phone || raw.Doctor_MobileNo || '').trim();
}

function taxonomySearchText(doctor: FlattenedDoctor) {
  if (doctor.source === 'NPI_REGISTRY' && doctor.raw) {
    const taxonomies: AnyRecord[] = doctor.raw.taxonomies || [];
    const parts = taxonomies.flatMap((entry) => [
      entry?.code,
      entry?.desc,
      entry?.state,
      entry?.license,
      entry?.primary ? 'primary' : '',
    ]);
    return parts.filter(Boolean).join(' ');
  }
  return [
    doctor.taxonomyCode,
    doctor.taxonomyDesc,
    doctor.taxonomyState,
    doctor.licenseNumber,
  ].filter(Boolean).join(' ');
}

function doctorResultFilterHaystack(doctor: FlattenedDoctor, field: ResultFilterField) {
  switch (field) {
    case 'practiceName':
      return practiceNameText(doctor);
    case 'primaryAddress':
      return primaryPracticeAddressText(doctor);
    case 'secondaryAddress':
      return secondaryPracticeAddressesText(doctor);
    case 'phone':
      return doctorPhoneText(doctor);
    case 'taxonomy':
      return taxonomySearchText(doctor);
    default:
      return [
        practiceNameText(doctor),
        primaryPracticeAddressText(doctor),
        secondaryPracticeAddressesText(doctor),
        doctorPhoneText(doctor),
        taxonomySearchText(doctor),
      ].filter(Boolean).join(' ');
  }
}

function doctorMatchesResultFilter(
  doctor: FlattenedDoctor | null | undefined,
  field: ResultFilterField,
  term: string,
) {
  const needle = String(term || '').trim();
  if (!needle) return true;
  if (!doctor) return false;

  const haystack = doctorResultFilterHaystack(doctor, field).toLowerCase();
  if (haystack.includes(needle.toLowerCase())) return true;

  const digits = normalizePhone(needle);
  if (digits.length >= 3 && (field === 'phone' || field === 'all')) {
    const phoneHaystack = normalizePhone(doctorPhoneText(doctor));
    if (phoneHaystack.includes(digits)) return true;
  }

  return false;
}

function pairMatchesResultFilter(
  pair: { local: FlattenedDoctor; registry: FlattenedDoctor | null },
  field: ResultFilterField,
  term: string,
) {
  return doctorMatchesResultFilter(pair.local, field, term)
    || doctorMatchesResultFilter(pair.registry, field, term);
}

function applyResultFilterToSearchResults<T extends FlattenedDoctor>(
  items: T[],
  field: ResultFilterField,
  term: string,
) {
  if (!String(term || '').trim()) return items;
  return items.filter((item) => doctorMatchesResultFilter(item, field, term));
}

function applyResultFilterToPairs<T extends { local: FlattenedDoctor; registry: FlattenedDoctor | null }>(
  pairs: T[],
  field: ResultFilterField,
  term: string,
) {
  if (!String(term || '').trim()) return pairs;
  return pairs.filter((pair) => pairMatchesResultFilter(pair, field, term));
}

function buildPracticeMappedPairs(
  local: FlattenedDoctor[],
  registryByNpi: Map<string, FlattenedDoctor>
) {
  const pairs = local
    .filter((doc) => doc.isPracticeMapped)
    .map((localDoc) => ({
      local: localDoc,
      registry: localDoc.npi ? registryByNpi.get(localDoc.npi) || null : null
    }));

  pairs.sort((a, b) => sortDoctorsByName(a.local, b.local));
  return pairs;
}

async function enrichPracticeMappedPairs(
  pairs: Array<{ local: FlattenedDoctor; registry: FlattenedDoctor | null }>
) {
  return Promise.all(
    pairs.map(async (pair) => {
      if (pair.registry || !pair.local.npi) return pair;
      const fetched = await getNppesByExactNpi(pair.local.npi);
      if (!fetched) return pair;
      fetched.isLocalMapped = true;
      return { local: pair.local, registry: fetched };
    })
  );
}

const LOCAL_SEARCH_CAP = 2000;
const REGISTRY_SEARCH_MAX = 1200;

async function fetchAllRegistryForFilters(filters: NpiSearchFilters, maxRecords = REGISTRY_SEARCH_MAX) {
  const byNpi = new Map<string, FlattenedDoctor>();
  const needsPostFilter = Boolean(filters.address1 || filters.phone);
  const cityVariants = filters.city ? getNppesCitySearchVariants(filters.city) : [undefined];

  for (const cityVariant of cityVariants) {
    let skip = 0;

    while (skip <= 1000 && byNpi.size < maxRecords) {
      const params = buildNppesSearchParams(filters, cityVariant);
      params.limit = 200;
      params.skip = skip;

      const response = await fetchNppes(params);
      const rawResults = response.results || [];
      if (!rawResults.length) break;

      const filtered = applyRegistryPostFilters(flattenNppesResults(response), filters);
      for (const doc of filtered) {
        if (doc.npi && !byNpi.has(doc.npi)) byNpi.set(doc.npi, doc);
        if (byNpi.size >= maxRecords) break;
      }

      if (needsPostFilter) {
        if (rawResults.length < 200) break;
        skip += 200;
        continue;
      }

      if (rawResults.length < 200) break;
      skip += 200;
    }
  }

  return Array.from(byNpi.values());
}

async function fetchAllRegistryForTerm(term: string, city: string, state: string, maxRecords = REGISTRY_SEARCH_MAX) {
  const byNpi = new Map<string, FlattenedDoctor>();
  let offset = 0;

  while (offset < maxRecords) {
    const batch = await searchNppesByNamePaginated(term, city, state, 200, offset);
    for (const doc of batch.records) {
      if (doc.npi && !byNpi.has(doc.npi)) byNpi.set(doc.npi, doc);
    }
    if (batch.records.length < 200) break;
    offset += 200;
  }

  return Array.from(byNpi.values());
}

function parseResultTab(value: unknown) {
  const tab = String(value || 'matched').toLowerCase();
  if (tab === 'mapped' || tab === 'practice-mapped' || tab === 'practicemapped') return 'mapped';
  if (tab === 'registry-only' || tab === 'registryonly' || tab === 'registry') return 'registry-only';
  if (tab === 'local-only' || tab === 'localonly' || tab === 'local') return 'local-only';
  return 'matched';
}

async function getExistingConfig(npi: string) {
  await ensureConfigTable();
  const pool = await getPool();
  const result = await pool.request().input('NPI', sql.VarChar(10), npi).query(`SELECT TOP 1 * FROM dbo.npiRegisteryConfig WITH (NOLOCK) WHERE NPI = @NPI ORDER BY UpdatedAt DESC;`);
  return result.recordset[0] || null;
}

async function upsertConfig(payload: AnyRecord) {
  await ensureConfigTable();
  const npi = cleanNpi(payload.npi);
  if (!npi) throw new Error('Valid 10-digit NPI is required.');
  const pool = await getPool();
  const selected = payload.selectedValues || {};
  const registry = payload.registry || {};
  const request = pool.request();
  request.input('NPI', sql.VarChar(10), npi);
  request.input('MasterDoctorID', sql.Int, payload.masterDoctorId ? Number(payload.masterDoctorId) : null);
  request.input('SelectedSource', sql.VarChar(30), String(payload.selectedSource || 'MIXED'));
  request.input('FirstName', sql.NVarChar(100), cleanString(selected.firstName));
  request.input('MiddleName', sql.NVarChar(100), cleanString(selected.middleName));
  request.input('LastName', sql.NVarChar(100), cleanString(selected.lastName));
  request.input('Credential', sql.NVarChar(50), cleanString(selected.credential));
  request.input('Sex', sql.VarChar(10), cleanString(selected.sex));
  request.input('LicenseNumber', sql.VarChar(50), normalizeLicense(selected.licenseNumber) || null);
  request.input('TaxonomyCode', sql.VarChar(20), cleanString(selected.taxonomyCode));
  request.input('TaxonomyDesc', sql.NVarChar(255), cleanString(selected.taxonomyDesc));
  request.input('Address1', sql.NVarChar(200), cleanString(selected.address1));
  request.input('Address2', sql.NVarChar(200), cleanString(selected.address2));
  request.input('City', sql.NVarChar(100), cleanString(selected.city));
  request.input('State', sql.VarChar(10), cleanString(selected.state));
  request.input('PostalCode', sql.VarChar(20), cleanString(selected.postalCode));
  request.input('Phone', sql.VarChar(30), normalizePhone(selected.phone) || null);
  request.input('Fax', sql.VarChar(30), normalizePhone(selected.fax) || null);
  request.input('NppesLastUpdated', sql.Date, toSqlDate(registry.nppesLastUpdated));
  request.input('RegistryFetchedAt', sql.DateTime2, new Date());
  request.input('MasterDoctorJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.master || null));
  request.input('NpiRegistryJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.registry || null));
  request.input('SelectedJson', sql.NVarChar(sql.MAX), JSON.stringify(selected));
  request.input('ComparisonJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.comparison || []));
  request.input('CreatedBy', sql.NVarChar(100), cleanString(payload.createdBy) || cleanString(payload.updatedBy));
  request.input('UpdatedBy', sql.NVarChar(100), cleanString(payload.updatedBy) || cleanString(payload.createdBy));
  const result = await request.query(`
    MERGE dbo.npiRegisteryConfig AS target
    USING (SELECT @NPI AS NPI) AS source ON target.NPI = source.NPI
    WHEN MATCHED THEN UPDATE SET MasterDoctorID=@MasterDoctorID, SelectedSource=@SelectedSource, FirstName=@FirstName, MiddleName=@MiddleName, LastName=@LastName, Credential=@Credential, Sex=@Sex, LicenseNumber=@LicenseNumber, TaxonomyCode=@TaxonomyCode, TaxonomyDesc=@TaxonomyDesc, Address1=@Address1, Address2=@Address2, City=@City, State=@State, PostalCode=@PostalCode, Phone=@Phone, Fax=@Fax, NppesLastUpdated=@NppesLastUpdated, RegistryFetchedAt=@RegistryFetchedAt, MasterDoctorJson=@MasterDoctorJson, NpiRegistryJson=@NpiRegistryJson, SelectedJson=@SelectedJson, ComparisonJson=@ComparisonJson, UpdatedBy=@UpdatedBy, UpdatedAt=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (NPI, MasterDoctorID, SelectedSource, FirstName, MiddleName, LastName, Credential, Sex, LicenseNumber, TaxonomyCode, TaxonomyDesc, Address1, Address2, City, State, PostalCode, Phone, Fax, NppesLastUpdated, RegistryFetchedAt, MasterDoctorJson, NpiRegistryJson, SelectedJson, ComparisonJson, CreatedBy, UpdatedBy)
    VALUES (@NPI, @MasterDoctorID, @SelectedSource, @FirstName, @MiddleName, @LastName, @Credential, @Sex, @LicenseNumber, @TaxonomyCode, @TaxonomyDesc, @Address1, @Address2, @City, @State, @PostalCode, @Phone, @Fax, @NppesLastUpdated, @RegistryFetchedAt, @MasterDoctorJson, @NpiRegistryJson, @SelectedJson, @ComparisonJson, @CreatedBy, @UpdatedBy);
    SELECT TOP 1 * FROM dbo.npiRegisteryConfig WHERE NPI = @NPI;
  `);
  return result.recordset[0] || null;
}

npiRegisteryConfigRoutes.get('/doctor/:npi', requireAdminOrManager, async (req, res) => {
  try {
    const npi = cleanNpi(req.params.npi);
    if (!npi) return res.status(400).json({ message: 'Valid 10-digit NPI is required.' });
    const master = flattenMasterDoctor(await getMasterDoctorByNpi(npi));
    const nppes = await fetchNppes({ number: npi });
    const registry = flattenNppesRecord(nppes.results?.[0]);
    if (registry) registry.isLocalMapped = Boolean(master);
    const comparison = buildComparison(master, registry);
    const existingConfig = await getExistingConfig(npi);
    return res.json({ npi, master, registry, comparison, existingConfig, nppesResultCount: nppes.result_count || 0 });
  } catch (error) {
    console.error('NPI Registery doctor lookup error:', error);
    return res.status(500).json({ message: 'NPI Registery doctor lookup failed' });
  }
});

npiRegisteryConfigRoutes.get('/search', requireAdminOrManager, async (req, res) => {
  try {
    const npi = cleanNpi(req.query.npi);
    const npiType = cleanString(req.query.npiType || req.query.enumerationType);
    const taxonomyDescription = cleanString(req.query.taxonomyDescription);
    const providerFirstName = cleanString(req.query.providerFirstName || req.query.firstName);
    const providerLastName = cleanString(req.query.providerLastName || req.query.lastName);
    const organizationName = cleanString(req.query.organizationName);
    const authorizedOfficialFirstName = cleanString(req.query.authorizedOfficialFirstName);
    const authorizedOfficialLastName = cleanString(req.query.authorizedOfficialLastName);
    const city = cleanString(req.query.city);
    const state = valueOrNullForAny(req.query.state)?.toUpperCase() || null;
    const country = valueOrNullForAny(req.query.country || req.query.countryCode);
    const postalCode = cleanString(req.query.postalCode);
    const addressType = valueOrNullForAny(req.query.addressType);
    const address1 = cleanString(req.query.address1 || req.query.streetAddress || req.query.address);
    const phone = cleanString(req.query.phone || req.query.phoneNumber);
    const term = String(req.query.term || req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const resultTab = parseResultTab(req.query.resultTab);
    const page = Math.max(Number(req.query.page || 1), 1);
    const offset = (page - 1) * limit;

    const filters: NpiSearchFilters = {
      npi,
      npiType,
      taxonomyDescription,
      providerFirstName,
      providerLastName,
      organizationName,
      authorizedOfficialFirstName,
      authorizedOfficialLastName,
      city,
      state,
      country,
      postalCode,
      addressType,
      address1,
      phone
    };

    const structuredSearch = hasStructuredSearch(filters);
    if (!structuredSearch && (!term || term.length < 2)) {
      return res.json({
        tab: resultTab,
        matched: [],
        mapped: [],
        items: [],
        counts: { matched: 0, mapped: 0, registryOnly: 0, localOnly: 0 },
        pagination: { page: 1, limit, total: 0, totalPages: 0 }
      });
    }

    const resultFilterField = parseResultFilterField(req.query.resultFilterField);
    const resultFilterText = cleanString(req.query.resultFilterText);

    const includeFullResults = req.query.includeFullResults === 'true'
      || req.query.includeFullResults === '1';

    let allLocal: FlattenedDoctor[];
    let allRegistry: FlattenedDoctor[];

    if (structuredSearch) {
      allLocal = await searchMasterDoctorsByFilters(filters, LOCAL_SEARCH_CAP, 0);
      allRegistry = await fetchAllRegistryForFilters(filters);
    } else {
      allLocal = await searchMasterDoctors(term, LOCAL_SEARCH_CAP, 0);
      allRegistry = await fetchAllRegistryForTerm(term, city || '', state || 'FL');
    }

    const registryFromMissingLocalNpis = await getRegistryRecordsForMissingLocalNpis(
      allLocal,
      buildRegistryByNpi(allRegistry),
      LOCAL_SEARCH_CAP
    );
    allRegistry = mergeRegistryRecords(allRegistry, registryFromMissingLocalNpis);

    const registryByNpi = buildRegistryByNpi(allRegistry);
    const { matched, registryNew, localOnly } = await categorizeSearchResults(allLocal, allRegistry);
    const practiceMapped = buildPracticeMappedPairs(allLocal, registryByNpi);

    const filteredMatched = applyResultFilterToPairs(matched, resultFilterField, resultFilterText || '');
    const filteredMapped = applyResultFilterToPairs(practiceMapped, resultFilterField, resultFilterText || '');
    const filteredRegistryNew = applyResultFilterToSearchResults(registryNew, resultFilterField, resultFilterText || '');
    const filteredLocalOnly = applyResultFilterToSearchResults(localOnly, resultFilterField, resultFilterText || '');

    const counts = {
      matched: filteredMatched.length,
      mapped: filteredMapped.length,
      registryOnly: filteredRegistryNew.length,
      localOnly: filteredLocalOnly.length
    };

    let total = 0;
    let items: FlattenedDoctor[] | Array<{ local: FlattenedDoctor; registry: FlattenedDoctor }> = [];
    let matchedSlice: Array<{ local: FlattenedDoctor; registry: FlattenedDoctor }> = [];
    let mappedSlice: Array<{ local: FlattenedDoctor; registry: FlattenedDoctor | null }> = [];

    if (resultTab === 'matched') {
      total = filteredMatched.length;
      matchedSlice = filteredMatched.slice(offset, offset + limit);
      items = matchedSlice;
    } else if (resultTab === 'mapped') {
      total = filteredMapped.length;
      mappedSlice = await enrichPracticeMappedPairs(filteredMapped.slice(offset, offset + limit));
    } else if (resultTab === 'registry-only') {
      total = filteredRegistryNew.length;
      items = filteredRegistryNew.slice(offset, offset + limit);
    } else {
      total = filteredLocalOnly.length;
      items = filteredLocalOnly.slice(offset, offset + limit);
    }

    return res.json({
      tab: resultTab,
      matched: matchedSlice,
      mapped: mappedSlice,
      items,
      counts,
      registryHint: registrySearchHint(filters),
      pagination: {
        page,
        limit,
        total,
        totalPages: paginateTotalPages(total, limit)
      },
      ...(includeFullResults ? {
        fullResults: {
          matched,
          mapped: practiceMapped,
          registryNew,
          localOnly
        }
      } : {})
    });
  } catch (error) {
    console.error('NPI Registery search error:', error);
    return res.status(500).json({ message: 'NPI Registery search failed' });
  }
});

npiRegisteryConfigRoutes.post('/save', requireAdminOrManager, async (req, res) => {
  try {
    const saved = await upsertConfig(req.body || {});
    return res.json({ saved });
  } catch (error) {
    console.error('NPI Registery save error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'NPI Registery save failed' });
  }
});

npiRegisteryConfigRoutes.get('/combined-doctor-search', requireAnyAuthenticatedRole, async (req, res) => {
  try {
    const term = String(req.query.term || req.query.q || '').trim();
    const city = String(req.query.city || '').trim();
    const state = String(req.query.state || 'FL').trim().toUpperCase();
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    if (!term || term.length < 2) return res.json({ local: [], registryOnly: [], combined: [] });
    const localFlat = await searchMasterDoctors(term, limit);
    const localNpis = new Set(localFlat.map((d) => d.npi).filter(Boolean));
    const registryFromLocalNpis = await getRegistryRecordsForLocalDoctors(localFlat, limit);
    const registryFromName = await searchNppesByName(term, city, state, limit);
    const registryFlat = mergeRegistryRecords(registryFromLocalNpis, registryFromName).slice(0, limit);
    const local = localFlat.map((d) => doctorToMobileShape(d, 'LOCAL'));
    const registry = registryFlat.map((d) => doctorToMobileShape(d, 'NPI_REGISTRY', Boolean(d.npi && localNpis.has(d.npi))));
    const registryOnly = registry.filter((d) => d.NpiRegistryOnly);
    const registryMatchingLocal = registry.filter((d) => d.NpiMatchesLocal);
    return res.json({ local, registry, registryOnly, registryMatchingLocal, combined: [...local, ...registry] });
  } catch (error) {
    console.error('Combined doctor search error:', error);
    return res.status(500).json({ message: 'Combined doctor search failed' });
  }
});
