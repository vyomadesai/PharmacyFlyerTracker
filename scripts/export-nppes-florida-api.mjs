import fs from 'fs';
import path from 'path';

const ROOT = 'c:/MDP/pharmacyFlyerTracker/pharmacy-flyer-tracker-v2';
const OUTPUT = path.join(ROOT, 'nppes_florida_providers.csv');
const NUCC_CACHE = path.join(ROOT, 'nppes-fl-export/nucc_taxonomy_251.csv');
const NPPES_API = 'https://npiregistry.cms.hhs.gov/api/';

const FL_CITIES = [
  'MIAMI', 'MIAMI BEACH', 'HIALEAH', 'FORT LAUDERDALE', 'HOLLYWOOD', 'PEMBROKE PINES', 'CORAL SPRINGS',
  'POMPANO BEACH', 'DAVIE', 'SUNRISE', 'PLANTATION', 'DEERFIELD BEACH', 'BOCA RATON', 'DELRAY BEACH',
  'WEST PALM BEACH', 'LAKE WORTH', 'BOYNTON BEACH', 'JUPITER', 'PALM BEACH GARDENS', 'WELLINGTON',
  'ORLANDO', 'KISSIMMEE', 'SANFORD', 'ALTAMONTE SPRINGS', 'OCOEE', 'WINTER PARK', 'APOPKA',
  'TAMPA', 'ST PETERSBURG', 'SAINT PETERSBURG', 'CLEARWATER', 'BRANDON', 'LARGO', 'PINELLAS PARK',
  'JACKSONVILLE', 'ORANGE PARK', 'PENSACOLA', 'TALLAHASSEE', 'GAINESVILLE', 'OCALA', 'LAKELAND',
  'SARASOTA', 'BRADENTON', 'VENICE', 'NAPLES', 'FORT MYERS', 'CAPE CORAL', 'PORT CHARLOTTE',
  'DAYTONA BEACH', 'DELTONA', 'MELBOURNE', 'PALM BAY', 'PORT ST LUCIE', 'FORT PIERCE', 'VERO BEACH',
  'PANAMA CITY', 'DESTIN', 'CRESTVIEW', 'LAKELAND', 'WINTER HAVEN', 'HOMESTEAD', 'DORAL',
  'NORTH MIAMI', 'AVENTURA', 'CUTLER BAY', 'KENDALL', 'KEY WEST', 'MARCO ISLAND',
];

const LIMIT = 200;
const MAX_SKIP = 1000;
const CONCURRENCY = 3;
const DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  if (!fs.existsSync(NUCC_CACHE)) {
    const response = await fetch('https://www.nucc.org/images/stories/CSV/nucc_taxonomy_251.csv');
    const text = await response.text();
    await fs.promises.mkdir(path.dirname(NUCC_CACHE), { recursive: true });
    await fs.promises.writeFile(NUCC_CACHE, text, 'utf8');
  }
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

async function fetchNppes(params, retries = 4) {
  const url = new URL(NPPES_API);
  url.searchParams.set('version', '2.1');
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      url.searchParams.set(key, String(value).trim());
    }
  }
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (response.status === 403 || response.status === 429) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.Errors?.length) throw new Error(data.Errors.map((e) => e.description).join('; '));
      return data;
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(1000 * attempt);
    }
  }
  return { results: [], result_count: 0 };
}

function formatAddressBlock(address) {
  if (!address) return '';
  const street = [address.address_1, address.address_2].filter(Boolean).join(' ').trim();
  const cityLine = [address.city, address.state, String(address.postal_code || '').slice(0, 5)].filter(Boolean).join(', ');
  return [street, cityLine, address.country_name || 'United States'].filter(Boolean).join('\n');
}

function formatContact(address) {
  if (!address) return '';
  const bits = [];
  if (address.telephone_number) bits.push(`Phone: ${address.telephone_number}`);
  if (address.fax_number) bits.push(`Fax:${address.fax_number}`);
  return bits.join(' | ');
}

function authOfficial(basic) {
  const parts = [
    basic.authorized_official_name_prefix,
    basic.authorized_official_first_name,
    basic.authorized_official_middle_name,
    basic.authorized_official_last_name,
    basic.authorized_official_credential,
  ].map((v) => String(v || '').trim()).filter((v) => v && v !== '--');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function providerDisplay(record) {
  const basic = record.basic || {};
  const isOrg = String(record.enumeration_type || '').toUpperCase() === 'NPI-2';
  if (isOrg) return String(basic.organization_name || '').trim();
  return [
    basic.name_prefix,
    basic.first_name,
    basic.middle_name,
    basic.last_name,
    basic.credential,
  ].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
}

function flattenRecord(record, taxonomyMap) {
  const basic = record.basic || {};
  const addresses = record.addresses || [];
  const mailing = addresses.find((a) => a.address_purpose === 'MAILING') || null;
  const primary = addresses.find((a) => a.address_purpose === 'LOCATION') || null;
  const secondary = (record.practiceLocations || []).map((a) => ({
    address: formatAddressBlock(a),
    contact: formatContact(a),
  }));

  const endpoints = (record.endpoints || []).slice(0, 5).map((ep) => ({
    type: ep.endpoint_type || ep.endpointType || '',
    endpoint: ep.endpoint || '',
    description: ep.endpoint_type_description || ep.endpoint_description || '',
    use: ep.use_description || ep.endpoint_use || '',
    contentType: ep.content_type_description || ep.content_type || '',
    affiliation: ep.affiliation || '',
    location: ep.endpoint_location || '',
  }));

  const identifiers = (record.identifiers || []).slice(0, 20).map((id) => ({
    issuer: id.desc || id.issuer || '',
    state: id.state || '',
    number: id.identifier || '',
  }));

  const taxonomies = (record.taxonomies || []).slice(0, 15).map((tax) => {
    const code = String(tax.code || '').trim();
    const desc = String(tax.desc || taxonomyMap.get(code) || '').trim();
    return {
      code,
      selected: code ? (desc ? `${code} - ${desc}` : code) : '',
      state: tax.state || '',
      license: tax.license || '',
      group: tax.taxonomy_group || '',
    };
  });

  const row = [
    record.number || '',
    basic.enumeration_date || '',
    basic.last_updated || '',
    String(record.enumeration_type || '').toUpperCase() === 'NPI-2' ? 'NPI-2 Organization' : 'NPI-1 Individual',
    String(basic.status || '').toUpperCase() === 'A' ? 'Active' : basic.status || '',
    providerDisplay(record),
    authOfficial(basic),
    basic.authorized_official_title_or_position || '',
    basic.authorized_official_telephone_number || '',
    formatAddressBlock(mailing),
    formatContact(mailing),
    formatAddressBlock(primary),
    formatContact(primary),
  ];

  for (let i = 0; i < 10; i += 1) {
    row.push(secondary[i]?.address || '', secondary[i]?.contact || '');
  }
  for (let i = 0; i < 5; i += 1) {
    const ep = endpoints[i];
    row.push(
      ep?.type || '', ep?.endpoint || '', ep?.description || '', ep?.use || '',
      ep?.contentType || '', ep?.affiliation || '', ep?.location || '',
    );
  }
  for (let i = 0; i < 20; i += 1) {
    const id = identifiers[i];
    row.push(id?.issuer || '', id?.state || '', id?.number || '');
  }
  for (let i = 0; i < 15; i += 1) {
    const tax = taxonomies[i];
    row.push(
      tax?.code || '',
      tax?.selected || '',
      tax?.state || '',
      tax?.license || '',
      tax?.group || '',
    );
  }
  return row;
}

function buildHeaders() {
  const headers = [
    'NPI', 'Enumeration Date', 'Last Update Date', 'NPI Type', 'Status', 'Provider Name',
    'Authorized Official Name', 'Authorized Official Title', 'Authorized Official Phone',
    'Mailing Address', 'Mailing Contact', 'Primary Practice Address', 'Primary Practice Contact',
  ];
  for (let i = 1; i <= 10; i += 1) {
    headers.push(`Secondary Practice Address ${i}`, `Secondary Practice Contact ${i}`);
  }
  for (let i = 1; i <= 5; i += 1) {
    headers.push(
      `Endpoint Type ${i}`, `Endpoint ${i}`, `Endpoint Description ${i}`, `Endpoint Use ${i}`,
      `Endpoint Content Type ${i}`, `Endpoint Affiliation ${i}`, `Endpoint Location ${i}`,
    );
  }
  for (let i = 1; i <= 20; i += 1) {
    headers.push(`Other Identifier Issuer ${i}`, `Other Identifier State ${i}`, `Other Identifier Number ${i}`);
  }
  for (let i = 1; i <= 15; i += 1) {
    headers.push(
      `Taxonomy Code ${i}`, `Taxonomy Description ${i}`, `Taxonomy State ${i}`,
      `Taxonomy License Number ${i}`, `Taxonomy Group ${i}`,
    );
  }
  return headers;
}

async function runQueue(tasks, workerCount) {
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      await tasks[current]();
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function main() {
  const taxonomyMap = await loadTaxonomyMap();
  const byNpi = new Map();
  const tasks = [];

  for (const city of FL_CITIES) {
    tasks.push(async () => {
      let skip = 0;
      let total = Infinity;
      while (skip <= MAX_SKIP && skip < total) {
        const data = await fetchNppes({ state: 'FL', city, limit: LIMIT, skip });
        total = Number(data.result_count || 0);
        for (const record of data.results || []) {
          const npi = String(record.number || '').trim();
          if (!npi) continue;
          const addresses = record.addresses || [];
          const hasFl = addresses.some((a) => String(a.state || '').toUpperCase() === 'FL')
            || (record.practiceLocations || []).some((a) => String(a.state || '').toUpperCase() === 'FL');
          if (!hasFl) continue;
          byNpi.set(npi, record);
        }
        if (!data.results?.length || data.results.length < LIMIT) break;
        skip += LIMIT;
        await sleep(DELAY_MS);
      }
    });
  }

  console.log(`Searching NPPES across ${FL_CITIES.length} Florida cities...`);
  let done = 0;
  await runQueue(tasks.map((task) => async () => {
    await task();
    done += 1;
    if (done % 10 === 0 || done === tasks.length) {
      console.log(`City progress ${done}/${tasks.length}, unique NPIs ${byNpi.size}`);
    }
  }), CONCURRENCY);

  const headers = buildHeaders();
  const lines = [headers.map(csvEscape).join(',')];
  for (const record of byNpi.values()) {
    lines.push(flattenRecord(record, taxonomyMap).map(csvEscape).join(','));
  }
  await fs.promises.writeFile(OUTPUT, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${byNpi.size} Florida providers to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
