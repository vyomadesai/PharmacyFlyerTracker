import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createReadStream, createWriteStream } from 'fs';

const ROOT = 'c:/MDP/pharmacyFlyerTracker/pharmacy-flyer-tracker-v2';
const WORK = path.join(ROOT, 'nppes-fl-export');
const EXTRACTED = path.join(WORK, 'extracted');
const OUTPUT = path.join(ROOT, 'nppes_florida_st_petersburg_pinellas_park.csv');
const NUCC_CACHE = path.join(WORK, 'nucc_taxonomy_251.csv');

const PRIORITY_CITIES = new Set([
  'PINELLAS PARK',
  'ST PETERSBURG',
  'SAINT PETERSBURG',
  'ST PETE',
  'SAINT PETE',
]);

const HEADERS = [
  'NPI',
  'Name',
  'Enumeration Date',
  'NPI Type',
  'Status',
  'Authorized Official Information',
  'Mailing Address',
  'Primary Practice Address',
  'Secondary Practice Address(es)',
  'Taxonomies',
];

function normalizeCity(value) {
  return String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function isPriorityCity(value) {
  return PRIORITY_CITIES.has(normalizeCity(value));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLine(line) {
  const out = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { out.push(field); field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  out.push(field);
  return out;
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = []; i += 1; continue;
    }
    field += ch; i += 1;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function nppesDesc(classification, specialization) {
  const c = String(classification || '').trim();
  const s = String(specialization || '').trim();
  if (!c) return '';
  return s ? `${c}, ${s}` : c;
}

async function loadTaxonomyMap() {
  const rows = parseCsvText(await fs.promises.readFile(NUCC_CACHE, 'utf8'));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const map = new Map();
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const code = String(row[idx.Code] || '').trim();
    if (code) map.set(code, nppesDesc(row[idx.Classification], row[idx.Specialization]));
  }
  return map;
}

function formatAddressBlock(street, city, state, postal, country = 'United States') {
  const streetLine = String(street || '').trim();
  const cityLine = [city, state, postal].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  return [streetLine, cityLine, country].filter(Boolean).join('\n');
}

function formatAddressWithContact(street1, street2, city, state, postal, phone, fax) {
  const street = [street1, street2].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  const address = formatAddressBlock(street, city, state, postal);
  const bits = [];
  if (phone) bits.push(`Phone: ${phone}`);
  if (fax) bits.push(`Fax: ${fax}`);
  if (!bits.length) return address;
  return `${address}\n${bits.join(' | ')}`;
}

function npiType(entityTypeCode) {
  return String(entityTypeCode) === '2' ? 'NPI-2 Organization' : 'NPI-1 Individual';
}

function statusLabel(deactivationDate) {
  return deactivationDate ? 'Deactivated' : 'Active';
}

function providerName(row, idx) {
  const entity = String(row[idx['Entity Type Code']] || '');
  if (entity === '2') {
    return String(row[idx['Provider Organization Name (Legal Business Name)']] || '').trim();
  }
  const parts = [
    row[idx['Provider Name Prefix Text']],
    row[idx['Provider First Name']],
    row[idx['Provider Middle Name']],
    row[idx['Provider Last Name (Legal Name)']],
    row[idx['Provider Name Suffix Text']],
    row[idx['Provider Credential Text']],
  ].map((v) => String(v || '').trim()).filter(Boolean);
  return parts.join(' ');
}

function authorizedOfficialInfo(row, idx) {
  const nameParts = [
    row[idx['Authorized Official Name Prefix Text']],
    row[idx['Authorized Official First Name']],
    row[idx['Authorized Official Middle Name']],
    row[idx['Authorized Official Last Name']],
    row[idx['Authorized Official Name Suffix Text']],
  ].map((v) => String(v || '').trim()).filter((v) => v && v !== '--');
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  const title = String(row[idx['Authorized Official Title or Position']] || '').trim();
  const phone = String(row[idx['Authorized Official Telephone Number']] || '').trim();
  const lines = [];
  if (name) lines.push(`Name: ${name}`);
  if (title) lines.push(`Title: ${title}`);
  if (phone) lines.push(`Phone: ${phone}`);
  return lines.join('\n');
}

function formatTaxonomies(row, idx, taxonomyMap) {
  const entries = [];
  for (let n = 1; n <= 15; n += 1) {
    const code = String(row[idx[`Healthcare Provider Taxonomy Code_${n}`]] || '').trim();
    if (!code) continue;
    const desc = taxonomyMap.get(code) || '';
    const selected = desc ? `${code} - ${desc}` : code;
    const state = String(row[idx[`Provider License Number State Code_${n}`]] || '').trim();
    const license = String(row[idx[`Provider License Number_${n}`]] || '').trim();
    const primary = String(row[idx[`Healthcare Provider Primary Taxonomy Switch_${n}`]] || '').trim().toUpperCase();
    const primaryLabel = primary === 'Y' ? 'Yes' : primary === 'N' ? 'No' : primary || '';
    entries.push(`Primary: ${primaryLabel} | ${selected} | State: ${state || '—'} | License: ${license || '—'}`);
  }
  return entries.join('\n');
}

function flattenRow(row, idx, taxonomyMap, secondaryByNpi) {
  const npi = String(row[idx.NPI] || '').trim();
  const secondary = (secondaryByNpi.get(npi) || [])
    .map((item, index) => `(${index + 1}) ${item}`)
    .join('\n\n');

  return [
    npi,
    providerName(row, idx),
    row[idx['Provider Enumeration Date']] || '',
    npiType(row[idx['Entity Type Code']]),
    statusLabel(row[idx['NPI Deactivation Date']]),
    authorizedOfficialInfo(row, idx),
    formatAddressWithContact(
      row[idx['Provider First Line Business Mailing Address']],
      row[idx['Provider Second Line Business Mailing Address']],
      row[idx['Provider Business Mailing Address City Name']],
      row[idx['Provider Business Mailing Address State Name']],
      row[idx['Provider Business Mailing Address Postal Code']],
      row[idx['Provider Business Mailing Address Telephone Number']],
      row[idx['Provider Business Mailing Address Fax Number']],
    ),
    formatAddressWithContact(
      row[idx['Provider First Line Business Practice Location Address']],
      row[idx['Provider Second Line Business Practice Location Address']],
      row[idx['Provider Business Practice Location Address City Name']],
      row[idx['Provider Business Practice Location Address State Name']],
      row[idx['Provider Business Practice Location Address Postal Code']],
      row[idx['Provider Business Practice Location Address Telephone Number']],
      row[idx['Provider Business Practice Location Address Fax Number']],
    ),
    secondary,
    formatTaxonomies(row, idx, taxonomyMap),
  ];
}

async function readHeader(filePath) {
  const rl = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const header = parseCsvLine(line);
    const idx = Object.fromEntries(header.map((name, i) => [name, i]));
    rl.close();
    return idx;
  }
  throw new Error(`No header in ${filePath}`);
}

async function loadSecondaryLocations(filePath, cityFilter) {
  const byNpi = new Map();
  if (!filePath || !fs.existsSync(filePath)) return byNpi;
  const idx = await readHeader(filePath);
  const rl = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const row = parseCsvLine(line);
    const npi = String(row[idx.NPI] || '').trim();
    const city = row[idx['Provider Secondary Practice Location Address- City Name']];
    if (!npi || !cityFilter(city)) continue;
    const formatted = formatAddressWithContact(
      row[idx['Provider Secondary Practice Location Address- Address Line 1']],
      row[idx['Provider Secondary Practice Location Address- Address Line 2']],
      city,
      row[idx['Provider Secondary Practice Location Address- State Name']],
      row[idx['Provider Secondary Practice Location Address- Postal Code']],
      row[idx['Provider Secondary Practice Location Address- Telephone Number']],
      row[idx['Provider Secondary Practice Location Address- Fax Number']],
    );
    if (!byNpi.has(npi)) byNpi.set(npi, []);
    const list = byNpi.get(npi);
    if (!list.includes(formatted)) list.push(formatted);
  }
  return byNpi;
}

async function findExtractedFiles(dir) {
  const names = await fs.promises.readdir(dir, { recursive: true });
  const files = names.map((n) => path.join(dir, String(n)));
  return {
    main: files.find((f) => /npidata_pfile.*\.csv$/i.test(f) && !/fileheader/i.test(f)),
    secondary: files.find((f) => /pl_pfile.*\.csv$/i.test(f) && !/fileheader/i.test(f)),
  };
}

function matchesPriorityArea(row, idx, secondaryByNpi) {
  const npi = String(row[idx.NPI] || '').trim();
  const practiceCity = row[idx['Provider Business Practice Location Address City Name']];
  const mailingCity = row[idx['Provider Business Mailing Address City Name']];
  const state = String(row[idx['Provider Business Practice Location Address State Name']] || '').trim().toUpperCase();
  const mailingState = String(row[idx['Provider Business Mailing Address State Name']] || '').trim().toUpperCase();
  if (state !== 'FL' && mailingState !== 'FL') return false;
  if (isPriorityCity(practiceCity) || isPriorityCity(mailingCity)) return true;
  return secondaryByNpi.has(npi);
}

async function main() {
  const taxonomyMap = await loadTaxonomyMap();
  const files = await findExtractedFiles(EXTRACTED);
  if (!files.main) throw new Error('Extracted NPPES main file not found');

  console.log('Loading secondary locations for St Petersburg / Pinellas Park...');
  const secondaryByNpi = await loadSecondaryLocations(files.secondary, isPriorityCity);
  const idx = await readHeader(files.main);

  const out = createWriteStream(OUTPUT, { encoding: 'utf8' });
  out.write(`${HEADERS.map(csvEscape).join(',')}\n`);

  const rl = readline.createInterface({ input: createReadStream(files.main, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  let written = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const row = parseCsvLine(line);
    if (!matchesPriorityArea(row, idx, secondaryByNpi)) continue;
    const flat = flattenRow(row, idx, taxonomyMap, secondaryByNpi);
    out.write(`${flat.map(csvEscape).join(',')}\n`);
    written += 1;
    if (written % 5000 === 0) console.log(`Written ${written}...`);
  }
  out.end();
  console.log(`Wrote ${written} providers to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
