import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';

const ROOT = 'c:/MDP/pharmacyFlyerTracker/pharmacy-flyer-tracker-v2';
const WORK = path.join(ROOT, 'nppes-fl-export');
const OUTPUT = path.join(ROOT, 'nppes_florida_providers.csv');
const ZIP_URL = 'https://download.cms.gov/nppes/NPPES_Data_Dissemination_July_2026_V2.zip';
const NUCC_URL = 'https://www.nucc.org/images/stories/CSV/nucc_taxonomy_251.csv';

const FL_STATE = 'FL';

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
        if (line[i + 1] === '"') {
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
      out.push(field);
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
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
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function nppesDesc(classification, specialization) {
  const c = String(classification || '').trim();
  const s = String(specialization || '').trim();
  if (!c) return '';
  return s ? `${c}, ${s}` : c;
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function downloadFile(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`Using cached ${dest}`);
    return;
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status} for ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  console.log(`Saved ${dest}`);
}

async function loadTaxonomyMap() {
  const cache = path.join(WORK, 'nucc_taxonomy_251.csv');
  await downloadFile(NUCC_URL, cache);
  const text = await fs.promises.readFile(cache, 'utf8');
  const rows = parseCsvText(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const map = new Map();
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const code = String(row[idx.Code] || '').trim();
    if (!code) continue;
    map.set(code, nppesDesc(row[idx.Classification], row[idx.Specialization]));
  }
  return map;
}

function formatAddress(parts) {
  return parts.filter(Boolean).join('\n');
}

function formatPhoneFax(phone, fax) {
  const bits = [];
  if (phone) bits.push(`Phone: ${phone}`);
  if (fax) bits.push(`Fax:${fax}`);
  return bits.join(' | ');
}

function npiType(entityTypeCode) {
  return String(entityTypeCode) === '2' ? 'NPI-2 Organization' : 'NPI-1 Individual';
}

function statusLabel(code) {
  const value = String(code || '').trim().toUpperCase();
  if (value === 'A') return 'Active';
  if (value === 'D') return 'Deactivated';
  return value || '';
}

function authOfficialName(row, idx) {
  const prefix = row[idx['Authorized Official Name Prefix Text']] || '';
  const first = row[idx['Authorized Official First Name']] || '';
  const middle = row[idx['Authorized Official Middle Name']] || '';
  const last = row[idx['Authorized Official Last Name']] || '';
  const credential = row[idx['Authorized Official Name Suffix Text']] || row[idx['Authorized Official Credential Text']] || '';
  const parts = [prefix, first, middle, last, credential].map((v) => String(v || '').trim()).filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function providerName(row, idx) {
  const entity = String(row[idx['Entity Type Code']] || '');
  if (entity === '2') return String(row[idx['Provider Organization Name (Legal Business Name)']] || '').trim();
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

function buildHeaders(maxTax = 15, maxOtherId = 20, maxSecondary = 10, maxEndpoint = 5) {
  const headers = [
    'NPI',
    'Enumeration Date',
    'Last Update Date',
    'NPI Type',
    'Status',
    'Provider Name',
    'Authorized Official Name',
    'Authorized Official Title',
    'Authorized Official Phone',
    'Mailing Address',
    'Mailing Contact',
    'Primary Practice Address',
    'Primary Practice Contact',
  ];
  for (let i = 1; i <= maxSecondary; i += 1) {
    headers.push(`Secondary Practice Address ${i}`);
    headers.push(`Secondary Practice Contact ${i}`);
  }
  for (let i = 1; i <= maxEndpoint; i += 1) {
    headers.push(`Endpoint Type ${i}`);
    headers.push(`Endpoint ${i}`);
    headers.push(`Endpoint Description ${i}`);
    headers.push(`Endpoint Use ${i}`);
    headers.push(`Endpoint Content Type ${i}`);
    headers.push(`Endpoint Affiliation ${i}`);
    headers.push(`Endpoint Location ${i}`);
  }
  for (let i = 1; i <= maxOtherId; i += 1) {
    headers.push(`Other Identifier Issuer ${i}`);
    headers.push(`Other Identifier State ${i}`);
    headers.push(`Other Identifier Number ${i}`);
  }
  for (let i = 1; i <= maxTax; i += 1) {
    headers.push(`Taxonomy Code ${i}`);
    headers.push(`Taxonomy Description ${i}`);
    headers.push(`Taxonomy State ${i}`);
    headers.push(`Taxonomy License Number ${i}`);
    headers.push(`Taxonomy Primary ${i}`);
  }
  return headers;
}

function taxonomyColumns(row, idx, taxonomyMap, start = 1, end = 15) {
  const out = [];
  for (let n = start; n <= end; n += 1) {
    const code = String(row[idx[`Healthcare Provider Taxonomy Code_${n}`]] || '').trim();
    const license = String(row[idx[`Provider License Number_${n}`]] || '').trim();
    const state = String(row[idx[`Provider License Number State Code_${n}`]] || '').trim();
    const primary = String(row[idx[`Healthcare Provider Primary Taxonomy Switch_${n}`]] || '').trim().toUpperCase();
    const desc = taxonomyMap.get(code) || '';
    const selected = code ? (desc ? `${code} - ${desc}` : code) : '';
    out.push(code, selected, state, license, primary === 'Y' ? 'Yes' : primary === 'N' ? 'No' : primary);
  }
  return out;
}

function otherIdentifierColumns(row, idx, start = 1, end = 20) {
  const out = [];
  for (let n = start; n <= end; n += 1) {
    out.push(
      String(row[idx[`Other Provider Identifier Issuer_${n}`]] || '').trim(),
      String(row[idx[`Other Provider Identifier State_${n}`]] || '').trim(),
      String(row[idx[`Other Provider Identifier_${n}`]] || '').trim(),
    );
  }
  return out;
}

function flattenMainRow(row, idx, taxonomyMap, secondaryByNpi, endpointsByNpi) {
  const npi = String(row[idx.NPI] || '').trim();
  const mailingAddress = formatAddress([
    [row[idx['Provider First Line Business Mailing Address']], row[idx['Provider Second Line Business Mailing Address']]].filter(Boolean).map((v) => String(v || '').trim()).filter(Boolean).join(' '),
    [row[idx['Provider Business Mailing Address City Name']], row[idx['Provider Business Mailing Address State Name']], row[idx['Provider Business Mailing Address Postal Code']]].map((v) => String(v || '').trim()).filter(Boolean).join(', '),
    'United States',
  ]);
  const mailingContact = formatPhoneFax(
    row[idx['Provider Business Mailing Address Telephone Number']],
    row[idx['Provider Business Mailing Address Fax Number']],
  );
  const primaryAddress = formatAddress([
    [row[idx['Provider First Line Business Practice Location Address']], row[idx['Provider Second Line Business Practice Location Address']]].map((v) => String(v || '').trim()).filter(Boolean).join(' '),
    [row[idx['Provider Business Practice Location Address City Name']], row[idx['Provider Business Practice Location Address State Name']], row[idx['Provider Business Practice Location Address Postal Code']]].map((v) => String(v || '').trim()).filter(Boolean).join(', '),
    'United States',
  ]);
  const primaryContact = formatPhoneFax(
    row[idx['Provider Business Practice Location Address Telephone Number']],
    row[idx['Provider Business Practice Location Address Fax Number']],
  );

  const secondary = secondaryByNpi.get(npi) || [];
  const secondaryCols = [];
  for (let i = 0; i < 10; i += 1) {
    const item = secondary[i];
    if (!item) {
      secondaryCols.push('', '');
      continue;
    }
    secondaryCols.push(item.address, item.contact);
  }

  const endpoints = endpointsByNpi.get(npi) || [];
  const endpointCols = [];
  for (let i = 0; i < 5; i += 1) {
    const ep = endpoints[i];
    if (!ep) {
      endpointCols.push('', '', '', '', '', '', '');
      continue;
    }
    endpointCols.push(ep.type, ep.endpoint, ep.description, ep.use, ep.contentType, ep.affiliation, ep.location);
  }

  return [
    npi,
    row[idx['Provider Enumeration Date']] || '',
    row[idx['Last Update Date']] || '',
    npiType(row[idx['Entity Type Code']]),
    statusLabel(row[idx['NPI Deactivation Date']] ? 'D' : 'A'),
    providerName(row, idx),
    authOfficialName(row, idx),
    row[idx['Authorized Official Title or Position']] || '',
    row[idx['Authorized Official Telephone Number']] || '',
    mailingAddress,
    mailingContact,
    primaryAddress,
    primaryContact,
    ...secondaryCols,
    ...endpointCols,
    ...otherIdentifierColumns(row, idx),
    ...taxonomyColumns(row, idx, taxonomyMap),
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

async function loadSecondaryLocations(filePath) {
  const byNpi = new Map();
  if (!filePath || !fs.existsSync(filePath)) return byNpi;
  const idx = await readHeader(filePath);
  const rl = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const row = parseCsvLine(line);
    const npi = String(row[idx.NPI] || '').trim();
    if (!npi) continue;
    const address = formatAddress([
      [row[idx['Provider Secondary Practice Location Address- Address Line 1']], row[idx['Provider Secondary Practice Location Address- Address Line 2']]].map((v) => String(v || '').trim()).filter(Boolean).join(' '),
      [row[idx['Provider Secondary Practice Location Address- City Name']], row[idx['Provider Secondary Practice Location Address- State Name']], row[idx['Provider Secondary Practice Location Address- Postal Code']]].map((v) => String(v || '').trim()).filter(Boolean).join(', '),
      'United States',
    ]);
    const contact = formatPhoneFax(
      row[idx['Provider Secondary Practice Location Address- Telephone Number']],
      row[idx['Provider Secondary Practice Location Address- Fax Number']],
    );
    if (!byNpi.has(npi)) byNpi.set(npi, []);
    byNpi.get(npi).push({ address, contact });
  }
  return byNpi;
}

async function loadEndpoints(filePath) {
  const byNpi = new Map();
  if (!filePath || !fs.existsSync(filePath)) return byNpi;
  const idx = await readHeader(filePath);
  const rl = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const row = parseCsvLine(line);
    const npi = String(row[idx.NPI] || '').trim();
    if (!npi) continue;
    const item = {
      type: row[idx['Endpoint Type']] || '',
      endpoint: row[idx['Endpoint']] || '',
      description: row[idx['Endpoint Description']] || '',
      use: row[idx['Endpoint Use Description']] || row[idx['Endpoint Use']] || '',
      contentType: row[idx['Content Type']] || '',
      affiliation: row[idx['Affiliation']] || '',
      location: row[idx['Endpoint Location']] || '',
    };
    if (!byNpi.has(npi)) byNpi.set(npi, []);
    byNpi.get(npi).push(item);
  }
  return byNpi;
}

async function findExtractedFiles(dir) {
  if (!fs.existsSync(dir)) {
    return { main: undefined, secondary: undefined, endpoints: undefined };
  }
  const names = await fs.promises.readdir(dir, { recursive: true });
  const files = names.map((n) => (typeof n === 'string' ? path.join(dir, n) : path.join(dir, String(n))));
  const main = files.find((f) => /npidata_pfile.*\.csv$/i.test(f) && !/fileheader/i.test(f));
  const secondary = files.find((f) => /pl_pfile.*\.csv$/i.test(f) && !/fileheader/i.test(f));
  const endpoints = files.find((f) => /endpoint_pfile.*\.csv$/i.test(f) && !/fileheader/i.test(f));
  return { main, secondary, endpoints };
}

async function unzipIfNeeded(zipPath, extractDir) {
  const existing = await findExtractedFiles(extractDir);
  if (existing.main) return existing;
  console.log('Extracting zip (this can take several minutes)...');
  await ensureDir(extractDir);
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', extractDir]);
  } catch {
    await execFileAsync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`]);
  }
  return findExtractedFiles(extractDir);
}

async function exportFlorida() {
  await ensureDir(WORK);
  const zipPath = path.join(WORK, 'NPPES_Data_Dissemination_July_2026_V2.zip');
  const extractDir = path.join(WORK, 'extracted');
  const taxonomyMap = await loadTaxonomyMap();
  await downloadFile(ZIP_URL, zipPath);
  const files = await unzipIfNeeded(zipPath, extractDir);
  if (!files.main) throw new Error('Could not find npidata_pfile CSV in extracted NPPES bundle');

  console.log('Loading secondary practice locations...');
  const secondaryByNpi = await loadSecondaryLocations(files.secondary);
  console.log('Loading endpoints...');
  const endpointsByNpi = await loadEndpoints(files.endpoints);

  const headers = buildHeaders();
  const idx = await readHeader(files.main);
  const stateCol = idx['Provider Business Practice Location Address State Name'];
  if (stateCol == null) throw new Error('Practice location state column not found in NPPES file');

  const out = createWriteStream(OUTPUT, { encoding: 'utf8' });
  out.write(`${headers.map(csvEscape).join(',')}\n`);

  const rl = readline.createInterface({ input: createReadStream(files.main, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  let total = 0;
  let written = 0;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    total += 1;
    const row = parseCsvLine(line);
    const state = String(row[stateCol] || '').trim().toUpperCase();
    if (state !== FL_STATE) continue;
    const flat = flattenMainRow(row, idx, taxonomyMap, secondaryByNpi, endpointsByNpi);
    out.write(`${flat.map(csvEscape).join(',')}\n`);
    written += 1;
    if (written % 25000 === 0) console.log(`Written ${written} Florida providers...`);
  }
  out.end();
  console.log(`Done. Scanned ${total} national rows, wrote ${written} Florida providers to ${OUTPUT}`);
}

exportFlorida().catch((error) => {
  console.error(error);
  process.exit(1);
});
