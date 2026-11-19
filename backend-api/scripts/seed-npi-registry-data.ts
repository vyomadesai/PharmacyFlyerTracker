import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, sql } from '../src/config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(here, '../../nppes_florida_st_petersburg_pinellas_park.csv');
const BATCH_SIZE = 150;

type ParsedAddress = {
  streetLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  fax: string;
};

type ParsedTaxonomy = {
  sortOrder: number;
  isPrimary: boolean;
  taxonomyCode: string;
  taxonomyDescription: string;
  taxonomyState: string;
  licenseNumber: string;
};

type ParsedProvider = {
  npi: string;
  providerName: string;
  enumerationDate: Date | null;
  npiType: string;
  status: string;
  authOfficialName: string;
  authOfficialTitle: string;
  authOfficialPhone: string;
  mailing: ParsedAddress;
  primary: ParsedAddress;
  secondaryAddresses: Array<ParsedAddress & { sortOrder: number }>;
  taxonomies: ParsedTaxonomy[];
};

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function emptyToNull(value: string) {
  const trimmed = clean(value);
  return trimmed || null;
}

function clamp(value: string, maxLen: number) {
  const trimmed = clean(value);
  if (!trimmed) return '';
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function clampOrNull(value: string, maxLen: number) {
  const trimmed = clamp(value, maxLen);
  return trimmed || null;
}

function parseCsvRecords(text: string) {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length || row.length) {
    row.push(field);
    records.push(row);
  }

  return records;
}

function parseAddressBlock(text: string): ParsedAddress {
  const lines = clean(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const streetLine1 = lines[0] || '';
  const cityLine = lines[1] || '';
  const country = lines[2] || 'United States';
  const contactLine = lines.find((line) => /^Phone:/i.test(line)) || '';

  let city = '';
  let state = '';
  let postalCode = '';
  if (cityLine) {
    const parts = cityLine.split(',').map((part) => part.trim());
    city = parts[0] || '';
    state = parts[1] || '';
    postalCode = parts[2] || '';
  }

  const phoneMatch = contactLine.match(/Phone:\s*([^|]+)/i);
  const faxMatch = contactLine.match(/Fax:\s*(.+)$/i);

  return {
    streetLine1,
    city,
    state: clamp(state, 10),
    postalCode: clamp(postalCode, 20),
    country,
    phone: clamp(phoneMatch ? phoneMatch[1].trim() : '', 30),
    fax: clamp(faxMatch ? faxMatch[1].trim() : '', 30),
  };
}

function parseAuthOfficial(text: string) {
  const lines = clean(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let authOfficialName = '';
  let authOfficialTitle = '';
  let authOfficialPhone = '';
  for (const line of lines) {
    if (line.startsWith('Name:')) authOfficialName = line.slice(5).trim();
    if (line.startsWith('Title:')) authOfficialTitle = line.slice(6).trim();
    if (line.startsWith('Phone:')) authOfficialPhone = line.slice(6).trim();
  }
  return { authOfficialName, authOfficialTitle, authOfficialPhone };
}

function parseTaxonomies(text: string): ParsedTaxonomy[] {
  const lines = clean(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const primaryMatch = line.match(/^Primary:\s*(Yes|No)/i);
    const isPrimary = primaryMatch ? primaryMatch[1].toLowerCase() === 'yes' : false;
    const rest = line.replace(/^Primary:\s*(Yes|No)\s*\|\s*/i, '');
    const parts = rest.split('|').map((part) => part.trim());
    const codeName = parts[0] || '';
    const dashIndex = codeName.indexOf(' - ');
    const taxonomyCode = dashIndex >= 0 ? codeName.slice(0, dashIndex).trim() : codeName;
    const taxonomyDescription = dashIndex >= 0 ? codeName.slice(dashIndex + 3).trim() : '';
    const statePart = parts.find((part) => part.startsWith('State:')) || '';
    const licensePart = parts.find((part) => part.startsWith('License:')) || '';
    const taxonomyState = statePart.replace(/^State:\s*/i, '').replace(/^—$/, '').trim();
    const licenseNumber = licensePart.replace(/^License:\s*/i, '').replace(/^—$/, '').trim();

    return {
      sortOrder: index + 1,
      isPrimary,
      taxonomyCode,
      taxonomyDescription,
      taxonomyState,
      licenseNumber,
    };
  });
}

function parseSecondaryAddresses(text: string) {
  const raw = clean(text);
  if (!raw) return [] as Array<ParsedAddress & { sortOrder: number }>;
  return raw.split(/\n\s*\n+/).map((block, index) => ({
    sortOrder: index + 1,
    ...parseAddressBlock(block.replace(/^\(\d+\)\s*/, '')),
  }));
}

function parseEnumerationDate(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function mapCsvRow(row: string[]): ParsedProvider {
  const [
    npi,
    providerName,
    enumerationDate,
    npiType,
    status,
    authOfficial,
    mailingAddress,
    primaryAddress,
    secondaryAddresses,
    taxonomies,
  ] = row;

  const auth = parseAuthOfficial(authOfficial);
  return {
    npi: clean(npi),
    providerName: clean(providerName),
    enumerationDate: parseEnumerationDate(enumerationDate),
    npiType: clean(npiType),
    status: clean(status),
    ...auth,
    mailing: parseAddressBlock(mailingAddress),
    primary: parseAddressBlock(primaryAddress),
    secondaryAddresses: parseSecondaryAddresses(secondaryAddresses),
    taxonomies: parseTaxonomies(taxonomies),
  };
}

function loadProvidersFromCsv() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parseCsvRecords(text);
  const [header, ...rows] = records;
  if (!header?.[0] || header[0] !== 'NPI') {
    throw new Error(`Unexpected CSV header in ${CSV_PATH}`);
  }
  return rows
    .map(mapCsvRow)
    .filter((row) => /^\d{10}$/.test(row.npi));
}

async function clearExistingData(pool: Awaited<ReturnType<typeof getPool>>) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy', 'U') IS NOT NULL
      DELETE FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy;
    IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress', 'U') IS NOT NULL
      DELETE FROM dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress;
    IF OBJECT_ID('dbo.PharmacyFlyer_NPI_Registry_Data', 'U') IS NOT NULL
      DELETE FROM dbo.PharmacyFlyer_NPI_Registry_Data;
  `);
}

function bindProviderInputs(request: sql.Request, provider: ParsedProvider) {
  request.input('Npi', sql.VarChar(10), clamp(provider.npi, 10));
  request.input('ProviderName', sql.NVarChar, clamp(provider.providerName, 300));
  request.input('EnumerationDate', sql.Date, provider.enumerationDate);
  request.input('NpiType', sql.VarChar(30), clamp(provider.npiType, 30));
  request.input('Status', sql.NVarChar(20), clamp(provider.status, 20));
  request.input('AuthOfficialName', sql.NVarChar, clampOrNull(provider.authOfficialName, 200));
  request.input('AuthOfficialTitle', sql.NVarChar, clampOrNull(provider.authOfficialTitle, 100));
  request.input('AuthOfficialPhone', sql.VarChar(30), clampOrNull(provider.authOfficialPhone, 30));
  request.input('MailingStreetLine1', sql.NVarChar, clampOrNull(provider.mailing.streetLine1, 200));
  request.input('MailingCity', sql.NVarChar, clampOrNull(provider.mailing.city, 100));
  request.input('MailingState', sql.VarChar(10), clampOrNull(provider.mailing.state, 10));
  request.input('MailingPostalCode', sql.VarChar(20), clampOrNull(provider.mailing.postalCode, 20));
  request.input('MailingCountry', sql.NVarChar, clampOrNull(provider.mailing.country, 50));
  request.input('MailingPhone', sql.VarChar(30), clampOrNull(provider.mailing.phone, 30));
  request.input('MailingFax', sql.VarChar(30), clampOrNull(provider.mailing.fax, 30));
  request.input('PrimaryStreetLine1', sql.NVarChar, clampOrNull(provider.primary.streetLine1, 200));
  request.input('PrimaryCity', sql.NVarChar, clampOrNull(provider.primary.city, 100));
  request.input('PrimaryState', sql.VarChar(10), clampOrNull(provider.primary.state, 10));
  request.input('PrimaryPostalCode', sql.VarChar(20), clampOrNull(provider.primary.postalCode, 20));
  request.input('PrimaryCountry', sql.NVarChar, clampOrNull(provider.primary.country, 50));
  request.input('PrimaryPhone', sql.VarChar(30), clampOrNull(provider.primary.phone, 30));
  request.input('PrimaryFax', sql.VarChar(30), clampOrNull(provider.primary.fax, 30));
}

async function insertProvider(
  transaction: sql.Transaction,
  provider: ParsedProvider,
) {
  const request = new sql.Request(transaction);
  bindProviderInputs(request, provider);
  const result = await request.query(`
    INSERT INTO dbo.PharmacyFlyer_NPI_Registry_Data (
      Npi, ProviderName, EnumerationDate, NpiType, Status,
      AuthOfficialName, AuthOfficialTitle, AuthOfficialPhone,
      MailingStreetLine1, MailingCity, MailingState, MailingPostalCode, MailingCountry, MailingPhone, MailingFax,
      PrimaryStreetLine1, PrimaryCity, PrimaryState, PrimaryPostalCode, PrimaryCountry, PrimaryPhone, PrimaryFax
    )
    OUTPUT INSERTED.RegistryProviderId
    VALUES (
      @Npi, @ProviderName, @EnumerationDate, @NpiType, @Status,
      @AuthOfficialName, @AuthOfficialTitle, @AuthOfficialPhone,
      @MailingStreetLine1, @MailingCity, @MailingState, @MailingPostalCode, @MailingCountry, @MailingPhone, @MailingFax,
      @PrimaryStreetLine1, @PrimaryCity, @PrimaryState, @PrimaryPostalCode, @PrimaryCountry, @PrimaryPhone, @PrimaryFax
    );
  `);
  const registryProviderId = Number(result.recordset[0]?.RegistryProviderId);
  if (!registryProviderId) throw new Error(`Failed to insert provider ${provider.npi}`);

  for (const address of provider.secondaryAddresses) {
    const addressRequest = new sql.Request(transaction);
    addressRequest.input('RegistryProviderId', sql.BigInt, registryProviderId);
    addressRequest.input('SortOrder', sql.Int, address.sortOrder);
    addressRequest.input('StreetLine1', sql.NVarChar, clampOrNull(address.streetLine1, 200));
    addressRequest.input('City', sql.NVarChar, clampOrNull(address.city, 100));
    addressRequest.input('State', sql.VarChar(10), clampOrNull(address.state, 10));
    addressRequest.input('PostalCode', sql.VarChar(20), clampOrNull(address.postalCode, 20));
    addressRequest.input('Country', sql.NVarChar, clampOrNull(address.country, 50));
    addressRequest.input('Phone', sql.VarChar(30), clampOrNull(address.phone, 30));
    addressRequest.input('Fax', sql.VarChar(30), clampOrNull(address.fax, 30));
    await addressRequest.query(`
      INSERT INTO dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress (
        RegistryProviderId, SortOrder, StreetLine1, City, State, PostalCode, Country, Phone, Fax
      )
      VALUES (
        @RegistryProviderId, @SortOrder, @StreetLine1, @City, @State, @PostalCode, @Country, @Phone, @Fax
      );
    `);
  }

  for (const taxonomy of provider.taxonomies) {
    const taxonomyRequest = new sql.Request(transaction);
    taxonomyRequest.input('RegistryProviderId', sql.BigInt, registryProviderId);
    taxonomyRequest.input('SortOrder', sql.Int, taxonomy.sortOrder);
    taxonomyRequest.input('IsPrimary', sql.Bit, taxonomy.isPrimary ? 1 : 0);
    taxonomyRequest.input('TaxonomyCode', sql.VarChar(20), clampOrNull(taxonomy.taxonomyCode, 20));
    taxonomyRequest.input('TaxonomyDescription', sql.NVarChar, clampOrNull(taxonomy.taxonomyDescription, 300));
    taxonomyRequest.input('TaxonomyState', sql.VarChar(10), clampOrNull(taxonomy.taxonomyState, 10));
    taxonomyRequest.input('LicenseNumber', sql.VarChar(50), clampOrNull(taxonomy.licenseNumber, 50));
    await taxonomyRequest.query(`
      INSERT INTO dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy (
        RegistryProviderId, SortOrder, IsPrimary, TaxonomyCode, TaxonomyDescription, TaxonomyState, LicenseNumber
      )
      VALUES (
        @RegistryProviderId, @SortOrder, @IsPrimary, @TaxonomyCode, @TaxonomyDescription, @TaxonomyState, @LicenseNumber
      );
    `);
  }
}

async function main() {
  const providers = loadProvidersFromCsv();
  console.log(`Loaded ${providers.length} providers from CSV`);

  const pool = await getPool();
  await clearExistingData(pool);
  console.log('Cleared existing NPI registry data');

  let inserted = 0;
  for (let start = 0; start < providers.length; start += BATCH_SIZE) {
    const batch = providers.slice(start, start + BATCH_SIZE);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const provider of batch) {
        try {
          await insertProvider(transaction, provider);
          inserted += 1;
        } catch (error) {
          console.error(`Failed on NPI ${provider.npi}`, {
            mailingState: provider.mailing.state,
            primaryState: provider.primary.state,
          });
          throw error;
        }
      }
      await transaction.commit();
      console.log(`Inserted ${inserted}/${providers.length}`);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // transaction may already be aborted
      }
      const lastNpi = batch[batch.length - 1]?.npi;
      console.error(`Batch failed after NPI ~${lastNpi}`, error);
      throw error;
    }
  }

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data) AS Providers,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data_SecondaryAddress) AS SecondaryAddresses,
      (SELECT COUNT(*) FROM dbo.PharmacyFlyer_NPI_Registry_Data_Taxonomy) AS Taxonomies;
  `);
  console.log('Final counts:', counts.recordset[0]);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
