import { Router } from 'express';
import { getPool, sql } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { toFloridaDateString } from '../../utils/timezone.js';
import { planRoute, PlanDoctor } from '../../services/routeOptimizer/index.js';
import { env } from '../../config/env.js';

export const clientWorkflowRoutes = Router();
clientWorkflowRoutes.use(requireAuth);

// Configurable via CHECK_IN_RADIUS_MILES env var (see config/env.ts).
const CHECK_IN_RADIUS_MILES = env.checkInRadiusMiles;

const LOCAL_DOCTOR_TYPE_LABELS: Record<string, string> = {
  '023': 'Physician Assistant / Mid-level Prescriber',
  '028': 'Nurse Practitioner / ARNP',
  '050': 'Dentist',
  '056': 'Optometry / Ophthalmic Provider',
  '060': 'Medical Doctor / Prescriber',
  '065': 'Podiatry',
  '122': 'Podiatric Provider',
  '152': 'Optometry / Ophthalmic Provider',
  '207': 'Physician / Specialist',
  '208': 'Physician / Specialist',
  EM: 'Emergency Medicine',
  FP: 'Family Practice',
  IM: 'Internal Medicine',
  VET: 'Veterinarian'
};

function localDoctorTypeLabel(code: unknown) {
  const normalized = clean(code)?.toUpperCase();
  if (!normalized) return null;
  return LOCAL_DOCTOR_TYPE_LABELS[normalized] || `Doctor type ${normalized}`;
}

type Coordinates = { latitude: number; longitude: number };

type WorkflowCapacityType = 'full_time' | 'part_time' | 'custom';

const WORKFLOW_TIME_CONSTANTS = {
  averageStopServiceMinutes: 10,
  averageParkingBufferMinutes: 5,
  denseZoneDriveMinutesPerStop: 6,
  wideZoneDriveMinutesPerStop: 10,
  zoneStartEndBufferMinutes: 20
};

type TargetCandidate = {
  targetType: string;
  targetId: number | null;
  doctorId: number | null;
  npiNumber: string | null;
  targetName: string;
  practiceName: string | null;
  backendSpecialty: string | null;
  backendDoctorCategory: string | null;
  npiTaxonomyCode: string | null;
  npiTaxonomyDescription: string | null;
  npiIsPrimaryTaxonomy: boolean | null;
  specialty: string | null;
  doctorCategory: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
  fax: string | null;
  licenseNumber: string | null;
  taxonomyCode: string | null;
  isPrimaryTaxonomy: boolean | null;
  taxonomyDescription: string | null;
  marketNumber: string | null;
  geographyLabel: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles?: number | null;
};

const CLIENT_PROMPT_COVERAGE = [
  { id: 1, prompt: 'Doctor database / NPI config', coveredBy: 'Doctor and target APIs expose NPI, doctor name, specialty/category, license, taxonomy, primary address, secondary target fields, phone/fax, and active status.' },
  { id: 2, prompt: 'Search/filter doctors by specialty, NPI, address, distance, and type', coveredBy: 'GET /api/client-workflow/targets supports q, specialty, npi, city/state/zip, doctorCategory, doctorType, market, latitude/longitude, and radiusMiles.' },
  { id: 3, prompt: 'Flyer campaign configuration', coveredBy: 'Campaign API stores flyer title/category/identifier/url/target audience and the workflow links each rule to one campaign/flyer.' },
  { id: 4, prompt: 'Assign a flyer to selected doctors/pharmacies', coveredBy: 'Targeting configs generate suggestions; admin approval creates campaign assignments for selected target locations.' },
  { id: 5, prompt: 'Geo/radius/market rules for Pinellas Park and St. Petersburg only', coveredBy: 'TargetingRule stores city, center coordinates, and radius; doctor suggestions are restricted to Pinellas Park, FL and St. Petersburg, FL.' },
  { id: 6, prompt: 'Admin review/approval before field release', coveredBy: 'Assignments begin as suggested, then /approve or /reject changes ApprovalStatus before routes are generated.' },
  { id: 7, prompt: 'Field person/distributor assigned work list', coveredBy: 'Approved assignments store StaffUserId and mobile route APIs return only the logged-in field user\'s work.' },
  { id: 8, prompt: 'Route planning from home/current location', coveredBy: 'Route generation orders approved stops by nearest-next distance from start latitude/longitude and creates route stops.' },
  { id: 9, prompt: 'Calendar/day schedule', coveredBy: 'ScheduledDate and RouteDate drive today\'s route in the mobile app and admin filters.' },
  { id: 10, prompt: 'Visit frequency and next due date', coveredBy: 'VisitFrequencyDays, LastVisitDate, and NextVisitDueDate are stored and updated when a delivery is completed.' },
  { id: 11, prompt: 'GPS check-in at location', coveredBy: 'Assignment check-in validates distance to the target and stores check-in GPS/time/status.' },
  { id: 12, prompt: 'Proof upload and completion tracking', coveredBy: 'Delivery submission links assignment/route/target, stores uploaded photo, updates assignment status, and reports photo availability.' }
];

const CITY_COORDINATES: Record<string, Coordinates> = {
  'PINELLAS PARK,FL': { latitude: 27.8428, longitude: -82.6995 },
  'PINELLAS PARK': { latitude: 27.8428, longitude: -82.6995 },
  'ST PETERSBURG,FL': { latitude: 27.7676, longitude: -82.6403 },
  'ST. PETERSBURG,FL': { latitude: 27.7676, longitude: -82.6403 },
  'ST PETERSBURG': { latitude: 27.7676, longitude: -82.6403 },
  'ST. PETERSBURG': { latitude: 27.7676, longitude: -82.6403 },
  'CLEARWATER,FL': { latitude: 27.9659, longitude: -82.8001 },
  'LARGO,FL': { latitude: 27.9095, longitude: -82.7873 }
};

const ZIP_COORDINATES: Record<string, Coordinates> = {
  '33700': { latitude: 27.7676, longitude: -82.6403 },
  '33701': { latitude: 27.7719, longitude: -82.6358 },
  '33702': { latitude: 27.8431, longitude: -82.6334 },
  '33703': { latitude: 27.8172, longitude: -82.6267 },
  '33704': { latitude: 27.7979, longitude: -82.6385 },
  '33705': { latitude: 27.7398, longitude: -82.6431 },
  '33706': { latitude: 27.7425, longitude: -82.7526 },
  '33707': { latitude: 27.7589, longitude: -82.7309 },
  '33708': { latitude: 27.8174, longitude: -82.7973 },
  '33709': { latitude: 27.8170, longitude: -82.7289 },
  '33710': { latitude: 27.7909, longitude: -82.7246 },
  '33711': { latitude: 27.7382, longitude: -82.6897 },
  '33712': { latitude: 27.7335, longitude: -82.6668 },
  '33713': { latitude: 27.7891, longitude: -82.6793 },
  '33714': { latitude: 27.8170, longitude: -82.6792 },
  '33715': { latitude: 27.7091, longitude: -82.7192 },
  '33716': { latitude: 27.8763, longitude: -82.6525 },
  '33733': { latitude: 27.7676, longitude: -82.6403 },
  '33734': { latitude: 27.7565, longitude: -82.6380 },
  '33742': { latitude: 27.8428, longitude: -82.6995 },
  '33781': { latitude: 27.8399, longitude: -82.7140 },
  '33782': { latitude: 27.8581, longitude: -82.6923 },
  '33784': { latitude: 27.8428, longitude: -82.6995 },
  '34652': { latitude: 28.2350, longitude: -82.7326 }
};

type DoctorLocationKey = 'PINELLAS_PARK' | 'ST_PETERSBURG';

type DoctorSuggestionLocation = {
  key: DoctorLocationKey;
  city: string;
  state: 'FL';
  aliases: string[];
  zips: string[];
  coordinates: Coordinates;
};

const ALLOWED_DOCTOR_SUGGESTION_LOCATIONS: DoctorSuggestionLocation[] = [
  {
    key: 'PINELLAS_PARK',
    city: 'Pinellas Park',
    state: 'FL',
    coordinates: { latitude: 27.8428, longitude: -82.6995 },
    zips: ['33781', '33782'],
    aliases: [
      'PINELLAS PARK',
      'PINELLAS PARK,',
      'PINELLASPARK',
      'PINNELLAS PARK',
      'PINELLAS PK'
    ]
  },
  {
    key: 'ST_PETERSBURG',
    city: 'St. Petersburg',
    state: 'FL',
    coordinates: { latitude: 27.7676, longitude: -82.6403 },
    zips: [
      '33701', '33702', '33703', '33704',
      '33705', '33706', '33707', '33708',
      '33709', '33710', '33711', '33712',
      '33713', '33714', '33715', '33716'
    ],
    aliases: [
      'ST PETERSBURG',
      'ST. PETERSBURG',
      'ST.PETERSBURG',
      'ST PETERSBURG,',
      'SAINT PETERSBURG',
      'SAINT PETERSBURG,',
      'ST PETE',
      'ST. PETE',
      'ST.PETE',
      'ST PET',
      'ST.PET',
      'ST.PETERS',
      'ST PETERS',
      'ST PETERBURG',
      'ST. PETERBURG',
      'ST PETERSBUEG',
      'ST PETESBURG',
      'ST. PETESBURG',
      'SAINT PETERESBURG',
      'SAINT PETERSBURF',
      'St Petersburg',
      'Saint Petersburg',
      'St. Petersburg',
      'St Pete'
    ]
  }
];

const EXCLUDED_DOCTOR_CITY_ALIASES = new Set([
  'TAMPA',
  'MIAMI',
  'ST PETE BEACH',
  'ST. PETE BEACH',
  'SAINT PETE BEACH',
  'SAINT PETERSBURG BEACH',
  'ST PETERSBURG BEACH',
  'TREASURE ISLAND',
  'SOUTH PASADENA',
  'GULFPORT',
  'MADEIRA BEACH',
  'KENNETH CITY',
  'PALM HARBOR',
  'TIERRA VERDE'
].map(normalizeLocationForCompare));

const DOCTOR_LOCATION_ALIAS_INDEX = new Map<string, DoctorSuggestionLocation>();
const DOCTOR_LOCATION_ZIP_INDEX = new Map<string, DoctorSuggestionLocation>();

for (const location of ALLOWED_DOCTOR_SUGGESTION_LOCATIONS) {
  DOCTOR_LOCATION_ALIAS_INDEX.set(normalizeLocationForCompare(location.city), location);

  for (const alias of location.aliases) {
    DOCTOR_LOCATION_ALIAS_INDEX.set(normalizeLocationForCompare(alias), location);
  }

  for (const zip of location.zips) {
    DOCTOR_LOCATION_ZIP_INDEX.set(normalizeZip(zip), location);
  }
}

function isDoctorSuggestionType(value: unknown) {
  return normalizeForCompare(value || 'Doctor') === 'DOCTOR';
}

function doctorLocationFromCity(city: unknown) {
  const normalizedCity = normalizeLocationForCompare(city);
  if (!normalizedCity) return null;
  if (EXCLUDED_DOCTOR_CITY_ALIASES.has(normalizedCity)) return null;
  return DOCTOR_LOCATION_ALIAS_INDEX.get(normalizedCity) || null;
}

function doctorLocationFromAddress(city: unknown, zip: unknown) {
  const normalizedCity = normalizeLocationForCompare(city);

  // Trust a populated city over ZIP. This prevents nearby cities such as
  // ST PETE BEACH, GULFPORT, or TREASURE ISLAND from being pulled in only
  // because their ZIP is near St. Petersburg.
  if (normalizedCity) {
    return doctorLocationFromCity(normalizedCity);
  }

  // Only use ZIP fallback when the source city is blank or missing.
  return DOCTOR_LOCATION_ZIP_INDEX.get(normalizeZip(zip)) || null;
}

function allowedDoctorSuggestionLocation(city: unknown) {
  return doctorLocationFromCity(city);
}

function doctorSuggestionLocationsForRequest(city: unknown) {
  const requested = clean(city);
  const normalized = normalizeLocationForCompare(requested);

  if (
    !requested ||
    normalized === 'ALL' ||
    normalized === 'BOTH' ||
    normalized === 'PINELLAS PARK + ST PETERSBURG' ||
    normalized === 'PINELLAS PARK AND ST PETERSBURG' ||
    normalized === 'PINELLAS PARK ST PETERSBURG'
  ) {
    return ALLOWED_DOCTOR_SUGGESTION_LOCATIONS;
  }

  const allowed = allowedDoctorSuggestionLocation(requested);
  return allowed ? [allowed] : [];
}

function clean(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function boolValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
}

function frequencyDaysFromInput(frequencyType: unknown, visitFrequencyDays: unknown) {
  const explicitDays = numberOrNull(visitFrequencyDays);
  if (explicitDays !== null && explicitDays > 0) return explicitDays;
  const normalized = normalizeForCompare(frequencyType);
  if (normalized === 'ONE_TIME' || normalized === 'ONE TIME') return null;
  if (normalized === 'WEEKLY') return 7;
  if (normalized === 'BIWEEKLY' || normalized === 'BI-WEEKLY') return 14;
  if (normalized === 'MONTHLY') return 30;
  if (normalized === 'CUSTOM_DAYS' || normalized === 'CUSTOM DAYS') return explicitDays;
  return explicitDays;
}

function configFrequencyLabel(frequencyType: unknown, visitFrequencyDays: unknown) {
  const normalized = normalizeForCompare(frequencyType);
  const days = numberOrNull(visitFrequencyDays);
  if (normalized === 'WEEKLY') return 'Weekly';
  if (normalized === 'BIWEEKLY' || normalized === 'BI-WEEKLY') return 'Biweekly';
  if (normalized === 'MONTHLY') return 'Monthly';
  if (normalized === 'ONE_TIME' || normalized === 'ONE TIME') return 'One time';
  if (days !== null && days > 0) return `Every ${days} days`;
  return 'One time';
}

function buildConfigDisplayName(base: {
  flyerTitle?: unknown;
  targetType?: unknown;
  specialtySource?: unknown;
  doctorType?: unknown;
  specialty?: unknown;
  customSpecialty?: unknown;
  taxonomyDescription?: unknown;
  geography?: unknown;
  radiusMiles?: unknown;
  visitFrequencyType?: unknown;
  visitFrequencyDays?: unknown;
}) {
  const flyer = clean(base.flyerTitle) || 'Flyer';
  const target = clean(base.targetType) || 'Target';
  const geography = clean(base.geography) || 'Any area';
  const radius = numberOrNull(base.radiusMiles);
  const frequency = configFrequencyLabel(base.visitFrequencyType, base.visitFrequencyDays);
  const source = normalizeForCompare(base.specialtySource || 'BACKEND');
  const sourceToken = (() => {
    if (normalizeForCompare(target) === 'PHARMACY') return null;
    if (source === 'NPI_REGISTRY') {
      return `NPI: ${clean(base.taxonomyDescription) || clean(base.specialty) || clean(base.customSpecialty) || 'Any taxonomy'}`;
    }
    return `Backend: ${clean(base.specialty) || clean(base.customSpecialty) || clean(base.doctorType) || 'Any'}`;
  })();
  return [
    flyer,
    target,
    sourceToken,
    geography,
    radius !== null ? `${radius} mi` : null,
    frequency
  ].filter(Boolean).join(' • ');
}

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function dateOrToday(value: unknown) {
  const raw = clean(value);
  if (raw) return raw;
  return toFloridaDateString();
}

function normalizeForCompare(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeLocationForCompare(value: unknown) {
  return normalizeForCompare(value)
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^SAINT\b/, 'ST')
    .replace(/\bSAINT\b/g, 'ST')
    .trim();
}

function normalizeZip(value: unknown) {
  return String(value || '').trim().slice(0, 5);
}

function zipCoordinate(zip: unknown) {
  return ZIP_COORDINATES[normalizeZip(zip)] || null;
}

function cityCoordinate(city?: unknown, state?: unknown): Coordinates | null {
  const c = normalizeForCompare(city);
  const s = normalizeForCompare(state);
  if (!c) return null;
  return CITY_COORDINATES[[c, s].filter(Boolean).join(',')] || CITY_COORDINATES[c] || null;
}

function validCoordinate(value: number | null) {
  return value !== null && value !== 0;
}

function targetCoordinates(target: TargetCandidate): Coordinates | null {
  if (validCoordinate(target.latitude) && validCoordinate(target.longitude)) {
    return { latitude: target.latitude as number, longitude: target.longitude as number };
  }
  return deriveCoordinatesFromAddress(target.addressCity, target.addressState, target.addressZip);
}

function deriveCoordinatesFromAddress(city?: unknown, state?: unknown, zip?: unknown): Coordinates | null {
  const byZip = zipCoordinate(zip);
  if (byZip) return byZip;
  const doctorLocation = doctorLocationFromAddress(city, zip);
  if (doctorLocation) return doctorLocation.coordinates;
  return cityCoordinate(city, state);
}

function milesBetween(a: Coordinates, b: Coordinates) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function workflowCapacityHours(capacityType: unknown, customHours: unknown) {
  const normalized = normalizeForCompare(capacityType);
  if (normalized === 'PART_TIME' || normalized === 'PART-TIME') return { type: 'part_time' as WorkflowCapacityType, hours: 5 };
  if (normalized === 'CUSTOM') {
    const parsed = numberOrNull(customHours);
    // Allow sub-hour shifts (e.g. 0.1h = 6 min) so the budget the planner uses
    // matches what the user typed. Floor at 0.1h to avoid a zero/negative budget.
    return { type: 'custom' as WorkflowCapacityType, hours: Math.max(0.1, Math.min(parsed || 8, 16)) };
  }
  return { type: 'full_time' as WorkflowCapacityType, hours: 8 };
}

function zoneBandForDistance(distanceMiles: number) {
  if (distanceMiles <= 10) return { start: 0, end: 10 };
  const end = 10 + Math.ceil((distanceMiles - 10) / 5) * 5;
  return { start: end - 5, end };
}

function workflowZoneBands(maxDistanceMiles: number) {
  const maxEndMiles = Math.max(30, zoneBandForDistance(maxDistanceMiles).end);
  const bands = [{ start: 0, end: 10 }];
  for (let start = 10; start < maxEndMiles; start += 5) {
    bands.push({ start, end: start + 5 });
  }
  return bands;
}

function workflowDoctorSpecialty(target: TargetCandidate) {
  return clean(target.backendSpecialty) || clean(target.specialty) || clean(target.npiTaxonomyDescription) || 'Unknown';
}

function estimateZoneMinutes(doctorCount: number, radiusEndMiles: number) {
  if (doctorCount <= 0) return 0;
  const perStopDriveMinutes = radiusEndMiles <= 15
    ? WORKFLOW_TIME_CONSTANTS.denseZoneDriveMinutesPerStop
    : WORKFLOW_TIME_CONSTANTS.wideZoneDriveMinutesPerStop;

  return (
    doctorCount * WORKFLOW_TIME_CONSTANTS.averageStopServiceMinutes
    + doctorCount * WORKFLOW_TIME_CONSTANTS.averageParkingBufferMinutes
    + doctorCount * perStopDriveMinutes
    + WORKFLOW_TIME_CONSTANTS.zoneStartEndBufferMinutes
  );
}

function sameDayString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return toFloridaDateString(value);
}

async function hasTable(tableName: string) {
  const pool = await getPool();
  const result = await pool.request()
    .input('TableName', sql.NVarChar, tableName)
    .query(`SELECT OBJECT_ID(CONCAT('dbo.', @TableName), 'U') AS ObjectId`);
  return Boolean(result.recordset[0]?.ObjectId);
}

async function hasColumn(tableName: string, columnName: string) {
  const pool = await getPool();
  const result = await pool.request()
    .input('TableName', sql.NVarChar, tableName)
    .input('ColumnName', sql.NVarChar, columnName)
    .query(`
      SELECT 1 AS HasColumn
      FROM sys.columns c
      INNER JOIN sys.objects o ON o.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE s.name = 'dbo' AND o.name = @TableName AND c.name = @ColumnName
    `);
  return Boolean(result.recordset[0]);
}

function targetMatchesText(target: TargetCandidate, value: string | null) {
  if (!value) return true;
  const haystack = [
    target.targetName,
    target.practiceName,
    target.specialty,
    target.npiNumber,
    target.addressStreet,
    target.addressCity,
    target.addressState,
    target.addressZip,
    target.phone,
    target.licenseNumber,
    target.taxonomyCode,
    target.taxonomyDescription
  ].map((item) => normalizeForCompare(item)).join(' ');
  return haystack.includes(normalizeForCompare(value));
}

function doctorTypeMatches(target: TargetCandidate, doctorType: string | null) {
  if (!doctorType) return true;
  const normalized = normalizeForCompare(doctorType);
  if (normalized === 'ANY') return true;
  if (normalized === 'PRIMARY CARE' || normalized === 'PRIMARY_CARE') {
    return normalizeForCompare(target.backendDoctorCategory) === 'PRIMARY CARE';
  }
  if (normalized === 'SPECIALTY' || normalized === 'SPECIALIST') {
    return normalizeForCompare(target.backendDoctorCategory) === 'SPECIALIST'
      || normalizeForCompare(target.backendDoctorCategory) === 'SPECIALTY';
  }
  return normalizeForCompare(target.backendDoctorCategory).includes(normalized)
    || normalizeForCompare(target.backendSpecialty).includes(normalized)
    || normalizeForCompare(target.specialty).includes(normalized)
    || normalizeForCompare(target.npiTaxonomyDescription).includes(normalized);
}

function targetMatchesCategory(target: TargetCandidate, category: string | null) {
  if (!category) return true;
  const needle = normalizeForCompare(category);
  return normalizeForCompare(target.doctorCategory).includes(needle)
    || normalizeForCompare(target.specialty).includes(needle);
}

function targetMatchesBackendSpecialty(target: TargetCandidate, specialty: string | null) {
  if (!specialty) return true;
  const needle = normalizeForCompare(specialty);
  return normalizeForCompare(target.backendSpecialty).includes(needle)
    || normalizeForCompare(target.backendDoctorCategory).includes(needle);
}

function targetMatchesNpiTaxonomy(target: TargetCandidate, query: any) {
  const taxonomyCode = clean(query.taxonomyCode);
  const taxonomyDescription = clean(query.taxonomyDescription);
  const specialty = clean(query.specialty || query.customSpecialty);
  const requirePrimaryTaxonomy = boolValue(query.requirePrimaryTaxonomy, false);

  if (taxonomyCode && !normalizeForCompare(target.npiTaxonomyCode).includes(normalizeForCompare(taxonomyCode))) {
    return false;
  }
  if (
    taxonomyDescription
    && !normalizeForCompare(target.npiTaxonomyDescription).includes(normalizeForCompare(taxonomyDescription))
  ) {
    return false;
  }
  if (
    specialty
    && !normalizeForCompare(target.npiTaxonomyDescription).includes(normalizeForCompare(specialty))
    && !normalizeForCompare(target.npiTaxonomyCode).includes(normalizeForCompare(specialty))
  ) {
    return false;
  }
  if (requirePrimaryTaxonomy && target.npiIsPrimaryTaxonomy !== true) return false;
  return true;
}

function applyTargetFilters(targets: TargetCandidate[], query: any) {
  const localDoctorOnly = boolValue(query.localDoctorOnly, false);
  const q = clean(query.q);
  const specialty = clean(query.specialty || query.customSpecialty);
  const npi = clean(query.npi || query.npiNumber);
  const city = clean(query.city || query.targetCity);
  const state = clean(query.state || query.targetState);
  const zip = clean(query.zip || query.addressZip);
  const doctorCategory = clean(query.doctorCategory);
  const doctorType = clean(query.doctorType || query.doctorCategory);
  const specialtySource = normalizeForCompare(query.specialtySource || 'BACKEND');
  const marketNumber = clean(query.marketNumber || query.market);
  const targetType = normalizeForCompare(query.targetType || 'Both');
  // For localDoctorOnly flows, SQL prefilters already constrain city/type.
  // Do not apply alias/zip whitelist here or valid rows can be dropped.
  const restrictDoctorLocations = !localDoctorOnly && (targetType === 'BOTH' || targetType === 'DOCTOR');
  const requestedDoctorLocations = restrictDoctorLocations
    ? (city ? doctorSuggestionLocationsForRequest(city) : ALLOWED_DOCTOR_SUGGESTION_LOCATIONS)
    : [];
  const requestedDoctorLocationKeys = new Set(requestedDoctorLocations.map((location) => location.key));
  const radiusMiles = numberOrNull(query.radiusMiles);
  const centerLat = numberOrNull(query.latitude ?? query.centerLatitude);
  const centerLng = numberOrNull(query.longitude ?? query.centerLongitude);
  const centerFromCity = cityCoordinate(city, state);
  const center = centerLat !== null && centerLng !== null
    ? { latitude: centerLat, longitude: centerLng }
    : centerFromCity;

  return targets
    .filter((target) => {
      const normalizedTargetType = normalizeForCompare(target.targetType);
      if (targetType !== 'BOTH' && normalizedTargetType !== targetType) return false;
      const isDoctorTarget = normalizedTargetType === 'DOCTOR';

      if (restrictDoctorLocations && isDoctorTarget) {
        if (!requestedDoctorLocations.length) return false;

        const targetLocation = doctorLocationFromAddress(target.addressCity, target.addressZip);
        if (!targetLocation) return false;
        if (!requestedDoctorLocationKeys.has(targetLocation.key)) return false;

        const targetState = normalizeForCompare(target.addressState);
        if (targetState && targetState !== 'FL') return false;
      }

      if (!targetMatchesText(target, q)) return false;
      if (isDoctorTarget) {
        if (!doctorTypeMatches(target, doctorType)) return false;
        if (doctorCategory && normalizeForCompare(doctorCategory) !== 'ANY' && !targetMatchesCategory(target, doctorCategory)) {
          return false;
        }
        if (specialtySource === 'NPI_REGISTRY') {
          if (!targetMatchesNpiTaxonomy(target, query)) return false;
        } else if (!targetMatchesBackendSpecialty(target, specialty)) {
          return false;
        }
        if (npi && !normalizeForCompare(target.npiNumber).includes(normalizeForCompare(npi))) return false;
      }
      // When radius filtering is active, geography is handled by distance — not exact city match.
      const skipStrictDoctorGeoChecks = isDoctorTarget && (restrictDoctorLocations || localDoctorOnly);
      if (radiusMiles === null || !center) {
        if (
          city &&
          !skipStrictDoctorGeoChecks &&
          normalizeLocationForCompare(target.addressCity) !== normalizeLocationForCompare(city)
        ) return false;
        // For doctor suggestion flow, city/zip location matching is authoritative.
        // Some Master_Doctor rows have blank or inconsistent state values.
        if (
          state &&
          !skipStrictDoctorGeoChecks &&
          normalizeForCompare(target.addressState) !== normalizeForCompare(state)
        ) return false;
      } else if (
        state &&
        !skipStrictDoctorGeoChecks &&
        normalizeForCompare(target.addressState) !== normalizeForCompare(state)
      ) {
        return false;
      }
      if (zip && normalizeForCompare(target.addressZip) !== normalizeForCompare(zip)) return false;
      if (marketNumber && !normalizeForCompare(target.marketNumber).includes(normalizeForCompare(marketNumber))) return false;
      return true;
    })
    .map((target) => {
      const coords = localDoctorOnly
        ? (
            validCoordinate(target.latitude) && validCoordinate(target.longitude)
              ? { latitude: target.latitude as number, longitude: target.longitude as number }
              : null
          )
        : targetCoordinates(target);
      if (center && coords) {
        return {
          ...target,
          latitude: coords.latitude,
          longitude: coords.longitude,
          distanceMiles: Number(milesBetween(center, coords).toFixed(2))
        };
      }
      return target;
    })
    .filter((target) => radiusMiles === null || target.distanceMiles === undefined || target.distanceMiles === null || target.distanceMiles <= radiusMiles)
    .sort((a, b) => {
      if (a.distanceMiles !== undefined || b.distanceMiles !== undefined) {
        return (a.distanceMiles ?? Number.MAX_SAFE_INTEGER) - (b.distanceMiles ?? Number.MAX_SAFE_INTEGER);
      }
      return a.targetName.localeCompare(b.targetName);
    });
}

async function loadDoctorTargets(query: any, limit = 500): Promise<TargetCandidate[]> {
  if (boolValue(query.localDoctorOnly, false)) {
    return loadLocalDoctorTargets(query, limit);
  }

  const pool = await getPool();
  const fastPreview = boolValue(query.fastPreview, false);
  const hasFax = await hasColumn('Master_Doctor', 'Doctor_Fax');
  const hasDoctorLatitude = await hasColumn('Master_Doctor', 'Doctor_Latitude');
  const hasDoctorLongitude = await hasColumn('Master_Doctor', 'Doctor_Longitude');
  const hasLatitude = await hasColumn('Master_Doctor', 'Latitude');
  const hasLongitude = await hasColumn('Master_Doctor', 'Longitude');
  const hasDoctorInfo = await hasTable('PharmacyFlyer_DoctorInfo');
  const infoNpi = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'NPI');
  const infoDoctorId = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'DoctorId');
  const infoDoctorID = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'DoctorID');
  const infoMasterDoctorId = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'MasterDoctorId');
  const infoPriSpec = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'pri-spec');
  const infoPriSpecUnderscore = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'pri_spec');
  const infoPriSpecPascal = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'PriSpec');
  const infoTaxonomyCode = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'taxonomy-code');
  const infoTaxonomyDescription = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'taxonomy-desc');
  const infoIsPrimary = hasDoctorInfo && await hasColumn('PharmacyFlyer_DoctorInfo', 'taxonomy-primary');
  const hasNpiRegistryConfig = await hasTable('npiRegisteryConfig');
  const npiTaxonomyCode = hasNpiRegistryConfig && await hasColumn('npiRegisteryConfig', 'TaxonomyCode');
  const npiTaxonomyDesc = hasNpiRegistryConfig && await hasColumn('npiRegisteryConfig', 'TaxonomyDesc');
  const npiJson = hasNpiRegistryConfig && await hasColumn('npiRegisteryConfig', 'NpiRegistryJson');

  const infoJoinConditions: string[] = [];
  if (infoDoctorId) infoJoinConditions.push('TRY_CONVERT(INT, info.[DoctorId]) = d.ID');
  if (infoDoctorID) infoJoinConditions.push('TRY_CONVERT(INT, info.[DoctorID]) = d.ID');
  if (infoMasterDoctorId) infoJoinConditions.push('TRY_CONVERT(INT, info.[MasterDoctorId]) = d.ID');
  if (infoNpi) infoJoinConditions.push("NULLIF(LTRIM(RTRIM(CAST(info.NPI AS VARCHAR(20)))), '') = NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '')");
  const infoPriSpecExpr = infoPriSpec
    ? "LTRIM(RTRIM(ISNULL(info.[pri-spec], '')))"
    : infoPriSpecUnderscore
      ? "LTRIM(RTRIM(ISNULL(info.pri_spec, '')))"
      : infoPriSpecPascal
        ? "LTRIM(RTRIM(ISNULL(info.PriSpec, '')))"
        : "CAST(NULL AS NVARCHAR(250))";
  const infoApply = !fastPreview && hasDoctorInfo && infoJoinConditions.length ? `
    OUTER APPLY (
      SELECT TOP 1
        ${infoPriSpecExpr} AS PriSpec,
        ${infoTaxonomyCode ? "LTRIM(RTRIM(ISNULL(info.[taxonomy-code], '')))" : "CAST(NULL AS NVARCHAR(80))"} AS TaxonomyCode,
        ${infoTaxonomyDescription ? "LTRIM(RTRIM(ISNULL(info.[taxonomy-desc], '')))" : "CAST(NULL AS NVARCHAR(500))"} AS TaxonomyDescription,
        ${infoIsPrimary ? "CASE WHEN LTRIM(RTRIM(ISNULL(CONVERT(NVARCHAR(20), info.[taxonomy-primary]), ''))) IN ('1','Y','YES','TRUE','PRIMARY') THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END" : "CAST(NULL AS BIT)"} AS IsPrimaryTaxonomy
      FROM dbo.PharmacyFlyer_DoctorInfo info
      WHERE ${infoJoinConditions.join(' OR ')}
      ORDER BY CASE WHEN NULLIF(${infoPriSpecExpr}, '') IS NOT NULL THEN 0 ELSE 1 END,
        ${infoIsPrimary ? "CASE WHEN LTRIM(RTRIM(ISNULL(CONVERT(NVARCHAR(20), info.[taxonomy-primary]), ''))) IN ('1','Y','YES','TRUE','PRIMARY') THEN 1 ELSE 0 END DESC," : ''} 1
    ) info
  ` : `
    OUTER APPLY (
      SELECT CAST(NULL AS NVARCHAR(250)) AS PriSpec,
             CAST(NULL AS NVARCHAR(80)) AS TaxonomyCode,
             CAST(NULL AS NVARCHAR(500)) AS TaxonomyDescription,
             CAST(NULL AS BIT) AS IsPrimaryTaxonomy
    ) info
  `;
  const npiApply = !fastPreview && hasNpiRegistryConfig ? `
    OUTER APPLY (
      SELECT TOP 1
        ${npiTaxonomyCode ? "LTRIM(RTRIM(ISNULL(nrc.TaxonomyCode, '')))" : "CAST(NULL AS NVARCHAR(80))"} AS NpiTaxonomyCode,
        ${npiTaxonomyDesc ? "LTRIM(RTRIM(ISNULL(nrc.TaxonomyDesc, '')))" : "CAST(NULL AS NVARCHAR(500))"} AS NpiTaxonomyDescription,
        ${npiJson ? `
          CASE
            WHEN ISJSON(nrc.NpiRegistryJson) = 1
             AND EXISTS (
               SELECT 1
               FROM OPENJSON(nrc.NpiRegistryJson, '$.taxonomies')
               WITH (
                 TaxonomyCode NVARCHAR(80) '$.code',
                 IsPrimary NVARCHAR(20) '$.primary'
               ) tx
               WHERE UPPER(LTRIM(RTRIM(ISNULL(tx.IsPrimary, '')))) IN ('TRUE', '1', 'Y', 'YES')
                 AND (
                   NULLIF(LTRIM(RTRIM(ISNULL(nrc.TaxonomyCode, ''))), '') IS NULL
                   OR NULLIF(LTRIM(RTRIM(ISNULL(tx.TaxonomyCode, ''))), '') = NULLIF(LTRIM(RTRIM(ISNULL(nrc.TaxonomyCode, ''))), '')
                 )
             )
            THEN CAST(1 AS BIT)
            ELSE CAST(0 AS BIT)
          END
        ` : 'CAST(NULL AS BIT)'} AS NpiIsPrimaryTaxonomy
      FROM dbo.npiRegisteryConfig nrc
      WHERE LTRIM(RTRIM(CAST(ISNULL(nrc.NPI, '') AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ISNULL(d.Doctor_NPINo, '') AS VARCHAR(20))))
      ORDER BY nrc.UpdatedAt DESC, nrc.CreatedAt DESC
    ) nrc
  ` : `
    OUTER APPLY (
      SELECT CAST(NULL AS NVARCHAR(80)) AS NpiTaxonomyCode,
             CAST(NULL AS NVARCHAR(500)) AS NpiTaxonomyDescription,
             CAST(NULL AS BIT) AS NpiIsPrimaryTaxonomy
    ) nrc
  `;

  const latitudeExpr = hasDoctorLatitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Latitude)' : hasLatitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Latitude)' : 'CAST(NULL AS DECIMAL(10,7))';
  const longitudeExpr = hasDoctorLongitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Longitude)' : hasLongitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Longitude)' : 'CAST(NULL AS DECIMAL(10,7))';
  const activeOnly = String(query.activeOnly ?? 'true').toLowerCase() !== 'false';
  const cityFilter = clean(query.city || query.targetCity);
  const doctorTypeFilter = clean(query.doctorType || query.specialty || query.customSpecialty);

  const normalizedSql = (field: string) => `
    UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(${field}, ''))), '.', ''), ',', ''), '  ', ' '))
  `;
  const cityFilterPredicate = cityFilter
    ? `AND ${normalizedSql('d.Doctor_AddressCity')} LIKE '%' + ${normalizedSql('@CityFilter')} + '%'`
    : '';
  const doctorTypePredicate = doctorTypeFilter && normalizeForCompare(doctorTypeFilter) !== 'ANY'
    ? `
        AND (
          ${normalizedSql('d.Doctor_Type')} LIKE '%' + ${normalizedSql('@DoctorTypeFilter')} + '%'
          OR ${normalizedSql('info.PriSpec')} LIKE '%' + ${normalizedSql('@DoctorTypeFilter')} + '%'
          OR ${normalizedSql('nrc.NpiTaxonomyDescription')} LIKE '%' + ${normalizedSql('@DoctorTypeFilter')} + '%'
        )
      `
    : '';

  const scanLimit = Math.min(Math.max(limit * 5, 500), 15000);
  const result = await pool.request()
    .input('CityFilter', sql.NVarChar, cityFilter)
    .input('DoctorTypeFilter', sql.NVarChar, doctorTypeFilter)
    .query(`
    SELECT TOP ${scanLimit}
      CAST('Doctor' AS NVARCHAR(30)) AS TargetType,
      CAST(NULL AS BIGINT) AS TargetId,
      d.ID AS DoctorId,
      LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, ''))) AS NpiNumber,
      LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS TargetName,
      (
        SELECT TOP 1 LTRIM(RTRIM(ISNULL(mp.Practice_Name, '')))
        FROM dbo.Doctor_Location_Mapping dlm
        INNER JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id
        WHERE dlm.Doctor_No = d.Doctor_NO
          AND ISNULL(dlm.Mapping_IsActive, 0) = 1
        ORDER BY dlm.Practice_Id DESC
      ) AS PracticeName,
      COALESCE(
        NULLIF(info.PriSpec, ''),
        NULLIF(nrc.NpiTaxonomyDescription, ''),
        CASE
          WHEN LTRIM(RTRIM(ISNULL(d.Doctor_Type, ''))) LIKE '%[^0-9]%'
            AND LEN(LTRIM(RTRIM(ISNULL(d.Doctor_Type, '')))) > 3
          THEN NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_Type, ''))), '')
          ELSE NULL
        END
      ) AS BackendSpecialty,
      CASE
        WHEN UPPER(COALESCE(NULLIF(info.PriSpec, ''), NULLIF(nrc.NpiTaxonomyDescription, ''), d.Doctor_Type)) LIKE '%PRIMARY%'
          OR UPPER(COALESCE(NULLIF(info.PriSpec, ''), NULLIF(nrc.NpiTaxonomyDescription, ''), d.Doctor_Type)) LIKE '%FAMILY%'
          OR UPPER(COALESCE(NULLIF(info.PriSpec, ''), NULLIF(nrc.NpiTaxonomyDescription, ''), d.Doctor_Type)) LIKE '%INTERNAL%' THEN 'Primary care'
        WHEN LTRIM(RTRIM(ISNULL(info.PriSpec, ''))) <> ''
          OR LTRIM(RTRIM(ISNULL(nrc.NpiTaxonomyDescription, ''))) <> '' THEN 'Specialist'
        ELSE 'Other'
      END AS BackendDoctorCategory,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
      LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
      LTRIM(RTRIM(ISNULL(d.Doctor_Phone, d.Doctor_MobileNo))) AS Phone,
      ${hasFax ? "LTRIM(RTRIM(ISNULL(d.Doctor_Fax, '')))" : "CAST(NULL AS NVARCHAR(50))"} AS Fax,
      LTRIM(RTRIM(ISNULL(d.Doctor_LIC, ''))) AS LicenseNumber,
      nrc.NpiTaxonomyCode,
      nrc.NpiIsPrimaryTaxonomy,
      nrc.NpiTaxonomyDescription,
      info.TaxonomyCode AS BackendTaxonomyCode,
      info.IsPrimaryTaxonomy AS BackendIsPrimaryTaxonomy,
      info.TaxonomyDescription AS BackendTaxonomyDescription,
      CAST(NULL AS NVARCHAR(80)) AS MarketNumber,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS GeographyLabel,
      ${latitudeExpr} AS Latitude,
      ${longitudeExpr} AS Longitude
    FROM dbo.Master_Doctor d
    ${infoApply}
    ${npiApply}
    WHERE ${activeOnly ? "LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'" : '1 = 1'}
      ${cityFilterPredicate}
      ${doctorTypePredicate}
    ORDER BY d.Doctor_LastName, d.Doctor_FirstName
  `);

  const targets = result.recordset.map((row: any) => {
    const derived = deriveCoordinatesFromAddress(row.AddressCity, row.AddressState, row.AddressZip);
    const rawLat = numberOrNull(row.Latitude);
    const rawLng = numberOrNull(row.Longitude);
    const latitude = validCoordinate(rawLat) ? rawLat : (derived?.latitude ?? null);
    const longitude = validCoordinate(rawLng) ? rawLng : (derived?.longitude ?? null);
    return {
      targetType: row.TargetType,
      targetId: null,
      doctorId: row.DoctorId ?? null,
      npiNumber: clean(row.NpiNumber),
      targetName: clean(row.TargetName) || `Doctor ${row.DoctorId}`,
      practiceName: clean(row.PracticeName),
      backendSpecialty: clean(row.BackendSpecialty),
      backendDoctorCategory: clean(row.BackendDoctorCategory),
      npiTaxonomyCode: clean(row.NpiTaxonomyCode),
      npiTaxonomyDescription: clean(row.NpiTaxonomyDescription),
      npiIsPrimaryTaxonomy: row.NpiIsPrimaryTaxonomy === null || row.NpiIsPrimaryTaxonomy === undefined
        ? null
        : Boolean(row.NpiIsPrimaryTaxonomy),
      specialty: clean(row.BackendSpecialty),
      doctorCategory: clean(row.BackendDoctorCategory),
      addressStreet: clean(row.AddressStreet),
      addressCity: clean(row.AddressCity),
      addressState: clean(row.AddressState),
      addressZip: clean(row.AddressZip),
      phone: clean(row.Phone),
      fax: clean(row.Fax),
      licenseNumber: clean(row.LicenseNumber),
      taxonomyCode: clean(row.NpiTaxonomyCode) || clean(row.BackendTaxonomyCode),
      isPrimaryTaxonomy: row.NpiIsPrimaryTaxonomy === null || row.NpiIsPrimaryTaxonomy === undefined
        ? (row.BackendIsPrimaryTaxonomy === null || row.BackendIsPrimaryTaxonomy === undefined ? null : Boolean(row.BackendIsPrimaryTaxonomy))
        : Boolean(row.NpiIsPrimaryTaxonomy),
      taxonomyDescription: clean(row.NpiTaxonomyDescription) || clean(row.BackendTaxonomyDescription),
      marketNumber: clean(row.MarketNumber),
      geographyLabel: clean(row.GeographyLabel),
      latitude,
      longitude
    };
  });

  return fastPreview ? enrichDoctorTargetsFromNpi(targets) : targets;
}

async function enrichDoctorTargetsFromNpi(targets: TargetCandidate[]) {
  const npiValues = Array.from(new Set(targets.map((target) => clean(target.npiNumber)).filter(Boolean)));
  if (!npiValues.length || !(await hasTable('PharmacyFlyer_DoctorInfo')) || !(await hasColumn('PharmacyFlyer_DoctorInfo', 'NPI'))) {
    return targets;
  }

  const infoPriSpec = await hasColumn('PharmacyFlyer_DoctorInfo', 'pri-spec');
  const infoPriSpecUnderscore = await hasColumn('PharmacyFlyer_DoctorInfo', 'pri_spec');
  const infoPriSpecPascal = await hasColumn('PharmacyFlyer_DoctorInfo', 'PriSpec');
  const priSpecExpr = infoPriSpec
    ? "pdi.[pri-spec]"
    : infoPriSpecUnderscore
      ? "pdi.pri_spec"
      : infoPriSpecPascal
        ? "pdi.PriSpec"
        : null;
  if (!priSpecExpr) return targets;

  const pool = await getPool();
  const specialtyByNpi = new Map<string, string>();
  const batchSize = 500;
  for (let index = 0; index < npiValues.length; index += batchSize) {
    const batch = npiValues.slice(index, index + batchSize);
    const request = pool.request();
    const valuesSql = batch.map((npi, batchIndex) => {
      request.input(`Npi${batchIndex}`, sql.VarChar, npi);
      return `(@Npi${batchIndex})`;
    }).join(',');

    const result = await request.query(`
      WITH RequestedNpi (NPI) AS (SELECT value FROM (VALUES ${valuesSql}) v(value)),
      DoctorInfoByNpi AS (
        SELECT
          LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(20)))) AS NPI,
          LTRIM(RTRIM(ISNULL(${priSpecExpr}, ''))) AS PriSpec,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(20))))
            ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(${priSpecExpr}, ''))) <> '' THEN 0 ELSE 1 END
          ) AS NpiRank
        FROM dbo.PharmacyFlyer_DoctorInfo pdi WITH (NOLOCK)
        INNER JOIN RequestedNpi requested ON requested.NPI = LTRIM(RTRIM(CAST(pdi.NPI AS VARCHAR(20))))
      )
      SELECT NPI, PriSpec
      FROM DoctorInfoByNpi
      WHERE NpiRank = 1 AND PriSpec <> ''
    `);

    for (const row of result.recordset) {
      const npi = clean(row.NPI);
      const specialty = clean(row.PriSpec);
      if (npi && specialty) specialtyByNpi.set(npi, specialty);
    }
  }

  return targets.map((target) => {
    const specialty = specialtyByNpi.get(clean(target.npiNumber) || '');
    if (!specialty) return target;
    const category = /PRIMARY|FAMILY|INTERNAL/i.test(specialty) ? 'Primary care' : 'Specialist';
    return {
      ...target,
      backendSpecialty: specialty,
      specialty,
      backendDoctorCategory: category,
      doctorCategory: category
    };
  });
}

async function loadLocalDoctorTargets(query: any, limit = 500): Promise<TargetCandidate[]> {
  const pool = await getPool();
  const hasFax = await hasColumn('Master_Doctor', 'Doctor_Fax');
  const hasDoctorLatitude = await hasColumn('Master_Doctor', 'Doctor_Latitude');
  const hasDoctorLongitude = await hasColumn('Master_Doctor', 'Doctor_Longitude');
  const hasLatitude = await hasColumn('Master_Doctor', 'Latitude');
  const hasLongitude = await hasColumn('Master_Doctor', 'Longitude');
  const latitudeExpr = hasDoctorLatitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Latitude)' : hasLatitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Latitude)' : 'CAST(NULL AS DECIMAL(10,7))';
  const longitudeExpr = hasDoctorLongitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Longitude)' : hasLongitude ? 'TRY_CONVERT(DECIMAL(10,7), d.Longitude)' : 'CAST(NULL AS DECIMAL(10,7))';
  const activeOnly = String(query.activeOnly ?? 'false').toLowerCase() !== 'false';
  const cityFilter = clean(query.city || query.targetCity);
  const doctorTypeFilter = clean(query.doctorType || query.doctorCategory || query.specialty);

  const normalizedSql = (field: string) => `
    UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(${field}, ''))), '.', ''), ',', ''), '  ', ' '))
  `;
  const cityFilterPredicate = cityFilter
    ? `AND ${normalizedSql('d.Doctor_AddressCity')} LIKE '%' + ${normalizedSql('@CityFilter')} + '%'`
    : '';
  const doctorTypePredicate = doctorTypeFilter && normalizeForCompare(doctorTypeFilter) !== 'ANY'
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_Type, '')))) = UPPER(LTRIM(RTRIM(@DoctorTypeFilter)))`
    : '';
  const scanLimit = Math.min(Math.max(limit * 5, 500), 15000);

  const result = await pool.request()
    .input('CityFilter', sql.NVarChar, cityFilter)
    .input('DoctorTypeFilter', sql.NVarChar, doctorTypeFilter)
    .query(`
      SELECT TOP ${scanLimit}
        CAST('Doctor' AS NVARCHAR(30)) AS TargetType,
        CAST(NULL AS BIGINT) AS TargetId,
        d.ID AS DoctorId,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS TargetName,
        (
          SELECT TOP 1 LTRIM(RTRIM(ISNULL(mp.Practice_Name, '')))
          FROM dbo.Doctor_Location_Mapping dlm
          INNER JOIN dbo.Master_Practice mp ON mp.ID = dlm.Practice_Id
          WHERE dlm.Doctor_No = d.Doctor_NO
            AND ISNULL(dlm.Mapping_IsActive, 0) = 1
          ORDER BY dlm.Practice_Id DESC
        ) AS PracticeName,
        LTRIM(RTRIM(ISNULL(d.Doctor_Type, ''))) AS DoctorTypeCode,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
        LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
        LTRIM(RTRIM(ISNULL(d.Doctor_Phone, d.Doctor_MobileNo))) AS Phone,
        ${hasFax ? "LTRIM(RTRIM(ISNULL(d.Doctor_Fax, '')))" : "CAST(NULL AS NVARCHAR(50))"} AS Fax,
        LTRIM(RTRIM(ISNULL(d.Doctor_LIC, ''))) AS LicenseNumber,
        CAST(NULL AS NVARCHAR(80)) AS MarketNumber,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS GeographyLabel,
        ${latitudeExpr} AS Latitude,
        ${longitudeExpr} AS Longitude
      FROM dbo.Master_Doctor d
      WHERE ${activeOnly ? "LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'" : '1 = 1'}
        ${cityFilterPredicate}
        ${doctorTypePredicate}
      ORDER BY d.Doctor_LastName, d.Doctor_FirstName
    `);

  return result.recordset.map((row: any) => {
    const rawLat = numberOrNull(row.Latitude);
    const rawLng = numberOrNull(row.Longitude);
    const derived = deriveCoordinatesFromAddress(row.AddressCity, row.AddressState, row.AddressZip);
    const latitude = validCoordinate(rawLat) ? rawLat : (validCoordinate(derived?.latitude ?? null) ? derived!.latitude : null);
    const longitude = validCoordinate(rawLng) ? rawLng : (validCoordinate(derived?.longitude ?? null) ? derived!.longitude : null);
    const doctorTypeCode = clean(row.DoctorTypeCode);
    const specialty = doctorTypeCode ? `${doctorTypeCode} - ${localDoctorTypeLabel(doctorTypeCode)}` : null;
    return {
      targetType: row.TargetType,
      targetId: null,
      doctorId: row.DoctorId ?? null,
      npiNumber: null,
      targetName: clean(row.TargetName) || `Doctor ${row.DoctorId}`,
      practiceName: clean(row.PracticeName),
      backendSpecialty: specialty,
      backendDoctorCategory: specialty,
      npiTaxonomyCode: null,
      npiTaxonomyDescription: null,
      npiIsPrimaryTaxonomy: null,
      specialty,
      doctorCategory: specialty,
      addressStreet: clean(row.AddressStreet),
      addressCity: clean(row.AddressCity),
      addressState: clean(row.AddressState),
      addressZip: clean(row.AddressZip),
      phone: clean(row.Phone),
      fax: clean(row.Fax),
      licenseNumber: clean(row.LicenseNumber),
      taxonomyCode: null,
      isPrimaryTaxonomy: null,
      taxonomyDescription: null,
      marketNumber: clean(row.MarketNumber),
      geographyLabel: clean(row.GeographyLabel),
      latitude,
      longitude
    };
  });
}

async function loadPharmacyTargets(query: any, limit = 500): Promise<TargetCandidate[]> {
  if (!(await hasTable('PharmacyFlyer_Pharmacy'))) return [];
  const pool = await getPool();
  const hasMarket = await hasTable('PharmacyFlyer_Market');
  const marketJoin = hasMarket ? `
    LEFT JOIN dbo.PharmacyFlyer_Market m ON m.MarketId = p.MarketId
  ` : '';
  const marketNumberExpr = hasMarket ? `LTRIM(RTRIM(ISNULL(m.MarketNumber, '')))` : 'CAST(NULL AS NVARCHAR(80))';
  const result = await pool.request().query(`
    SELECT TOP ${Math.min(Math.max(limit * 2, 100), 2000)}
      p.PharmacyId,
      p.PharmacyName,
      p.Address1,
      p.City,
      p.State,
      p.Zip,
      p.Phone,
      p.Fax,
      p.Latitude,
      p.Longitude,
      ${marketNumberExpr} AS MarketNumber
    FROM dbo.PharmacyFlyer_Pharmacy p
    ${marketJoin}
    WHERE ISNULL(p.IsActive, 1) = 1
    ORDER BY p.PharmacyName
  `);

  return result.recordset.map((row: any) => {
    const derived = deriveCoordinatesFromAddress(row.City, row.State, row.Zip);
    return {
      targetType: 'Pharmacy',
      targetId: null,
      doctorId: null,
      npiNumber: null,
      targetName: clean(row.PharmacyName) || `Pharmacy ${row.PharmacyId}`,
      practiceName: null,
      backendSpecialty: null,
      backendDoctorCategory: null,
      npiTaxonomyCode: null,
      npiTaxonomyDescription: null,
      npiIsPrimaryTaxonomy: null,
      specialty: null,
      doctorCategory: null,
      addressStreet: clean(row.Address1),
      addressCity: clean(row.City),
      addressState: clean(row.State),
      addressZip: clean(row.Zip),
      phone: clean(row.Phone),
      fax: clean(row.Fax),
      licenseNumber: null,
      taxonomyCode: null,
      isPrimaryTaxonomy: null,
      taxonomyDescription: null,
      marketNumber: clean(row.MarketNumber),
      geographyLabel: clean(row.City),
      latitude: numberOrNull(row.Latitude) ?? derived?.latitude ?? null,
      longitude: numberOrNull(row.Longitude) ?? derived?.longitude ?? null
    };
  });
}

async function loadCustomTargets(query: any, limit = 500): Promise<TargetCandidate[]> {
  if (!(await hasTable('PharmacyFlyer_LocationTarget'))) return [];
  const pool = await getPool();
  const targetType = clean(query.targetType);
  const result = await pool.request()
    .input('TargetType', sql.NVarChar, targetType && normalizeForCompare(targetType) !== 'BOTH' ? targetType : null)
    .query(`
      SELECT TOP ${Math.min(Math.max(limit * 2, 100), 2000)}
        TargetId,
        TargetType,
        DoctorId,
        NpiNumber,
        TargetName,
        PracticeName,
        Specialty,
        DoctorCategory,
        PrimaryAddressStreet AS AddressStreet,
        PrimaryAddressCity AS AddressCity,
        PrimaryAddressState AS AddressState,
        PrimaryAddressZip AS AddressZip,
        Phone,
        Fax,
        LicenseNumber,
        TaxonomyCode,
        IsPrimaryTaxonomy,
        TaxonomyDescription,
        MarketNumber,
        GeographyLabel,
        Latitude,
        Longitude
      FROM dbo.PharmacyFlyer_LocationTarget
      WHERE IsActive = 1
        AND (@TargetType IS NULL OR TargetType = @TargetType)
      ORDER BY TargetName
    `);

  return result.recordset.map((row: any) => {
    const derived = deriveCoordinatesFromAddress(row.AddressCity, row.AddressState, row.AddressZip);
    return {
      targetType: clean(row.TargetType) || 'Other',
      targetId: numberOrNull(row.TargetId),
      doctorId: numberOrNull(row.DoctorId),
      npiNumber: clean(row.NpiNumber),
      targetName: clean(row.TargetName) || `Target ${row.TargetId}`,
      practiceName: clean(row.PracticeName),
      backendSpecialty: clean(row.Specialty),
      backendDoctorCategory: clean(row.DoctorCategory),
      npiTaxonomyCode: clean(row.TaxonomyCode),
      npiTaxonomyDescription: clean(row.TaxonomyDescription),
      npiIsPrimaryTaxonomy: row.IsPrimaryTaxonomy === null || row.IsPrimaryTaxonomy === undefined ? null : Boolean(row.IsPrimaryTaxonomy),
      specialty: clean(row.Specialty),
      doctorCategory: clean(row.DoctorCategory),
      addressStreet: clean(row.AddressStreet),
      addressCity: clean(row.AddressCity),
      addressState: clean(row.AddressState),
      addressZip: clean(row.AddressZip),
      phone: clean(row.Phone),
      fax: clean(row.Fax),
      licenseNumber: clean(row.LicenseNumber),
      taxonomyCode: clean(row.TaxonomyCode),
      isPrimaryTaxonomy: row.IsPrimaryTaxonomy === null || row.IsPrimaryTaxonomy === undefined ? null : Boolean(row.IsPrimaryTaxonomy),
      taxonomyDescription: clean(row.TaxonomyDescription),
      marketNumber: clean(row.MarketNumber),
      geographyLabel: clean(row.GeographyLabel),
      latitude: numberOrNull(row.Latitude) ?? derived?.latitude ?? null,
      longitude: numberOrNull(row.Longitude) ?? derived?.longitude ?? null
    };
  });
}


async function ensureWorkflowTables() {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.PharmacyFlyer_LocationTarget', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PharmacyFlyer_LocationTarget (
        TargetId BIGINT IDENTITY(1,1) PRIMARY KEY,
        TargetType NVARCHAR(30) NOT NULL,
        DoctorId INT NULL,
        NpiNumber NVARCHAR(50) NULL,
        TargetName NVARCHAR(250) NOT NULL,
        PracticeName NVARCHAR(250) NULL,
        Specialty NVARCHAR(250) NULL,
        DoctorCategory NVARCHAR(80) NULL,
        PrimaryAddressStreet NVARCHAR(300) NULL,
        PrimaryAddressCity NVARCHAR(100) NULL,
        PrimaryAddressState NVARCHAR(50) NULL,
        PrimaryAddressZip NVARCHAR(20) NULL,
        SecondaryAddressStreet NVARCHAR(300) NULL,
        SecondaryAddressCity NVARCHAR(100) NULL,
        SecondaryAddressState NVARCHAR(50) NULL,
        SecondaryAddressZip NVARCHAR(20) NULL,
        Phone NVARCHAR(50) NULL,
        Fax NVARCHAR(50) NULL,
        LicenseNumber NVARCHAR(80) NULL,
        TaxonomyCode NVARCHAR(80) NULL,
        IsPrimaryTaxonomy BIT NULL,
        TaxonomyDescription NVARCHAR(500) NULL,
        MarketNumber NVARCHAR(80) NULL,
        GeographyLabel NVARCHAR(200) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_LocationTarget_IsActive DEFAULT 1,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_LocationTarget_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedBy INT NULL,
        LastModifiedDate DATETIME2 NULL
      );
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PharmacyFlyer_TargetingRule (
        ConfigId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        ConfigName NVARCHAR(200) NOT NULL,
        TargetType NVARCHAR(30) NOT NULL,
        PharmacyNumber NVARCHAR(80) NULL,
        SpecialtySource NVARCHAR(50) NULL,
        DoctorType NVARCHAR(80) NULL,
        Specialty NVARCHAR(250) NULL,
        CustomSpecialty NVARCHAR(250) NULL,
        DoctorCategory NVARCHAR(80) NULL,
        NpiNumber NVARCHAR(50) NULL,
        TaxonomyCode NVARCHAR(80) NULL,
        TaxonomyDescription NVARCHAR(500) NULL,
        RequirePrimaryTaxonomy BIT NULL,
        TargetCity NVARCHAR(100) NULL,
        TargetState NVARCHAR(50) NULL,
        MarketNumber NVARCHAR(80) NULL,
        CenterLatitude DECIMAL(10,7) NULL,
        CenterLongitude DECIMAL(10,7) NULL,
        RadiusMiles DECIMAL(8,2) NULL,
        VisitFrequencyDays INT NULL,
        CheckInRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_CheckInRequired DEFAULT 1,
        ProofRequired BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_ProofRequired DEFAULT 1,
        IsActive BIT NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_IsActive DEFAULT 1,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_TargetingRule_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedBy INT NULL,
        LastModifiedDate DATETIME2 NULL,
        CONSTRAINT FK_PharmacyFlyer_TargetingRule_Campaign
          FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId)
      );
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PharmacyFlyer_Assignment (
        AssignmentId BIGINT IDENTITY(1,1) PRIMARY KEY,
        CampaignId INT NOT NULL,
        ConfigId BIGINT NULL,
        TargetId BIGINT NULL,
        DoctorId INT NULL,
        StaffUserId INT NULL,
        TargetType NVARCHAR(30) NOT NULL,
        TargetName NVARCHAR(250) NOT NULL,
        PracticeName NVARCHAR(250) NULL,
        Specialty NVARCHAR(250) NULL,
        NpiNumber NVARCHAR(50) NULL,
        AddressStreet NVARCHAR(300) NULL,
        AddressCity NVARCHAR(100) NULL,
        AddressState NVARCHAR(50) NULL,
        AddressZip NVARCHAR(20) NULL,
        Phone NVARCHAR(50) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_ApprovalStatus DEFAULT 'suggested',
        ApprovedBy INT NULL,
        ApprovedAt DATETIME2 NULL,
        RejectedBy INT NULL,
        RejectedAt DATETIME2 NULL,
        ScheduledDate DATE NULL,
        VisitFrequencyDays INT NULL,
        LastVisitDate DATE NULL,
        NextVisitDueDate DATE NULL,
        RouteId BIGINT NULL,
        RouteStopOrder INT NULL,
        AssignmentStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_AssignmentStatus DEFAULT 'suggested',
        CheckInStatus NVARCHAR(30) NULL,
        CheckedInAt DATETIME2 NULL,
        CheckInLatitude DECIMAL(10,7) NULL,
        CheckInLongitude DECIMAL(10,7) NULL,
        CheckInDistanceMiles DECIMAL(8,2) NULL,
        CompletedAt DATETIME2 NULL,
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Assignment_CreatedDate DEFAULT SYSDATETIME(),
        LastModifiedDate DATETIME2 NULL,
        CONSTRAINT FK_PharmacyFlyer_Assignment_Campaign
          FOREIGN KEY (CampaignId) REFERENCES dbo.PharmacyFlyer_Campaign(CampaignId),
        CONSTRAINT FK_PharmacyFlyer_Assignment_Config
          FOREIGN KEY (ConfigId) REFERENCES dbo.PharmacyFlyer_TargetingRule(ConfigId),
        CONSTRAINT FK_PharmacyFlyer_Assignment_Target
          FOREIGN KEY (TargetId) REFERENCES dbo.PharmacyFlyer_LocationTarget(TargetId)
      );
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PharmacyFlyer_Route (
        RouteId BIGINT IDENTITY(1,1) PRIMARY KEY,
        RouteName NVARCHAR(200) NOT NULL,
        StaffUserId INT NOT NULL,
        RouteDate DATE NOT NULL,
        StartAddress NVARCHAR(300) NULL,
        StartLatitude DECIMAL(10,7) NULL,
        StartLongitude DECIMAL(10,7) NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_Status DEFAULT 'planned',
        CreatedBy INT NULL,
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_Route_CreatedDate DEFAULT SYSDATETIME()
      );
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PharmacyFlyer_RouteStop (
        RouteStopId BIGINT IDENTITY(1,1) PRIMARY KEY,
        RouteId BIGINT NOT NULL,
        AssignmentId BIGINT NOT NULL,
        StopOrder INT NOT NULL,
        TargetName NVARCHAR(250) NOT NULL,
        AddressStreet NVARCHAR(300) NULL,
        AddressCity NVARCHAR(100) NULL,
        AddressState NVARCHAR(50) NULL,
        AddressZip NVARCHAR(20) NULL,
        Latitude DECIMAL(10,7) NULL,
        Longitude DECIMAL(10,7) NULL,
        EstimatedDistanceFromPreviousMiles DECIMAL(8,2) NULL,
        StopStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_StopStatus DEFAULT 'pending',
        CreatedDate DATETIME2 NOT NULL CONSTRAINT DF_PharmacyFlyer_RouteStop_CreatedDate DEFAULT SYSDATETIME(),
        CONSTRAINT FK_PharmacyFlyer_RouteStop_Route
          FOREIGN KEY (RouteId) REFERENCES dbo.PharmacyFlyer_Route(RouteId),
        CONSTRAINT FK_PharmacyFlyer_RouteStop_Assignment
          FOREIGN KEY (AssignmentId) REFERENCES dbo.PharmacyFlyer_Assignment(AssignmentId)
      );
    END;
  `);
}

async function ensureWorkflowColumns() {
  await ensureWorkflowTables();
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.PharmacyFlyer_Campaign', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerTitle') IS NULL ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerTitle NVARCHAR(200) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'FlyerFileUrl') IS NULL ALTER TABLE dbo.PharmacyFlyer_Campaign ADD FlyerFileUrl NVARCHAR(1000) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'TargetAudience') IS NULL ALTER TABLE dbo.PharmacyFlyer_Campaign ADD TargetAudience NVARCHAR(200) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Campaign', 'DefaultVisitFrequencyDays') IS NULL ALTER TABLE dbo.PharmacyFlyer_Campaign ADD DefaultVisitFrequencyDays INT NULL;
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_TargetingRule', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'Geography') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD Geography NVARCHAR(120) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'SpecialtySource') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD SpecialtySource NVARCHAR(50) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'DoctorType') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD DoctorType NVARCHAR(80) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'TaxonomyCode') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD TaxonomyCode NVARCHAR(80) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'TaxonomyDescription') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD TaxonomyDescription NVARCHAR(500) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_TargetingRule', 'RequirePrimaryTaxonomy') IS NULL ALTER TABLE dbo.PharmacyFlyer_TargetingRule ADD RequirePrimaryTaxonomy BIT NULL;

      EXEC('UPDATE dbo.PharmacyFlyer_TargetingRule
            SET SpecialtySource = ISNULL(SpecialtySource, ''backend''),
                DoctorType = ISNULL(DoctorType, COALESCE(DoctorCategory, ''Any'')),
                Geography = ISNULL(Geography, TargetCity)');
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_Assignment', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CampaignId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CampaignId INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ConfigId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ConfigId BIGINT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetId BIGINT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'DoctorId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD DoctorId INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'StaffUserId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD StaffUserId INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetType') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetType NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'TargetName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD TargetName NVARCHAR(250) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'PracticeName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD PracticeName NVARCHAR(250) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Specialty') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Specialty NVARCHAR(250) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'NpiNumber') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD NpiNumber NVARCHAR(50) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressStreet NVARCHAR(300) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressCity NVARCHAR(100) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressState NVARCHAR(50) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AddressZip NVARCHAR(20) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Phone') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Phone NVARCHAR(50) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Latitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Latitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'Longitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD Longitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovalStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovalStatus NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovedBy INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ApprovedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ApprovedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RejectedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RejectedBy INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RejectedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RejectedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'AssignmentStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD AssignmentStatus NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'ScheduledDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD ScheduledDate DATE NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'VisitFrequencyDays') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD VisitFrequencyDays INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'LastVisitDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD LastVisitDate DATE NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'NextVisitDueDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD NextVisitDueDate DATE NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RouteId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RouteId BIGINT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'RouteStopOrder') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD RouteStopOrder INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInStatus NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckedInAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckedInAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInLatitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInLatitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInLongitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInLongitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CheckInDistanceMiles') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CheckInDistanceMiles DECIMAL(8,2) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CompletedAt') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CompletedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CreatedBy INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD CreatedDate DATETIME2 NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Assignment', 'LastModifiedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Assignment ADD LastModifiedDate DATETIME2 NULL;

      EXEC('UPDATE dbo.PharmacyFlyer_Assignment
            SET ApprovalStatus = ISNULL(ApprovalStatus, ''suggested''),
                AssignmentStatus = ISNULL(AssignmentStatus, ''suggested''),
                TargetType = ISNULL(TargetType, ''Doctor''),
                TargetName = ISNULL(TargetName, ''Unspecified target''),
                CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_Route', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'RouteName') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD RouteName NVARCHAR(200) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StaffUserId') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StaffUserId INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'RouteDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD RouteDate DATE NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartAddress') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartAddress NVARCHAR(300) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartLatitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartLatitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'StartLongitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD StartLongitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'Status') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD Status NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'CreatedBy') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD CreatedBy INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_Route', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_Route ADD CreatedDate DATETIME2 NULL;

      EXEC('UPDATE dbo.PharmacyFlyer_Route
            SET RouteName = ISNULL(RouteName, ''Route''),
                Status = ISNULL(Status, ''planned''),
                CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
    END;

    IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'RouteId') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD RouteId BIGINT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AssignmentId') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AssignmentId BIGINT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'StopOrder') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD StopOrder INT NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'TargetName') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD TargetName NVARCHAR(250) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressStreet') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressStreet NVARCHAR(300) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressCity') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressCity NVARCHAR(100) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressState') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressState NVARCHAR(50) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'AddressZip') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD AddressZip NVARCHAR(20) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'Latitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD Latitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'Longitude') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD Longitude DECIMAL(10,7) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'EstimatedDistanceFromPreviousMiles') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD EstimatedDistanceFromPreviousMiles DECIMAL(8,2) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'StopStatus') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD StopStatus NVARCHAR(30) NULL;
      IF COL_LENGTH('dbo.PharmacyFlyer_RouteStop', 'CreatedDate') IS NULL ALTER TABLE dbo.PharmacyFlyer_RouteStop ADD CreatedDate DATETIME2 NULL;

      EXEC('UPDATE dbo.PharmacyFlyer_RouteStop
            SET TargetName = ISNULL(TargetName, ''Unspecified stop''),
                StopStatus = ISNULL(StopStatus, ''pending''),
                CreatedDate = ISNULL(CreatedDate, SYSDATETIME())');
    END;
  `);
}

async function getTargets(query: any, limit = 500) {
  const requestedType = normalizeForCompare(query.targetType || 'Both');
  const shouldLoadDoctors = requestedType === 'BOTH' || requestedType === 'DOCTOR';
  const shouldLoadPharmacies = requestedType === 'BOTH' || requestedType === 'PHARMACY';
  const localDoctorOnly = boolValue(query.localDoctorOnly, false);
  const shouldLoadCustom = !localDoctorOnly && (requestedType === 'BOTH' || requestedType === 'PHARMACY' || requestedType === 'OTHER' || requestedType === 'DOCTOR');
  const [doctorTargets, pharmacyTargets, customTargets] = await Promise.all([
    shouldLoadDoctors ? loadDoctorTargets(query, limit) : Promise.resolve([]),
    shouldLoadPharmacies ? loadPharmacyTargets(query, limit) : Promise.resolve([]),
    shouldLoadCustom ? loadCustomTargets(query, limit) : Promise.resolve([])
  ]);
  const deduped = new Map<string, TargetCandidate>();
  for (const target of [...doctorTargets, ...pharmacyTargets, ...customTargets]) {
    const key = `${target.targetType}:${target.doctorId || ''}:${target.targetId || ''}:${normalizeForCompare(target.npiNumber)}:${normalizeForCompare(target.targetName)}:${normalizeForCompare(target.addressZip)}`;
    if (!deduped.has(key)) deduped.set(key, target);
  }
  return applyTargetFilters(Array.from(deduped.values()), query).slice(0, limit);
}

async function getConfig(configId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ConfigId', sql.BigInt, configId)
    .query(`
      SELECT TOP 1
        r.*,
        c.CampaignName,
        c.Description,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        c.FlyerFileUrl,
        c.TargetAudience,
        c.DefaultVisitFrequencyDays
      FROM dbo.PharmacyFlyer_TargetingRule r
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = r.CampaignId
      WHERE r.ConfigId = @ConfigId
    `);
  return result.recordset[0];
}

function configToTargetQuery(config: any) {
  const doctorCenter = isDoctorSuggestionType(config.TargetType)
    ? doctorLocationFromCity(config.TargetCity)?.coordinates
    : null;
  const center = numberOrNull(config.CenterLatitude) !== null && numberOrNull(config.CenterLongitude) !== null
    ? { latitude: numberOrNull(config.CenterLatitude), longitude: numberOrNull(config.CenterLongitude) }
    : doctorCenter || cityCoordinate(config.TargetCity, config.TargetState);
  return {
    campaignId: config.CampaignId,
    targetType: config.TargetType || 'Both',
    specialtySource: config.SpecialtySource || 'backend',
    doctorType: config.DoctorType || config.DoctorCategory || 'Any',
    specialty: config.Specialty || config.CustomSpecialty,
    customSpecialty: config.CustomSpecialty,
    doctorCategory: config.DoctorCategory,
    taxonomyCode: config.TaxonomyCode,
    taxonomyDescription: config.TaxonomyDescription,
    requirePrimaryTaxonomy: config.RequirePrimaryTaxonomy,
    npi: config.NpiNumber,
    targetCity: config.Geography || config.TargetCity,
    city: config.Geography || config.TargetCity,
    targetState: config.TargetState,
    state: config.TargetState,
    marketNumber: config.MarketNumber,
    latitude: center?.latitude,
    longitude: center?.longitude,
    radiusMiles: config.RadiusMiles
  };
}

function requestToTargetQuery(payload: any) {
  const targetType = clean(payload?.targetType) || 'Doctor';
  const city = clean(payload?.targetCity || payload?.city || payload?.geography);
  const state = clean(payload?.targetState || payload?.state) || 'FL';
  const center = numberOrNull(payload?.centerLatitude) !== null && numberOrNull(payload?.centerLongitude) !== null
    ? { latitude: numberOrNull(payload?.centerLatitude), longitude: numberOrNull(payload?.centerLongitude) }
    : cityCoordinate(city, state);
  return {
    campaignId: numberOrNull(payload?.campaignId),
    targetType,
    localDoctorOnly: boolValue(payload?.localDoctorOnly, false),
    doctorType: clean(payload?.doctorType || payload?.doctorCategory),
    specialtySource: clean(payload?.specialtySource) || 'backend',
    specialty: clean(payload?.specialty),
    customSpecialty: clean(payload?.customSpecialty),
    taxonomyCode: clean(payload?.taxonomyCode),
    taxonomyDescription: clean(payload?.taxonomyDescription),
    requirePrimaryTaxonomy: boolValue(payload?.requirePrimaryTaxonomy, false),
    npi: clean(payload?.npi || payload?.npiNumber),
    city,
    state,
    marketNumber: clean(payload?.marketNumber || payload?.market),
    latitude: center?.latitude,
    longitude: center?.longitude,
    radiusMiles: numberOrNull(payload?.radiusMiles)
  };
}

function withMatchReason(targets: any[], query: any) {
  const specialtySource = normalizeForCompare(query?.specialtySource || 'BACKEND');
  return targets.map((target) => {
    const normalizedType = normalizeForCompare(target.targetType);
    if (normalizedType === 'PHARMACY') {
      return { ...target, matchReason: 'Pharmacy matched by geography/radius/market filters.' };
    }
    if (specialtySource === 'NPI_REGISTRY') {
      return { ...target, matchReason: 'Doctor matched using NPI taxonomy filters.' };
    }
    return { ...target, matchReason: 'Doctor matched using backend specialty filters.' };
  });
}

function sortStopsByNearest(start: Coordinates | null, stops: any[]) {
  if (!start || !stops.length) return stops.map((stop, index) => ({ ...stop, RouteStopOrder: index + 1, EstimatedDistanceFromPreviousMiles: null }));

  const remaining = stops.map((stop) => ({ ...stop }));
  const ordered: any[] = [];
  let current = start;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < remaining.length; i += 1) {
      const lat = numberOrNull(remaining[i].Latitude);
      const lng = numberOrNull(remaining[i].Longitude);
      if (lat === null || lng === null) continue;
      const distance = milesBetween(current, { latitude: lat, longitude: lng });
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    const lat = numberOrNull(next.Latitude);
    const lng = numberOrNull(next.Longitude);
    ordered.push({
      ...next,
      RouteStopOrder: ordered.length + 1,
      EstimatedDistanceFromPreviousMiles: bestDistance === Number.MAX_SAFE_INTEGER ? null : Number(bestDistance.toFixed(2))
    });
    if (lat !== null && lng !== null) current = { latitude: lat, longitude: lng };
  }
  return ordered;
}

function withDerivedWorkflowCoordinates<T extends Record<string, any>>(row: T): T {
  const latitude = numberOrNull(row.Latitude);
  const longitude = numberOrNull(row.Longitude);

  if (latitude !== null && longitude !== null) {
    return {
      ...row,
      Latitude: latitude,
      Longitude: longitude,
      MissingTargetGps: false,
      TargetGpsSource: row.TargetGpsSource || 'stored'
    };
  }

  const derived = deriveCoordinatesFromAddress(row.AddressCity, row.AddressState, row.AddressZip);

  return {
    ...row,
    Latitude: latitude ?? derived?.latitude ?? null,
    Longitude: longitude ?? derived?.longitude ?? null,
    MissingTargetGps: !derived,
    TargetGpsSource: derived ? 'derived-city-zip' : 'missing'
  };
}

clientWorkflowRoutes.get('/coverage', (_req, res) => {
  res.json({ promptCount: CLIENT_PROMPT_COVERAGE.length, prompts: CLIENT_PROMPT_COVERAGE });
});

clientWorkflowRoutes.get('/status', async (_req, res) => {
  await ensureWorkflowColumns();
  const pool = await getPool();
  const tables = {
    assignment: await hasTable('PharmacyFlyer_Assignment'),
    targetingRule: await hasTable('PharmacyFlyer_TargetingRule'),
    route: await hasTable('PharmacyFlyer_Route')
  };
  const counts = tables.assignment
    ? await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Campaign WHERE IsActive = 1) AS ActiveCampaigns,
          (SELECT COUNT(*) FROM dbo.Master_User WHERE ISNULL(User_IsActive, 0) = 1) AS ActiveStaff,
          (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Assignment WHERE ApprovalStatus = 'suggested') AS SuggestedCount,
          (SELECT COUNT(*) FROM dbo.PharmacyFlyer_Assignment WHERE ApprovalStatus = 'approved') AS ApprovedCount
      `)
    : { recordset: [{ ActiveCampaigns: 0, ActiveStaff: 0, SuggestedCount: 0, ApprovedCount: 0 }] };
  res.json({ ready: tables.assignment && tables.targetingRule, tables, ...counts.recordset[0] });
});


clientWorkflowRoutes.use(async (_req, _res, next) => {
  try {
    await ensureWorkflowColumns();
    next();
  } catch (error) {
    next(error);
  }
});

clientWorkflowRoutes.get('/staff', async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ID, User_Id, User_FirstName, User_LastName, User_Email, User_Phone
    FROM dbo.Master_User
    WHERE ISNULL(User_IsActive, 0) = 1
    ORDER BY User_FirstName, User_LastName, User_Id
  `);
  res.json(result.recordset);
});

clientWorkflowRoutes.get('/doctor-specialties', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        LTRIM(RTRIM(ISNULL(Doctor_Type, ''))) AS code,
        COUNT(*) AS count
      FROM dbo.Master_Doctor WITH (NOLOCK)
      WHERE NULLIF(LTRIM(RTRIM(ISNULL(Doctor_Type, ''))), '') IS NOT NULL
        AND LTRIM(RTRIM(ISNULL(Doctor_IsActive, ' '))) <> 'N'
      GROUP BY LTRIM(RTRIM(ISNULL(Doctor_Type, '')))
      ORDER BY COUNT(*) DESC, LTRIM(RTRIM(ISNULL(Doctor_Type, '')))
    `);

    const doctorTypes = result.recordset.map((row: any) => {
      const code = clean(row.code) || '';
      const displayName = localDoctorTypeLabel(code) || `Doctor type ${code}`;
      return {
        code,
        value: code,
        displayName,
        label: `${code} - ${displayName}`,
        count: Number(row.count || 0)
      };
    });

    res.json({
      doctorTypes,
      specialties: doctorTypes.map((item: any) => item.label)
    });
  } catch (error) {
    console.error('Doctor specialties lookup failed:', error);
    res.json({ doctorTypes: [], specialties: [] });
  }
});

clientWorkflowRoutes.get('/targets', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const targets = await getTargets(req.query, limit);
  res.json(targets);
});

clientWorkflowRoutes.post('/targets', async (req, res) => {
  const pool = await getPool();
  const center = numberOrNull(req.body?.latitude) !== null && numberOrNull(req.body?.longitude) !== null
    ? { latitude: numberOrNull(req.body.latitude), longitude: numberOrNull(req.body.longitude) }
    : deriveCoordinatesFromAddress(req.body?.addressCity || req.body?.primaryAddressCity, req.body?.addressState || req.body?.primaryAddressState, req.body?.addressZip || req.body?.primaryAddressZip);

  const result = await pool.request()
    .input('TargetType', sql.NVarChar, clean(req.body?.targetType) || 'Pharmacy')
    .input('DoctorId', sql.Int, numberOrNull(req.body?.doctorId))
    .input('NpiNumber', sql.NVarChar, clean(req.body?.npiNumber))
    .input('TargetName', sql.NVarChar, clean(req.body?.targetName) || clean(req.body?.pharmacyName) || 'New target')
    .input('PracticeName', sql.NVarChar, clean(req.body?.practiceName))
    .input('Specialty', sql.NVarChar, clean(req.body?.specialty))
    .input('DoctorCategory', sql.NVarChar, clean(req.body?.doctorCategory))
    .input('PrimaryAddressStreet', sql.NVarChar, clean(req.body?.addressStreet || req.body?.primaryAddressStreet))
    .input('PrimaryAddressCity', sql.NVarChar, clean(req.body?.addressCity || req.body?.primaryAddressCity))
    .input('PrimaryAddressState', sql.NVarChar, clean(req.body?.addressState || req.body?.primaryAddressState))
    .input('PrimaryAddressZip', sql.NVarChar, clean(req.body?.addressZip || req.body?.primaryAddressZip))
    .input('SecondaryAddressStreet', sql.NVarChar, clean(req.body?.secondaryAddressStreet))
    .input('SecondaryAddressCity', sql.NVarChar, clean(req.body?.secondaryAddressCity))
    .input('SecondaryAddressState', sql.NVarChar, clean(req.body?.secondaryAddressState))
    .input('SecondaryAddressZip', sql.NVarChar, clean(req.body?.secondaryAddressZip))
    .input('Phone', sql.NVarChar, clean(req.body?.phone))
    .input('Fax', sql.NVarChar, clean(req.body?.fax))
    .input('LicenseNumber', sql.NVarChar, clean(req.body?.licenseNumber))
    .input('TaxonomyCode', sql.NVarChar, clean(req.body?.taxonomyCode))
    .input('IsPrimaryTaxonomy', sql.Bit, req.body?.isPrimaryTaxonomy === undefined ? null : boolValue(req.body?.isPrimaryTaxonomy, false))
    .input('TaxonomyDescription', sql.NVarChar, clean(req.body?.taxonomyDescription))
    .input('MarketNumber', sql.NVarChar, clean(req.body?.marketNumber))
    .input('GeographyLabel', sql.NVarChar, clean(req.body?.geographyLabel))
    .input('Latitude', sql.Decimal(10, 7), center?.latitude ?? null)
    .input('Longitude', sql.Decimal(10, 7), center?.longitude ?? null)
    .input('CreatedBy', sql.Int, req.user?.userId || null)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_LocationTarget (
        TargetType, DoctorId, NpiNumber, TargetName, PracticeName, Specialty, DoctorCategory,
        PrimaryAddressStreet, PrimaryAddressCity, PrimaryAddressState, PrimaryAddressZip,
        SecondaryAddressStreet, SecondaryAddressCity, SecondaryAddressState, SecondaryAddressZip,
        Phone, Fax, LicenseNumber, TaxonomyCode, IsPrimaryTaxonomy, TaxonomyDescription,
        MarketNumber, GeographyLabel, Latitude, Longitude, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        @TargetType, @DoctorId, @NpiNumber, @TargetName, @PracticeName, @Specialty, @DoctorCategory,
        @PrimaryAddressStreet, @PrimaryAddressCity, @PrimaryAddressState, @PrimaryAddressZip,
        @SecondaryAddressStreet, @SecondaryAddressCity, @SecondaryAddressState, @SecondaryAddressZip,
        @Phone, @Fax, @LicenseNumber, @TaxonomyCode, @IsPrimaryTaxonomy, @TaxonomyDescription,
        @MarketNumber, @GeographyLabel, @Latitude, @Longitude, @CreatedBy
      )
    `);
  res.status(201).json(result.recordset[0]);
});

clientWorkflowRoutes.get('/campaign-configs', async (req, res) => {
  const pool = await getPool();
  const campaignId = numberOrNull(req.query.campaignId);
  const includeInactive = boolValue(req.query.includeInactive, false);
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('IncludeInactive', sql.Bit, includeInactive)
    .query(`
      SELECT TOP 500
        r.*,
        c.CampaignName,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        c.FlyerFileUrl,
        c.TargetAudience
      FROM dbo.PharmacyFlyer_TargetingRule r
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = r.CampaignId
      WHERE (@CampaignId IS NULL OR r.CampaignId = @CampaignId)
        AND (@IncludeInactive = 1 OR ISNULL(r.IsActive, 1) = 1)
      ORDER BY ISNULL(r.LastModifiedDate, r.CreatedDate) DESC, r.ConfigId DESC
    `);
  res.json(result.recordset);
});

clientWorkflowRoutes.post('/campaign-configs', async (req, res) => {
  const campaignId = numberOrNull(req.body?.campaignId);
  if (!campaignId) return res.status(400).json({ message: 'campaignId is required.' });
  const pool = await getPool();
  const campaignInfo = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .query(`
      SELECT TOP 1 CampaignId, FlyerTitle, CampaignName
      FROM dbo.PharmacyFlyer_Campaign
      WHERE CampaignId = @CampaignId
    `);
  const campaign = campaignInfo.recordset[0];
  if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

  const targetType = clean(req.body?.targetType) || 'Doctor';
  const normalizedTargetType = normalizeForCompare(targetType);
  const doctorFiltersEnabled = normalizedTargetType === 'DOCTOR' || normalizedTargetType === 'BOTH';
  const specialtySource = doctorFiltersEnabled ? (clean(req.body?.specialtySource) || 'backend') : null;
  const doctorType = doctorFiltersEnabled ? (clean(req.body?.doctorType || req.body?.doctorCategory) || 'Any') : null;
  const targetCity = clean(req.body?.targetCity || req.body?.city || req.body?.geography);
  const targetState = clean(req.body?.targetState) || 'FL';
  if (isDoctorSuggestionType(targetType)) {
    const allowedLocations = targetCity ? doctorSuggestionLocationsForRequest(targetCity) : ALLOWED_DOCTOR_SUGGESTION_LOCATIONS;
    if (!allowedLocations.length || normalizeForCompare(targetState) !== 'FL') {
      return res.status(400).json({
        message: 'Doctor campaign configs are restricted to Pinellas Park, FL and St. Petersburg, FL.',
        allowedLocations: ALLOWED_DOCTOR_SUGGESTION_LOCATIONS
      });
    }
  }

  const centerFromCity = isDoctorSuggestionType(targetType)
    ? doctorLocationFromCity(targetCity)?.coordinates || cityCoordinate(targetCity, targetState)
    : cityCoordinate(targetCity, targetState);
  const centerLatitude = numberOrNull(req.body?.centerLatitude ?? req.body?.latitude) ?? centerFromCity?.latitude ?? null;
  const centerLongitude = numberOrNull(req.body?.centerLongitude ?? req.body?.longitude) ?? centerFromCity?.longitude ?? null;
  const visitFrequencyDays = frequencyDaysFromInput(req.body?.visitFrequencyType, req.body?.visitFrequencyDays);
  const configName = clean(req.body?.configName) || buildConfigDisplayName({
    flyerTitle: campaign.FlyerTitle || campaign.CampaignName,
    targetType,
    specialtySource,
    doctorType,
    specialty: req.body?.specialty,
    customSpecialty: req.body?.customSpecialty,
    taxonomyDescription: req.body?.taxonomyDescription,
    geography: clean(req.body?.geography) || targetCity,
    radiusMiles: req.body?.radiusMiles,
    visitFrequencyType: req.body?.visitFrequencyType,
    visitFrequencyDays
  });
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('ConfigName', sql.NVarChar, configName)
    .input('TargetType', sql.NVarChar, targetType)
    .input('Geography', sql.NVarChar, clean(req.body?.geography) || targetCity)
    .input('PharmacyNumber', sql.NVarChar, clean(req.body?.pharmacyNumber))
    .input('SpecialtySource', sql.NVarChar, specialtySource)
    .input('DoctorType', sql.NVarChar, doctorType)
    .input('Specialty', sql.NVarChar, doctorFiltersEnabled ? clean(req.body?.specialty) : null)
    .input('CustomSpecialty', sql.NVarChar, doctorFiltersEnabled ? clean(req.body?.customSpecialty) : null)
    .input('DoctorCategory', sql.NVarChar, doctorType)
    .input('NpiNumber', sql.NVarChar, clean(req.body?.npiNumber))
    .input('TaxonomyCode', sql.NVarChar, doctorFiltersEnabled ? clean(req.body?.taxonomyCode) : null)
    .input('TaxonomyDescription', sql.NVarChar, doctorFiltersEnabled ? clean(req.body?.taxonomyDescription) : null)
    .input('RequirePrimaryTaxonomy', sql.Bit, doctorFiltersEnabled ? boolValue(req.body?.requirePrimaryTaxonomy, false) : null)
    .input('TargetCity', sql.NVarChar, targetCity)
    .input('TargetState', sql.NVarChar, clean(req.body?.state || req.body?.targetState) || targetState)
    .input('MarketNumber', sql.NVarChar, clean(req.body?.marketNumber || req.body?.market))
    .input('CenterLatitude', sql.Decimal(10, 7), centerLatitude)
    .input('CenterLongitude', sql.Decimal(10, 7), centerLongitude)
    .input('RadiusMiles', sql.Decimal(8, 2), numberOrNull(req.body?.radiusMiles))
    .input('VisitFrequencyDays', sql.Int, visitFrequencyDays)
    .input('CheckInRequired', sql.Bit, boolValue(req.body?.checkInRequired, true))
    .input('ProofRequired', sql.Bit, boolValue(req.body?.proofRequired, true))
    .input('CreatedBy', sql.Int, req.user?.userId || null)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_TargetingRule (
        CampaignId, ConfigName, TargetType, Geography, PharmacyNumber, SpecialtySource, DoctorType,
        Specialty, CustomSpecialty, DoctorCategory, NpiNumber, TaxonomyCode, TaxonomyDescription, RequirePrimaryTaxonomy,
        TargetCity, TargetState, MarketNumber, CenterLatitude, CenterLongitude, RadiusMiles,
        VisitFrequencyDays, CheckInRequired, ProofRequired, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        @CampaignId, @ConfigName, @TargetType, @Geography, @PharmacyNumber, @SpecialtySource, @DoctorType,
        @Specialty, @CustomSpecialty, @DoctorCategory, @NpiNumber, @TaxonomyCode, @TaxonomyDescription, @RequirePrimaryTaxonomy,
        @TargetCity, @TargetState, @MarketNumber, @CenterLatitude, @CenterLongitude, @RadiusMiles,
        @VisitFrequencyDays, @CheckInRequired, @ProofRequired, @CreatedBy
      )
    `);
  res.status(201).json(result.recordset[0]);
});

clientWorkflowRoutes.post('/campaign-configs/preview', async (req, res) => {
  const campaignId = numberOrNull(req.body?.campaignId);
  if (!campaignId) return res.status(400).json({ message: 'campaignId is required.' });
  const query = requestToTargetQuery(req.body);
  const limit = Math.min(Math.max(Number(req.body?.limit) || 250, 1), 1000);
  const targets = await getTargets(query, limit);
  const warnings: string[] = [];
  if (normalizeForCompare(query.targetType) === 'DOCTOR' && normalizeForCompare(query.state || 'FL') !== 'FL') {
    warnings.push('Doctor targeting outside FL may not match configured doctor suggestion geography rules.');
  }
  res.json({
    count: targets.length,
    targets: withMatchReason(targets, query),
    warnings
  });
});

clientWorkflowRoutes.post('/doctor-preview-zones', async (req, res) => {
  const campaignId = numberOrNull(req.body?.campaignId);
  if (!campaignId) return res.status(400).json({ message: 'campaignId is required.' });

  const city = clean(req.body?.city) || 'St. Petersburg';
  const state = clean(req.body?.state) || 'FL';
  const capacity = workflowCapacityHours(req.body?.capacityType, req.body?.customHours);
  // Accept either a single doctorType (legacy) or doctorTypes[] (multi-select). An
  // "Any" / empty value means no type filter at all.
  const requestedDoctorTypes: string[] = (Array.isArray(req.body?.doctorTypes)
    ? req.body.doctorTypes
    : [req.body?.doctorType])
    .map((t: any) => clean(t))
    .filter((t: string) => Boolean(t));
  const includesAny = requestedDoctorTypes.length === 0
    || requestedDoctorTypes.some((t) => normalizeForCompare(t) === 'ANY');
  const filterTypes = includesAny ? [] : Array.from(new Set(requestedDoctorTypes));
  const filterByType = filterTypes.length > 0;

  // Resolve city center using existing utility (reuses CITY_COORDINATES + ALLOWED_DOCTOR_SUGGESTION_LOCATIONS)
  const cityCenter = doctorLocationFromCity(city)?.coordinates || cityCoordinate(city, state);
  if (!cityCenter) {
    return res.status(400).json({ message: `Could not resolve city center coordinates for "${city}".` });
  }

  // Build the full set of city name aliases accepted for this city so the SQL IN list is wide enough.
  const cityLocation = ALLOWED_DOCTOR_SUGGESTION_LOCATIONS.find(
    (loc) => normalizeLocationForCompare(loc.city) === normalizeLocationForCompare(city)
  );
  const cityAliases: string[] = cityLocation
    ? [cityLocation.city, ...cityLocation.aliases]
    : [city];
  const cityZips: string[] = cityLocation ? cityLocation.zips : [];

  const pool = await getPool();
  const hasDoctorLatitude = await hasColumn('Master_Doctor', 'Doctor_Latitude');
  const hasDoctorLongitude = await hasColumn('Master_Doctor', 'Doctor_Longitude');
  const hasLatitude = await hasColumn('Master_Doctor', 'Latitude');
  const hasLongitude = await hasColumn('Master_Doctor', 'Longitude');
  const hasFax = await hasColumn('Master_Doctor', 'Doctor_Fax');
  const latExpr = hasDoctorLatitude
    ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Latitude)'
    : hasLatitude
      ? 'TRY_CONVERT(DECIMAL(10,7), d.Latitude)'
      : 'CAST(NULL AS DECIMAL(10,7))';
  const lngExpr = hasDoctorLongitude
    ? 'TRY_CONVERT(DECIMAL(10,7), d.Doctor_Longitude)'
    : hasLongitude
      ? 'TRY_CONVERT(DECIMAL(10,7), d.Longitude)'
      : 'CAST(NULL AS DECIMAL(10,7))';

  // Build city filter: match any known alias OR any known zip code for this city.
  // Using individual parameterized inputs to avoid dynamic SQL injection.
  const aliasParams = cityAliases.map((_, i) => `@CityAlias${i}`);
  const zipParams = cityZips.map((_, i) => `@CityZip${i}`);
  const cityWhereParts: string[] = [];
  if (aliasParams.length) {
    cityWhereParts.push(`UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))) IN (${aliasParams.map((p) => `UPPER(${p})`).join(', ')})`);
  }
  if (zipParams.length) {
    cityWhereParts.push(`LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) IN (${zipParams.join(', ')})`);
  }
  const cityWhere = cityWhereParts.length
    ? `AND (${cityWhereParts.join(' OR ')})`
    : '';

  const typeParams = filterTypes.map((_, i) => `@DoctorType${i}`);
  const typeWhere = filterByType
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(d.Doctor_Type, '')))) IN (${typeParams.map((p) => `UPPER(${p})`).join(', ')})`
    : '';

  const requestedLimit = Number(req.body?.limit) || 5000;
  const scanLimit = Math.min(Math.max(requestedLimit, 100), 10000);

  const request = pool.request();
  cityAliases.forEach((alias, i) => request.input(`CityAlias${i}`, sql.NVarChar, alias));
  cityZips.forEach((zip, i) => request.input(`CityZip${i}`, sql.NVarChar, zip));
  filterTypes.forEach((t, i) => request.input(`DoctorType${i}`, sql.NVarChar, t));

  let rawRows: any[];
  try {
    const result = await request.query(`
      SELECT TOP ${scanLimit}
        d.ID                                                                              AS DoctorId,
        LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, '')))                                         AS NpiNumber,
        LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName,''), ' ', ISNULL(d.Doctor_LastName,'')))) AS TargetName,
        LTRIM(RTRIM(ISNULL(d.Doctor_Type, '')))                                          AS DoctorTypeCode,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, '')))                                 AS AddressStreet,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, '')))                                   AS AddressCity,
        LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, '')))                                  AS AddressState,
        LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), '')))               AS AddressZip,
        LTRIM(RTRIM(ISNULL(d.Doctor_Phone, d.Doctor_MobileNo)))                         AS Phone,
        ${hasFax ? "LTRIM(RTRIM(ISNULL(d.Doctor_Fax,'')))" : "CAST(NULL AS NVARCHAR(50))"} AS Fax,
        ${latExpr}                                                                        AS Latitude,
        ${lngExpr}                                                                        AS Longitude
      FROM dbo.Master_Doctor d
      WHERE 1 = 1
        ${cityWhere}
        ${typeWhere}
      ORDER BY d.Doctor_LastName, d.Doctor_FirstName
    `);
    rawRows = result.recordset;
  } catch (err) {
    console.error('[doctor-preview-zones] SQL error:', err);
    return res.status(500).json({ message: 'Database query failed.', detail: err instanceof Error ? err.message : String(err) });
  }

  // Map rows → doctors with resolved coordinates
  const doctorsWithCoordinates: any[] = [];
  const needsCoordinates: any[] = [];
  const zoneBuckets = new Map<string, { key: string; startMiles: number; endMiles: number; doctors: any[] }>();

  for (const row of rawRows) {
    const rawLat = numberOrNull(row.Latitude);
    const rawLng = numberOrNull(row.Longitude);
    const doctorTypeCode = clean(row.DoctorTypeCode);
    const specialty = doctorTypeCode
      ? `${doctorTypeCode} - ${localDoctorTypeLabel(doctorTypeCode) || doctorTypeCode}`
      : 'Unknown';

    // Derive coordinates from city/zip if the DB row has no stored GPS
    const derived = (!validCoordinate(rawLat) || !validCoordinate(rawLng))
      ? deriveCoordinatesFromAddress(row.AddressCity, row.AddressState, row.AddressZip)
      : null;
    const lat = validCoordinate(rawLat) ? rawLat! : (derived?.latitude ?? null);
    const lng = validCoordinate(rawLng) ? rawLng! : (derived?.longitude ?? null);

    const doctor = {
      doctorId: row.DoctorId ?? null,
      targetName: clean(row.TargetName) || `Doctor ${row.DoctorId}`,
      npiNumber: clean(row.NpiNumber) || null,
      specialty,
      addressStreet: clean(row.AddressStreet) || null,
      addressCity: clean(row.AddressCity) || null,
      addressState: clean(row.AddressState) || null,
      addressZip: clean(row.AddressZip) || null,
      phone: clean(row.Phone) || null,
      latitude: lat,
      longitude: lng
    };

    if (!validCoordinate(lat) || !validCoordinate(lng)) {
      needsCoordinates.push(doctor);
      continue;
    }

    const distanceMiles = milesBetween(cityCenter, { latitude: lat as number, longitude: lng as number });
    const band = zoneBandForDistance(distanceMiles);
    const zoneKey = `${band.start}-${band.end}`;
    const bucket = zoneBuckets.get(zoneKey) ?? { key: zoneKey, startMiles: band.start, endMiles: band.end, doctors: [] };
    bucket.doctors.push({ ...doctor, distanceMiles: Number(distanceMiles.toFixed(2)), zoneKey });
    zoneBuckets.set(zoneKey, bucket);
    doctorsWithCoordinates.push({ ...doctor, distanceMiles: Number(distanceMiles.toFixed(2)), zoneKey });
  }

  // Build zones — only non-empty radius bands, sorted nearest first.
  const sortedZones = Array.from(zoneBuckets.values())
    .sort((a, b) => a.startMiles - b.startMiles)
    .map((bucket, bandIndex) => {
      const doctors = [...bucket.doctors].sort((a, b) =>
        (a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999)
      );
      const specialtyBreakdown: Record<string, number> = {};
      for (const d of doctors) {
        const k = d.specialty || 'Unknown';
        specialtyBreakdown[k] = (specialtyBreakdown[k] || 0) + 1;
      }

      const estimatedMinutes = estimateZoneMinutes(doctors.length, bucket.endMiles);
      const estimatedHours = Number((estimatedMinutes / 60).toFixed(1));
      const gap = Number((estimatedHours - capacity.hours).toFixed(1));
      const capacityStatus: 'fits' | 'over' | 'under' = gap > 0.5 ? 'over' : gap < -0.5 ? 'under' : 'fits';

      return {
        zoneId: `zone_${bandIndex + 1}`,
        zoneName: `Zone ${bandIndex + 1}`,
        radiusBand: `${bucket.startMiles}–${bucket.endMiles} miles`,
        startMiles: bucket.startMiles,
        endMiles: bucket.endMiles,
        doctorsCount: doctors.length,
        specialtyBreakdown,
        estimatedMinutes,
        estimatedHours,
        capacityStatus,
        suggestedPeopleOrDays: capacityStatus === 'over' ? Math.max(2, Math.ceil(estimatedHours / capacity.hours)) : 1,
        doctors
      };
    });

  res.json({
    city,
    state,
    cityCenter,
    filters: {
      campaignId,
      doctorType: filterByType ? filterTypes.join(', ') : 'Any',
      doctorTypes: filterByType ? filterTypes : ['Any'],
      capacityType: capacity.type,
      capacityHours: capacity.hours
    },
    totals: {
      matchedDoctors: rawRows.length,
      mappableDoctors: doctorsWithCoordinates.length,
      needsCoordinates: needsCoordinates.length,
      generatedZones: sortedZones.length
    },
    constants: WORKFLOW_TIME_CONSTANTS,
    doctors: doctorsWithCoordinates,
    needsCoordinates,
    zones: sortedZones
  });
});

// ─── Optimized route (data_processing_node pipeline, in-process) ─────────────
// Takes the doctors matched in Step 1 (sent from the workflow UI) plus the
// selected shift length and builds a single-person, time-budgeted, ordered
// driving route: geocode (OSM/Nominatim) -> merge same-building stops ->
// OSRM driving-time matrix (offline fallback) -> greedy + 2-opt/Or-opt solver.
// Returns the ordered stops, timing, a Google Maps link, and uncovered doctors.
clientWorkflowRoutes.post('/optimize-route', async (req, res) => {
  const incoming = Array.isArray(req.body?.doctors) ? req.body.doctors : [];
  if (!incoming.length) {
    return res.status(400).json({ message: 'doctors array is required.' });
  }

  const doctors: PlanDoctor[] = incoming.map((d: any) => ({
    doctorId: numberOrNull(d?.doctorId),
    targetName: clean(d?.targetName) || null,
    npiNumber: clean(d?.npiNumber) || null,
    specialty: clean(d?.specialty) || null,
    addressStreet: clean(d?.addressStreet) || null,
    addressCity: clean(d?.addressCity) || null,
    addressState: clean(d?.addressState) || null,
    addressZip: clean(d?.addressZip) || null,
    phone: clean(d?.phone) || null,
    latitude: validCoordinate(numberOrNull(d?.latitude)) ? numberOrNull(d?.latitude) : null,
    longitude: validCoordinate(numberOrNull(d?.longitude)) ? numberOrNull(d?.longitude) : null
  }));

  // Hours can be sent directly or derived from the capacity selector (same as preview).
  const hours = numberOrNull(req.body?.hours)
    ?? workflowCapacityHours(req.body?.capacityType, req.body?.customHours).hours;
  const pitStopMinutes = numberOrNull(req.body?.pitStopMinutes) ?? 10;
  const travel = clean(req.body?.travel) === 'offline' ? 'offline' : 'osrm';
  const startTime = clean(req.body?.startTime) || '09:00';

  try {
    const plan = await planRoute(doctors, {
      hours,
      pitStopMinutes,
      travel,
      startTime
    });
    res.json(plan);
  } catch (err) {
    console.error('[optimize-route] failed:', err);
    res.status(500).json({
      message: 'Route optimization failed.',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

// ─── App config (single source of truth for client settings) ────────────────
// The mobile app reads runtime config (e.g. the check-in radius) from here so
// values are defined in exactly one place: the backend environment.
clientWorkflowRoutes.get('/app-config', (_req, res) => {
  res.json({ checkInRadiusMiles: CHECK_IN_RADIUS_MILES });
});

// ─── Optimize route (streaming progress) ─────────────────────────────────────
// Same pipeline as POST /optimize-route, but streams newline-delimited JSON so
// the UI can show a live progress bar + ETA while geocoding and OSRM tiling run.
// Emits: {type:'progress', phase, done, total} ... then {type:'done', plan}
// or {type:'error', message}. Each line is a complete JSON object.
clientWorkflowRoutes.post('/optimize-route/stream', async (req, res) => {
  const incoming = Array.isArray(req.body?.doctors) ? req.body.doctors : [];
  if (!incoming.length) {
    return res.status(400).json({ message: 'doctors array is required.' });
  }

  const doctors: PlanDoctor[] = incoming.map((d: any) => ({
    doctorId: numberOrNull(d?.doctorId),
    targetName: clean(d?.targetName) || null,
    npiNumber: clean(d?.npiNumber) || null,
    specialty: clean(d?.specialty) || null,
    addressStreet: clean(d?.addressStreet) || null,
    addressCity: clean(d?.addressCity) || null,
    addressState: clean(d?.addressState) || null,
    addressZip: clean(d?.addressZip) || null,
    phone: clean(d?.phone) || null,
    latitude: validCoordinate(numberOrNull(d?.latitude)) ? numberOrNull(d?.latitude) : null,
    longitude: validCoordinate(numberOrNull(d?.longitude)) ? numberOrNull(d?.longitude) : null
  }));

  const hours = numberOrNull(req.body?.hours)
    ?? workflowCapacityHours(req.body?.capacityType, req.body?.customHours).hours;
  const pitStopMinutes = numberOrNull(req.body?.pitStopMinutes) ?? 10;
  const travel = clean(req.body?.travel) === 'offline' ? 'offline' : 'osrm';
  const startTime = clean(req.body?.startTime) || '09:00';

  // Stream as newline-delimited JSON. Disable proxy buffering so each line is
  // flushed to the browser the instant it is written.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

  const write = (obj: any) => {
    try { res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ }
  };

  // Heartbeat so the connection (and any intermediary) stays alive during the
  // long, silent stretches where each unit takes ~1s.
  const heartbeat = setInterval(() => write({ type: 'ping' }), 15000);

  try {
    const plan = await planRoute(doctors, {
      hours,
      pitStopMinutes,
      travel,
      startTime,
      onProgress: (ev) => write({ type: 'progress', ...ev })
    });
    clearInterval(heartbeat);
    write({ type: 'done', plan });
    res.end();
  } catch (err) {
    console.error('[optimize-route/stream] failed:', err);
    clearInterval(heartbeat);
    write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

// ─── Reset generated workflow data (start fresh) ─────────────────────────────
// Clears the generated assignment/route/stop/proof/delivery rows in dependency
// order so the mobile app starts from a clean slate. Does NOT touch master data
// (campaigns, doctors, users, targeting rules). XACT_ABORT rolls back on error.
clientWorkflowRoutes.post('/admin/reset-workflow-data', async (_req, res) => {
  const pool = await getPool();
  try {
    const result = await pool.request().query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @proofs INT = 0, @checkins INT = 0, @deliveryPhotos INT = 0,
              @deliveries INT = 0, @stops INT = 0, @routes INT = 0, @assignments INT = 0;

      IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStopProof; SET @proofs = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStopCheckIn; SET @checkins = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_DeliveryPhoto; SET @deliveryPhotos = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_Delivery','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_Delivery; SET @deliveries = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_RouteStop; SET @stops = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_Route','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_Route; SET @routes = @@ROWCOUNT; END

      IF OBJECT_ID('dbo.PharmacyFlyer_Assignment','U') IS NOT NULL
        BEGIN DELETE FROM dbo.PharmacyFlyer_Assignment; SET @assignments = @@ROWCOUNT; END

      COMMIT TRANSACTION;

      SELECT @proofs AS routeStopProofs, @checkins AS routeStopCheckIns,
             @deliveryPhotos AS deliveryPhotos, @deliveries AS deliveries,
             @stops AS routeStops, @routes AS routes, @assignments AS assignments;
    `);
    const deleted = result.recordset[0] || {};
    console.log('[reset-workflow-data] deleted:', deleted);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[reset-workflow-data] failed:', err);
    res.status(500).json({
      message: 'Reset failed.',
      detail: err instanceof Error ? err.message : String(err)
    });
  }
});

clientWorkflowRoutes.get('/campaign-configs/:configId/preview', async (req, res) => {
  const configId = Number(req.params.configId);
  const config = await getConfig(configId);
  if (!config) return res.status(404).json({ message: 'Config not found.' });

  if (isDoctorSuggestionType(config.TargetType)) {
    const allowedLocations = config.TargetCity ? doctorSuggestionLocationsForRequest(config.TargetCity) : ALLOWED_DOCTOR_SUGGESTION_LOCATIONS;
    if (!allowedLocations.length || normalizeForCompare(config.TargetState || 'FL') !== 'FL') {
      return res.status(400).json({
        message: 'Doctor preview is restricted to Pinellas Park, FL and St. Petersburg, FL.',
        allowedLocations: ALLOWED_DOCTOR_SUGGESTION_LOCATIONS
      });
    }
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 250, 1), 1000);
  const query = configToTargetQuery(config);
  const targets = await getTargets(query, limit);
  const flyer = clean(config.FlyerTitle) || clean(config.FlyerIdentifier) || clean(config.CampaignName);
  res.json({
    configId,
    count: targets.length,
    targets: withMatchReason(targets.map((target) => ({ ...target, flyer })), query)
  });
});

clientWorkflowRoutes.post('/campaign-configs/:configId/suggestions', async (req, res) => {
  const configId = Number(req.params.configId);
  const config = await getConfig(configId);
  if (!config) return res.status(404).json({ message: 'Config not found.' });
  if (!boolValue(req.body?.previewConfirmed, false)) {
    return res.status(400).json({
      message: 'Preview and confirm this config before generating suggestions.',
      requiresPreview: true
    });
  }
  if (isDoctorSuggestionType(config.TargetType)) {
    const allowedLocations = config.TargetCity ? doctorSuggestionLocationsForRequest(config.TargetCity) : ALLOWED_DOCTOR_SUGGESTION_LOCATIONS;
    if (!allowedLocations.length || normalizeForCompare(config.TargetState || 'FL') !== 'FL') {
      return res.status(400).json({
        message: 'Doctor suggestions are restricted to Pinellas Park, FL and St. Petersburg, FL.',
        allowedLocations: ALLOWED_DOCTOR_SUGGESTION_LOCATIONS
      });
    }
  }
  const result = await createSuggestionsForConfig(configId, config, req.body, req.user?.userId);
  res.status(201).json(result);
});

async function createSuggestionsForConfig(configId: number, config: any, body: any, userId?: number) {
  const limit = Math.min(Math.max(Number(body?.limit) || 250, 1), 1000);
  const targets = await getTargets(configToTargetQuery(config), limit);
  const pool = await getPool();
  const created: any[] = [];
  const visitFrequency = numberOrNull(config.VisitFrequencyDays) ?? numberOrNull(config.DefaultVisitFrequencyDays) ?? 30;

  for (const target of targets) {
    const existing = await pool.request()
      .input('CampaignId', sql.Int, config.CampaignId)
      .input('ConfigId', sql.BigInt, configId)
      .input('TargetId', sql.BigInt, target.targetId)
      .input('DoctorId', sql.Int, target.doctorId)
      .input('TargetType', sql.NVarChar, target.targetType)
      .input('TargetName', sql.NVarChar, target.targetName)
      .query(`
        SELECT TOP 1 AssignmentId
        FROM dbo.PharmacyFlyer_Assignment
        WHERE CampaignId = @CampaignId
          AND ConfigId = @ConfigId
          AND ISNULL(TargetId, -1) = ISNULL(@TargetId, -1)
          AND ISNULL(DoctorId, -1) = ISNULL(@DoctorId, -1)
          AND TargetType = @TargetType
          AND TargetName = @TargetName
          AND ApprovalStatus <> 'rejected'
      `);
    if (existing.recordset[0]) continue;

    const result = await pool.request()
      .input('CampaignId', sql.Int, config.CampaignId)
      .input('ConfigId', sql.BigInt, configId)
      .input('TargetId', sql.BigInt, target.targetId)
      .input('DoctorId', sql.Int, target.doctorId)
      .input('TargetType', sql.NVarChar, target.targetType)
      .input('TargetName', sql.NVarChar, target.targetName)
      .input('PracticeName', sql.NVarChar, target.practiceName)
      .input('Specialty', sql.NVarChar, target.specialty)
      .input('NpiNumber', sql.NVarChar, target.npiNumber)
      .input('AddressStreet', sql.NVarChar, target.addressStreet)
      .input('AddressCity', sql.NVarChar, target.addressCity)
      .input('AddressState', sql.NVarChar, target.addressState)
      .input('AddressZip', sql.NVarChar, target.addressZip)
      .input('Phone', sql.NVarChar, target.phone)
      .input('Latitude', sql.Decimal(10, 7), target.latitude)
      .input('Longitude', sql.Decimal(10, 7), target.longitude)
      .input('VisitFrequencyDays', sql.Int, visitFrequency)
      .input('NextVisitDueDate', sql.Date, dateOrToday(body?.scheduledDate))
      .input('CreatedBy', sql.Int, userId || null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Assignment (
          CampaignId, ConfigId, TargetId, DoctorId, TargetType, TargetName, PracticeName,
          Specialty, NpiNumber, AddressStreet, AddressCity, AddressState, AddressZip, Phone,
          Latitude, Longitude, VisitFrequencyDays, NextVisitDueDate, CreatedBy
        )
        OUTPUT INSERTED.*
        VALUES (
          @CampaignId, @ConfigId, @TargetId, @DoctorId, @TargetType, @TargetName, @PracticeName,
          @Specialty, @NpiNumber, @AddressStreet, @AddressCity, @AddressState, @AddressZip, @Phone,
          @Latitude, @Longitude, @VisitFrequencyDays, @NextVisitDueDate, @CreatedBy
        )
      `);
    created.push(result.recordset[0]);
  }

  return { configId, suggestedCount: targets.length, createdCount: created.length, assignments: created };
}

clientWorkflowRoutes.post('/suggest', async (req, res) => {
  const campaignId = numberOrNull(req.body?.campaignId);
  if (!campaignId) return res.status(400).json({ message: 'campaignId is required.' });

  const targetType = clean(req.body?.targetType) || 'Doctor';
  const specialty = clean(req.body?.specialty);
  const radiusMiles = numberOrNull(req.body?.radiusMiles) ?? 25;
  const requestedState = clean(req.body?.state) || 'FL';

  if (isDoctorSuggestionType(targetType)) {
    const locations = doctorSuggestionLocationsForRequest(req.body?.city);
    if (!locations.length || normalizeForCompare(requestedState) !== 'FL') {
      return res.status(400).json({
        message: 'Doctor suggestions are restricted to Pinellas Park, FL and St. Petersburg, FL.',
        allowedLocations: ALLOWED_DOCTOR_SUGGESTION_LOCATIONS
      });
    }

    const pool = await getPool();
    const results: any[] = [];
    let suggestedCount = 0;
    let createdCount = 0;
    const assignments: any[] = [];

    for (const location of locations) {
      const centerFromCity = location.coordinates || cityCoordinate(location.city, location.state);
      const configName = clean(req.body?.configName)
        || `${specialty || targetType} within ${radiusMiles} miles of ${location.city}`;

      const configResult = await pool.request()
        .input('CampaignId', sql.Int, campaignId)
        .input('ConfigName', sql.NVarChar, configName)
        .input('TargetType', sql.NVarChar, targetType)
        .input('Specialty', sql.NVarChar, specialty)
        .input('TargetCity', sql.NVarChar, location.city)
        .input('TargetState', sql.NVarChar, location.state)
        .input('CenterLatitude', sql.Decimal(10, 7), centerFromCity?.latitude ?? null)
        .input('CenterLongitude', sql.Decimal(10, 7), centerFromCity?.longitude ?? null)
        .input('RadiusMiles', sql.Decimal(8, 2), radiusMiles)
        .input('VisitFrequencyDays', sql.Int, 30)
        .input('CreatedBy', sql.Int, req.user?.userId || null)
        .query(`
          INSERT INTO dbo.PharmacyFlyer_TargetingRule (
            CampaignId, ConfigName, TargetType, Specialty, TargetCity, TargetState,
            CenterLatitude, CenterLongitude, RadiusMiles, VisitFrequencyDays, CreatedBy
          )
          OUTPUT INSERTED.*
          VALUES (
            @CampaignId, @ConfigName, @TargetType, @Specialty, @TargetCity, @TargetState,
            @CenterLatitude, @CenterLongitude, @RadiusMiles, @VisitFrequencyDays, @CreatedBy
          )
        `);

      const config = configResult.recordset[0];
      const configWithCampaign = await getConfig(config.ConfigId);
      const result = await createSuggestionsForConfig(
        config.ConfigId,
        configWithCampaign,
        { ...req.body, city: location.city, state: location.state },
        req.user?.userId
      );

      results.push({ ...result, config: configWithCampaign, location });
      suggestedCount += result.suggestedCount;
      createdCount += result.createdCount;
      assignments.push(...result.assignments);
    }

    return res.status(201).json({
      suggestedCount,
      createdCount,
      assignments,
      locations,
      results
    });
  }

  const city = clean(req.body?.city) || 'Pinellas Park';
  const state = requestedState;
  const configName = clean(req.body?.configName)
    || `${specialty || targetType} within ${radiusMiles} miles of ${city}`;

  const centerFromCity = cityCoordinate(city, state);
  const pool = await getPool();
  const configResult = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('ConfigName', sql.NVarChar, configName)
    .input('TargetType', sql.NVarChar, targetType)
    .input('Specialty', sql.NVarChar, specialty)
    .input('TargetCity', sql.NVarChar, city)
    .input('TargetState', sql.NVarChar, state)
    .input('CenterLatitude', sql.Decimal(10, 7), centerFromCity?.latitude ?? null)
    .input('CenterLongitude', sql.Decimal(10, 7), centerFromCity?.longitude ?? null)
    .input('RadiusMiles', sql.Decimal(8, 2), radiusMiles)
    .input('VisitFrequencyDays', sql.Int, 30)
    .input('CreatedBy', sql.Int, req.user?.userId || null)
    .query(`
      INSERT INTO dbo.PharmacyFlyer_TargetingRule (
        CampaignId, ConfigName, TargetType, Specialty, TargetCity, TargetState,
        CenterLatitude, CenterLongitude, RadiusMiles, VisitFrequencyDays, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        @CampaignId, @ConfigName, @TargetType, @Specialty, @TargetCity, @TargetState,
        @CenterLatitude, @CenterLongitude, @RadiusMiles, @VisitFrequencyDays, @CreatedBy
      )
    `);
  const config = configResult.recordset[0];
  const configWithCampaign = await getConfig(config.ConfigId);
  const result = await createSuggestionsForConfig(config.ConfigId, configWithCampaign, req.body, req.user?.userId);
  res.status(201).json({ ...result, config: configWithCampaign });
});

clientWorkflowRoutes.get('/assignments', async (req, res) => {
  const pool = await getPool();
  const campaignId = numberOrNull(req.query.campaignId);
  const configId = numberOrNull(req.query.configId);
  const staffUserId = numberOrNull(req.query.staffUserId);
  const scheduledDate = clean(req.query.scheduledDate);
  const approvalStatus = clean(req.query.approvalStatus);
  const assignmentStatus = clean(req.query.assignmentStatus);
  const result = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('ConfigId', sql.BigInt, configId)
    .input('StaffUserId', sql.Int, staffUserId)
    .input('ScheduledDate', sql.Date, scheduledDate)
    .input('ApprovalStatus', sql.NVarChar, approvalStatus)
    .input('AssignmentStatus', sql.NVarChar, assignmentStatus)
    .query(`
      SELECT TOP 1000
        a.*,
        c.CampaignName,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        c.FlyerFileUrl,
        r.ConfigName,
        rt.RouteDate,
        CONCAT(u.User_FirstName, ' ', u.User_LastName) AS StaffName
      FROM dbo.PharmacyFlyer_Assignment a
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_TargetingRule r ON r.ConfigId = a.ConfigId
      LEFT JOIN dbo.PharmacyFlyer_Route rt ON rt.RouteId = a.RouteId
      LEFT JOIN dbo.Master_User u ON u.ID = a.StaffUserId
      WHERE (@CampaignId IS NULL OR a.CampaignId = @CampaignId)
        AND (@ConfigId IS NULL OR a.ConfigId = @ConfigId)
        AND (@StaffUserId IS NULL OR a.StaffUserId = @StaffUserId)
        AND (@ScheduledDate IS NULL OR a.ScheduledDate = @ScheduledDate)
        AND (@ApprovalStatus IS NULL OR a.ApprovalStatus = @ApprovalStatus)
        AND (@AssignmentStatus IS NULL OR a.AssignmentStatus = @AssignmentStatus)
      ORDER BY COALESCE(rt.RouteDate, a.ScheduledDate) DESC, a.RouteStopOrder, a.CreatedDate DESC
    `);
  res.json(result.recordset);
});

clientWorkflowRoutes.post('/assignments/approve', async (req, res) => {
  const assignmentIds = Array.isArray(req.body?.assignmentIds)
    ? req.body.assignmentIds.map(Number).filter(Number.isFinite)
    : [];
  if (!assignmentIds.length) return res.status(400).json({ message: 'assignmentIds array is required.' });

  const pool = await getPool();
  const approved: any[] = [];
  for (const assignmentId of assignmentIds) {
    const result = await pool.request()
      .input('AssignmentId', sql.BigInt, assignmentId)
      .input('StaffUserId', sql.Int, numberOrNull(req.body?.staffUserId))
      .input('ScheduledDate', sql.Date, dateOrToday(req.body?.scheduledDate))
      .input('DefaultScheduledDate', sql.Date, toFloridaDateString())
      .input('ApprovedBy', sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET ApprovalStatus = 'approved',
            AssignmentStatus = 'approved',
            StaffUserId = COALESCE(@StaffUserId, StaffUserId),
            ScheduledDate = COALESCE(@ScheduledDate, ScheduledDate, @DefaultScheduledDate),
            ApprovedBy = @ApprovedBy,
            ApprovedAt = SYSDATETIME(),
            LastModifiedDate = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE AssignmentId = @AssignmentId
      `);
    if (result.recordset[0]) approved.push(result.recordset[0]);
  }
  res.json({ approvedCount: approved.length, assignments: approved });
});

clientWorkflowRoutes.post('/zones/create-assignments', async (req, res) => {
  const staffUserId = numberOrNull(req.body?.staffUserId);
  const scheduledDate = dateOrToday(req.body?.scheduledDate);
  const autoApprove = boolValue(req.body?.autoApprove, true);
  const configId = numberOrNull(req.body?.configId);
  const doctorAssignments = Array.isArray(req.body?.doctorAssignments) ? req.body.doctorAssignments : [];

  if (!staffUserId) return res.status(400).json({ message: 'staffUserId is required.' });
  if (!doctorAssignments.length) return res.status(400).json({ message: 'doctorAssignments is required.' });

  const pool = await getPool();
  const created: any[] = [];
  const updated: any[] = [];
  const skipped: any[] = [];

  for (const row of doctorAssignments) {
    const campaignId = numberOrNull(row?.campaignId);
    const doctorId = numberOrNull(row?.doctorId);
    const targetName = clean(row?.targetName) || clean(row?.doctorName);
    const targetType = clean(row?.targetType) || 'Doctor';
    if (!campaignId || !targetName) {
      skipped.push({ reason: 'Missing campaignId or targetName.', row });
      continue;
    }

    const existing = await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('DoctorId', sql.Int, doctorId)
      .input('TargetType', sql.NVarChar, targetType)
      .input('TargetName', sql.NVarChar, targetName)
      .query(`
        SELECT TOP 1 AssignmentId, ApprovalStatus
        FROM dbo.PharmacyFlyer_Assignment
        WHERE CampaignId = @CampaignId
          AND ISNULL(DoctorId, -1) = ISNULL(@DoctorId, -1)
          AND TargetType = @TargetType
          AND TargetName = @TargetName
          AND ApprovalStatus <> 'rejected'
        ORDER BY AssignmentId DESC
      `);

    if (existing.recordset[0]?.AssignmentId) {
      const result = await pool.request()
        .input('AssignmentId', sql.BigInt, existing.recordset[0].AssignmentId)
        .input('Specialty', sql.NVarChar, clean(row?.specialty))
        .input('NpiNumber', sql.NVarChar, clean(row?.npiNumber))
        .input('AddressStreet', sql.NVarChar, clean(row?.addressStreet))
        .input('AddressCity', sql.NVarChar, clean(row?.addressCity))
        .input('AddressState', sql.NVarChar, clean(row?.addressState) || 'FL')
        .input('AddressZip', sql.NVarChar, clean(row?.addressZip))
        .input('Phone', sql.NVarChar, clean(row?.phone))
        .input('Latitude', sql.Decimal(10, 7), numberOrNull(row?.latitude))
        .input('Longitude', sql.Decimal(10, 7), numberOrNull(row?.longitude))
        .input('StaffUserId', sql.Int, staffUserId)
        .input('ScheduledDate', sql.Date, scheduledDate)
        .input('ApprovalStatus', sql.NVarChar, autoApprove ? 'approved' : 'suggested')
        .input('AssignmentStatus', sql.NVarChar, autoApprove ? 'approved' : 'suggested')
        .input('ApprovedBy', sql.Int, autoApprove ? (req.user?.userId || null) : null)
        .query(`
          UPDATE dbo.PharmacyFlyer_Assignment
          SET Specialty = COALESCE(@Specialty, Specialty),
              NpiNumber = COALESCE(@NpiNumber, NpiNumber),
              AddressStreet = COALESCE(@AddressStreet, AddressStreet),
              AddressCity = COALESCE(@AddressCity, AddressCity),
              AddressState = COALESCE(@AddressState, AddressState),
              AddressZip = COALESCE(@AddressZip, AddressZip),
              Phone = COALESCE(@Phone, Phone),
              Latitude = COALESCE(@Latitude, Latitude),
              Longitude = COALESCE(@Longitude, Longitude),
              StaffUserId = @StaffUserId,
              ScheduledDate = @ScheduledDate,
              ApprovalStatus = @ApprovalStatus,
              AssignmentStatus = @AssignmentStatus,
              ApprovedBy = CASE WHEN @ApprovalStatus = 'approved' THEN @ApprovedBy ELSE ApprovedBy END,
              ApprovedAt = CASE WHEN @ApprovalStatus = 'approved' THEN SYSDATETIME() ELSE ApprovedAt END,
              LastModifiedDate = SYSDATETIME()
          OUTPUT INSERTED.*
          WHERE AssignmentId = @AssignmentId
        `);
      if (result.recordset[0]) updated.push(result.recordset[0]);
      continue;
    }

    const result = await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('ConfigId', sql.BigInt, configId)
      .input('DoctorId', sql.Int, doctorId)
      .input('TargetType', sql.NVarChar, targetType)
      .input('TargetName', sql.NVarChar, targetName)
      .input('Specialty', sql.NVarChar, clean(row?.specialty))
      .input('NpiNumber', sql.NVarChar, clean(row?.npiNumber))
      .input('AddressStreet', sql.NVarChar, clean(row?.addressStreet))
      .input('AddressCity', sql.NVarChar, clean(row?.addressCity))
      .input('AddressState', sql.NVarChar, clean(row?.addressState) || 'FL')
      .input('AddressZip', sql.NVarChar, clean(row?.addressZip))
      .input('Phone', sql.NVarChar, clean(row?.phone))
      .input('Latitude', sql.Decimal(10, 7), numberOrNull(row?.latitude))
      .input('Longitude', sql.Decimal(10, 7), numberOrNull(row?.longitude))
      .input('StaffUserId', sql.Int, staffUserId)
      .input('ScheduledDate', sql.Date, scheduledDate)
      .input('VisitFrequencyDays', sql.Int, numberOrNull(row?.visitFrequencyDays) || 30)
      .input('CreatedBy', sql.Int, req.user?.userId || null)
      .input('ApprovalStatus', sql.NVarChar, autoApprove ? 'approved' : 'suggested')
      .input('AssignmentStatus', sql.NVarChar, autoApprove ? 'approved' : 'suggested')
      .input('ApprovedBy', sql.Int, autoApprove ? (req.user?.userId || null) : null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Assignment (
          CampaignId, ConfigId, DoctorId, TargetType, TargetName, Specialty, NpiNumber,
          AddressStreet, AddressCity, AddressState, AddressZip, Phone, Latitude, Longitude,
          StaffUserId, ScheduledDate, VisitFrequencyDays, NextVisitDueDate, CreatedBy,
          ApprovalStatus, AssignmentStatus, ApprovedBy, ApprovedAt
        )
        OUTPUT INSERTED.*
        VALUES (
          @CampaignId, @ConfigId, @DoctorId, @TargetType, @TargetName, @Specialty, @NpiNumber,
          @AddressStreet, @AddressCity, @AddressState, @AddressZip, @Phone, @Latitude, @Longitude,
          @StaffUserId, @ScheduledDate, @VisitFrequencyDays, @ScheduledDate, @CreatedBy,
          @ApprovalStatus, @AssignmentStatus, @ApprovedBy, CASE WHEN @ApprovalStatus = 'approved' THEN SYSDATETIME() ELSE NULL END
        )
      `);

    if (result.recordset[0]) created.push(result.recordset[0]);
  }

  res.status(201).json({
    createdCount: created.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    assignments: [...created, ...updated],
    skipped
  });
});

// ─── Create a route directly from an optimized, ordered zone ─────────────────
// Used by the admin "Route & Zones" step. Unlike /routes/generate (which re-orders
// stops by nearest-neighbour and caps the count), this persists the exact optimized
// order the admin sees on the map, with no stop cap, and replaces any stale route for
// the same staff member + date so the mobile "Today Route" reflects the new plan.
clientWorkflowRoutes.post('/zones/create-route', async (req, res) => {
  const staffUserId = numberOrNull(req.body?.staffUserId);
  const routeDate = dateOrToday(req.body?.scheduledDate || req.body?.routeDate);
  const routeName = clean(req.body?.routeName) || `Route ${routeDate}`;
  const configId = numberOrNull(req.body?.configId);
  const replaceExisting = boolValue(req.body?.replaceExisting, true);
  const startAddress = clean(req.body?.startAddress);
  const startLat = numberOrNull(req.body?.startLatitude);
  const startLng = numberOrNull(req.body?.startLongitude);
  const doctorAssignments = Array.isArray(req.body?.doctorAssignments) ? req.body.doctorAssignments : [];

  if (!staffUserId) return res.status(400).json({ message: 'staffUserId is required.' });
  if (!doctorAssignments.length) return res.status(400).json({ message: 'doctorAssignments is required.' });

  const pool = await getPool();

  // 1. Replace any existing route for this staff member + date so the mobile app
  //    does not keep showing stale stops alongside the new plan.
  if (replaceExisting && (await hasTable('PharmacyFlyer_Route'))) {
    await pool.request()
      .input('StaffUserId', sql.Int, staffUserId)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        DECLARE @RouteIds TABLE (RouteId BIGINT PRIMARY KEY);
        INSERT INTO @RouteIds (RouteId)
          SELECT RouteId FROM dbo.PharmacyFlyer_Route
          WHERE StaffUserId = @StaffUserId AND RouteDate = @RouteDate;

        UPDATE a
          SET RouteId = NULL,
              RouteStopOrder = NULL,
              AssignmentStatus = CASE WHEN ISNULL(a.AssignmentStatus,'approved') IN ('completed','skipped','checked_in')
                                      THEN a.AssignmentStatus ELSE 'approved' END,
              LastModifiedDate = SYSDATETIME()
          FROM dbo.PharmacyFlyer_Assignment a
          INNER JOIN @RouteIds r ON r.RouteId = a.RouteId;

        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop','U') IS NOT NULL
          DELETE s FROM dbo.PharmacyFlyer_RouteStop s INNER JOIN @RouteIds r ON r.RouteId = s.RouteId;

        DELETE FROM dbo.PharmacyFlyer_Route WHERE RouteId IN (SELECT RouteId FROM @RouteIds);
      `);
  }

  // 2. Upsert each assignment (approved), preserving the supplied optimized order.
  const ordered: any[] = [];
  let createdCount = 0, updatedCount = 0, skippedCount = 0;

  for (let i = 0; i < doctorAssignments.length; i++) {
    const row = doctorAssignments[i];
    const campaignId = numberOrNull(row?.campaignId);
    const doctorId = numberOrNull(row?.doctorId);
    const targetName = clean(row?.targetName) || clean(row?.doctorName);
    const targetType = clean(row?.targetType) || 'Doctor';
    if (!campaignId || !targetName) { skippedCount++; continue; }

    const stopOrder = numberOrNull(row?.routeStopOrder) ?? (i + 1);

    const existing = await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('DoctorId', sql.Int, doctorId)
      .input('TargetType', sql.NVarChar, targetType)
      .input('TargetName', sql.NVarChar, targetName)
      .query(`
        SELECT TOP 1 AssignmentId FROM dbo.PharmacyFlyer_Assignment
        WHERE CampaignId = @CampaignId
          AND ISNULL(DoctorId, -1) = ISNULL(@DoctorId, -1)
          AND TargetType = @TargetType AND TargetName = @TargetName
          AND ApprovalStatus <> 'rejected'
        ORDER BY AssignmentId DESC
      `);

    const r = pool.request()
      .input('Specialty', sql.NVarChar, clean(row?.specialty))
      .input('NpiNumber', sql.NVarChar, clean(row?.npiNumber))
      .input('AddressStreet', sql.NVarChar, clean(row?.addressStreet))
      .input('AddressCity', sql.NVarChar, clean(row?.addressCity))
      .input('AddressState', sql.NVarChar, clean(row?.addressState) || 'FL')
      .input('AddressZip', sql.NVarChar, clean(row?.addressZip))
      .input('Phone', sql.NVarChar, clean(row?.phone))
      .input('Latitude', sql.Decimal(10, 7), numberOrNull(row?.latitude))
      .input('Longitude', sql.Decimal(10, 7), numberOrNull(row?.longitude))
      .input('StaffUserId', sql.Int, staffUserId)
      .input('ScheduledDate', sql.Date, routeDate)
      .input('StopOrder', sql.Int, stopOrder)
      .input('ApprovedBy', sql.Int, req.user?.userId || null);

    let resultRow: any;
    if (existing.recordset[0]?.AssignmentId) {
      r.input('AssignmentId', sql.BigInt, existing.recordset[0].AssignmentId);
      const u = await r.query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET Specialty = COALESCE(@Specialty, Specialty), NpiNumber = COALESCE(@NpiNumber, NpiNumber),
            AddressStreet = COALESCE(@AddressStreet, AddressStreet), AddressCity = COALESCE(@AddressCity, AddressCity),
            AddressState = COALESCE(@AddressState, AddressState), AddressZip = COALESCE(@AddressZip, AddressZip),
            Phone = COALESCE(@Phone, Phone), Latitude = COALESCE(@Latitude, Latitude), Longitude = COALESCE(@Longitude, Longitude),
            StaffUserId = @StaffUserId, ScheduledDate = @ScheduledDate, NextVisitDueDate = @ScheduledDate,
            ApprovalStatus = 'approved', AssignmentStatus = 'approved', RouteStopOrder = @StopOrder,
            ApprovedBy = @ApprovedBy, ApprovedAt = SYSDATETIME(), LastModifiedDate = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE AssignmentId = @AssignmentId
      `);
      resultRow = u.recordset[0];
      updatedCount++;
    } else {
      r.input('CampaignId', sql.Int, campaignId)
        .input('ConfigId', sql.BigInt, configId)
        .input('DoctorId', sql.Int, doctorId)
        .input('TargetType', sql.NVarChar, targetType)
        .input('TargetName', sql.NVarChar, targetName)
        .input('VisitFrequencyDays', sql.Int, numberOrNull(row?.visitFrequencyDays) || 30)
        .input('CreatedBy', sql.Int, req.user?.userId || null);
      const ins = await r.query(`
        INSERT INTO dbo.PharmacyFlyer_Assignment (
          CampaignId, ConfigId, DoctorId, TargetType, TargetName, Specialty, NpiNumber,
          AddressStreet, AddressCity, AddressState, AddressZip, Phone, Latitude, Longitude,
          StaffUserId, ScheduledDate, VisitFrequencyDays, NextVisitDueDate, CreatedBy,
          ApprovalStatus, AssignmentStatus, RouteStopOrder, ApprovedBy, ApprovedAt
        )
        OUTPUT INSERTED.*
        VALUES (
          @CampaignId, @ConfigId, @DoctorId, @TargetType, @TargetName, @Specialty, @NpiNumber,
          @AddressStreet, @AddressCity, @AddressState, @AddressZip, @Phone, @Latitude, @Longitude,
          @StaffUserId, @ScheduledDate, @VisitFrequencyDays, @ScheduledDate, @CreatedBy,
          'approved', 'approved', @StopOrder, @ApprovedBy, SYSDATETIME()
        )
      `);
      resultRow = ins.recordset[0];
      createdCount++;
    }

    if (resultRow) ordered.push(resultRow);
  }

  if (!ordered.length) return res.status(400).json({ message: 'No valid stops to route.' });

  // 3. Create one route and lay down stops in the exact optimized order.
  const route = await insertWorkflowRoute(pool, {
    routeName,
    staffUserId,
    routeDate,
    startAddress: startAddress || null,
    startLatitude: startLat,
    startLongitude: startLng,
    createdBy: req.user?.userId || null
  });

  let stopCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const stop = ordered[i];
    stop.RouteStopOrder = i + 1;
    await insertWorkflowRouteStop(pool, route.RouteId, stop);
    await pool.request()
      .input('RouteId', sql.BigInt, route.RouteId)
      .input('AssignmentId', sql.BigInt, stop.AssignmentId)
      .input('StopOrder', sql.Int, i + 1)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET RouteId = @RouteId, RouteStopOrder = @StopOrder, AssignmentStatus = 'routed',
            ScheduledDate = COALESCE(ScheduledDate, @RouteDate), LastModifiedDate = SYSDATETIME()
        WHERE AssignmentId = @AssignmentId
      `);
    stopCount++;
  }

  res.status(201).json({ route, stopCount, createdCount, updatedCount, skippedCount });
});

// ─── Saved / available routes (unassigned until a person is chosen) ──────────
// A "location" belongs to at most one non-cancelled route at any time. This helper
// returns the doctor ids + name|zip keys that are already taken by existing routes.
async function getRoutedLocationKeys(pool: Awaited<ReturnType<typeof getPool>>, excludeRouteId?: number | null) {
  const ids = new Set<number>();
  const names = new Set<string>();
  if (!(await hasTable('PharmacyFlyer_Route')) || !(await hasTable('PharmacyFlyer_Assignment'))) {
    return { ids, names };
  }
  const result = await pool.request()
    .input('ExcludeRouteId', sql.BigInt, excludeRouteId ?? null)
    .query(`
      SELECT DISTINCT a.DoctorId, a.TargetName, a.AddressZip
      FROM dbo.PharmacyFlyer_Assignment a
      INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = a.RouteId
      WHERE ISNULL(r.Status, '') <> 'cancelled'
        AND (@ExcludeRouteId IS NULL OR r.RouteId <> @ExcludeRouteId)
    `);
  for (const row of result.recordset) {
    if (row.DoctorId != null) ids.add(Number(row.DoctorId));
    else names.add(`${String(row.TargetName || '').trim().toLowerCase()}|${String(row.AddressZip || '').trim()}`);
  }
  return { ids, names };
}

function locationKey(doctorId: number | null, targetName: string, zip: string | null) {
  return doctorId != null
    ? `id:${doctorId}`
    : `nm:${String(targetName || '').trim().toLowerCase()}|${String(zip || '').trim()}`;
}

// Normalize a street address for "same building" comparison: upper-case, strip
// suite/unit qualifiers and punctuation, collapse whitespace. Two stops that
// resolve to the same normalized street + ZIP are treated as one location.
const STOP_SUITE_RE = /[,\s]*(?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*#?\s*\w+\b/gi;
function normalizeStopStreet(street?: string | null): string {
  let s = ' ' + String(street || '').toUpperCase().trim() + ' ';
  s = s.replace(STOP_SUITE_RE, ' ');
  s = s.replace(/[#.,]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// Group key for collapsing route stops by physical location. The street address
// is authoritative (different streets = different locations) so doctors are not
// merged just because their addresses fell back to the same ZIP-centroid
// coordinate. Coordinates are only used when there is no street at all.
function stopLocationKey(row: { AddressStreet?: any; AddressZip?: any; Latitude?: any; Longitude?: any }): string {
  const street = normalizeStopStreet(row.AddressStreet);
  const zip = String(row.AddressZip || '').trim();
  if (street) return `addr:${street}|${zip}`;
  if (row.Latitude != null && row.Longitude != null) {
    return `geo:${Number(row.Latitude).toFixed(4)},${Number(row.Longitude).toFixed(4)}`;
  }
  return `zip:${zip}`;
}

// Locations already taken by existing routes — used by the planner to avoid overlap.
clientWorkflowRoutes.get('/routes/routed-locations', async (_req, res) => {
  const pool = await getPool();
  const { ids, names } = await getRoutedLocationKeys(pool);
  res.json({ doctorIds: Array.from(ids), nameKeys: Array.from(names) });
});

// Save the optimized route WITHOUT assigning it to anyone. Skips any location that
// already belongs to another route so no two routes ever share a location.
clientWorkflowRoutes.post('/routes/save', async (req, res) => {
  const routeDate = dateOrToday(req.body?.scheduledDate || req.body?.routeDate);
  const routeName = clean(req.body?.routeName) || `RT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const configId = numberOrNull(req.body?.configId);
  const startAddress = clean(req.body?.startAddress);
  const startLat = numberOrNull(req.body?.startLatitude);
  const startLng = numberOrNull(req.body?.startLongitude);
  const doctorAssignments = Array.isArray(req.body?.doctorAssignments) ? req.body.doctorAssignments : [];
  if (!doctorAssignments.length) return res.status(400).json({ message: 'doctorAssignments is required.' });

  try {
  const pool = await getPool();
  const taken = await getRoutedLocationKeys(pool);
  const seen = new Set<string>();

  let skippedOverlap = 0, skippedInvalid = 0;
  const ordered: any[] = [];

  for (let i = 0; i < doctorAssignments.length; i++) {
    const row = doctorAssignments[i];
    const campaignId = numberOrNull(row?.campaignId);
    const doctorId = numberOrNull(row?.doctorId);
    const targetName = clean(row?.targetName) || clean(row?.doctorName);
    const targetType = clean(row?.targetType) || 'Doctor';
    const zip = clean(row?.addressZip);
    if (!campaignId || !targetName) { skippedInvalid++; continue; }

    // Overlap guard: skip locations already in ANOTHER route. A doctor can still
    // carry several flyers (one assignment per doctor+campaign) within THIS route, so
    // the in-batch dedup key includes the campaign — only an exact (doctor+campaign)
    // duplicate is dropped, not a second flyer for the same doctor.
    const dedupKey = `${locationKey(doctorId, targetName, zip)}|c:${campaignId}`;
    const nameKey = `${targetName.trim().toLowerCase()}|${(zip || '').trim()}`;
    const isTaken = (doctorId != null && taken.ids.has(doctorId)) || (doctorId == null && taken.names.has(nameKey));
    if (isTaken || seen.has(dedupKey)) { skippedOverlap++; continue; }
    seen.add(dedupKey);

    const stopOrder = numberOrNull(row?.routeStopOrder) ?? (ordered.length + 1);
    const ins = await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('ConfigId', sql.BigInt, configId)
      .input('DoctorId', sql.Int, doctorId)
      .input('TargetType', sql.NVarChar, targetType)
      .input('TargetName', sql.NVarChar, targetName)
      .input('Specialty', sql.NVarChar, clean(row?.specialty))
      .input('NpiNumber', sql.NVarChar, clean(row?.npiNumber))
      .input('AddressStreet', sql.NVarChar, clean(row?.addressStreet))
      .input('AddressCity', sql.NVarChar, clean(row?.addressCity))
      .input('AddressState', sql.NVarChar, clean(row?.addressState) || 'FL')
      .input('AddressZip', sql.NVarChar, zip)
      .input('Phone', sql.NVarChar, clean(row?.phone))
      .input('Latitude', sql.Decimal(10, 7), numberOrNull(row?.latitude))
      .input('Longitude', sql.Decimal(10, 7), numberOrNull(row?.longitude))
      .input('ScheduledDate', sql.Date, routeDate)
      .input('VisitFrequencyDays', sql.Int, numberOrNull(row?.visitFrequencyDays) || 30)
      .input('StopOrder', sql.Int, stopOrder)
      .input('CreatedBy', sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.PharmacyFlyer_Assignment (
          CampaignId, ConfigId, DoctorId, TargetType, TargetName, Specialty, NpiNumber,
          AddressStreet, AddressCity, AddressState, AddressZip, Phone, Latitude, Longitude,
          StaffUserId, ScheduledDate, VisitFrequencyDays, NextVisitDueDate, CreatedBy,
          ApprovalStatus, AssignmentStatus, RouteStopOrder, ApprovedBy, ApprovedAt
        )
        OUTPUT INSERTED.*
        VALUES (
          @CampaignId, @ConfigId, @DoctorId, @TargetType, @TargetName, @Specialty, @NpiNumber,
          @AddressStreet, @AddressCity, @AddressState, @AddressZip, @Phone, @Latitude, @Longitude,
          NULL, @ScheduledDate, @VisitFrequencyDays, @ScheduledDate, @CreatedBy,
          'approved', 'planned', @StopOrder, @CreatedBy, SYSDATETIME()
        )
      `);
    if (ins.recordset[0]) ordered.push(ins.recordset[0]);
  }

  if (!ordered.length) {
    return res.status(409).json({
      message: 'No new locations to save — all of them already belong to existing routes.',
      savedCount: 0, skippedOverlap, skippedInvalid
    });
  }

  const route = await insertWorkflowRoute(pool, {
    routeName,
    staffUserId: null as any, // unassigned route — column is nullable
    routeDate,
    startAddress: startAddress || null,
    startLatitude: startLat,
    startLongitude: startLng,
    createdBy: req.user?.userId || null
  });

  // Mark the route as a saved/unassigned draft (insertWorkflowRoute defaults Status to
  // 'assigned'). 'draft' is the allowed CHECK-constraint value for "saved, no person yet".
  await pool.request()
    .input('RouteId', sql.BigInt, route.RouteId)
    .query(`UPDATE dbo.PharmacyFlyer_Route SET Status = 'draft', StaffUserId = NULL, DistributorUserId = NULL WHERE RouteId = @RouteId`);

  // Stop order is per physical location: flyers that sit at the same address share
  // the same stop number so the route reads as "locations", not "flyers".
  const locationOrder = new Map<string, number>();
  let nextOrder = 0;
  for (let i = 0; i < ordered.length; i++) {
    const stop = ordered[i];
    const locKey = stopLocationKey(stop);
    if (!locationOrder.has(locKey)) locationOrder.set(locKey, ++nextOrder);
    const order = locationOrder.get(locKey)!;
    stop.RouteStopOrder = order;
    await insertWorkflowRouteStop(pool, route.RouteId, stop);
    await pool.request()
      .input('RouteId', sql.BigInt, route.RouteId)
      .input('AssignmentId', sql.BigInt, stop.AssignmentId)
      .input('StopOrder', sql.Int, order)
      .query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET RouteId = @RouteId, RouteStopOrder = @StopOrder, LastModifiedDate = SYSDATETIME()
        WHERE AssignmentId = @AssignmentId
      `);
  }

  res.status(201).json({
    route: { ...route, Status: 'draft' },
    savedCount: locationOrder.size,       // distinct locations
    assignmentCount: ordered.length,      // total flyer drops
    skippedOverlap,
    skippedInvalid
  });
  } catch (err) {
    console.error('[routes/save] failed:', err);
    res.status(500).json({ message: 'Could not save route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

// List saved routes (unassigned + assigned), newest first.
clientWorkflowRoutes.get('/routes/saved', async (_req, res) => {
  const pool = await getPool();
  if (!(await hasTable('PharmacyFlyer_Route'))) return res.json({ routes: [] });
  const result = await pool.request().query(`
    SELECT
      r.RouteId, r.RouteName, r.RouteDate, r.Status, r.StaffUserId, r.CreatedDate,
      CONCAT(ISNULL(u.User_FirstName, ''), ' ', ISNULL(u.User_LastName, '')) AS StaffName
    FROM dbo.PharmacyFlyer_Route r
    LEFT JOIN dbo.Master_User u ON u.ID = r.StaffUserId
    WHERE ISNULL(r.Status, '') <> 'cancelled'
    ORDER BY r.CreatedDate DESC, r.RouteId DESC
  `);

  // Distinct location / doctor / flyer-drop counts per route, computed with the same
  // address-first key as the detail view so the two never disagree. A doctor can carry
  // several flyers (one RouteStop row each), so flyer drops >= doctors >= locations.
  const stopRows = await pool.request().query(`
    SELECT s.RouteId, s.AddressStreet, s.AddressZip, s.Latitude, s.Longitude,
           s.TargetName, a.DoctorId, a.CampaignId
    FROM dbo.PharmacyFlyer_RouteStop s
    INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
    LEFT JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = s.AssignmentId
    WHERE ISNULL(r.Status, '') <> 'cancelled'
  `);
  const locationsByRoute = new Map<number, Set<string>>();
  const doctorsByRoute = new Map<number, Set<string>>();
  // A "flyer drop" is one campaign delivered to one physical location, regardless
  // of how many doctors sit there. So a location with 5 doctors and 2 campaigns is
  // 2 drops, not 10. Count distinct (location + campaign) pairs per route.
  const dropsByRoute = new Map<number, Set<string>>();
  for (const row of stopRows.recordset) {
    const rid = Number(row.RouteId);
    if (!locationsByRoute.has(rid)) { locationsByRoute.set(rid, new Set()); doctorsByRoute.set(rid, new Set()); dropsByRoute.set(rid, new Set()); }
    const locKey = stopLocationKey(row);
    locationsByRoute.get(rid)!.add(locKey);
    const docKey = row.DoctorId != null
      ? `id:${row.DoctorId}`
      : `nm:${String(row.TargetName || '').trim().toLowerCase()}`;
    doctorsByRoute.get(rid)!.add(docKey);
    dropsByRoute.get(rid)!.add(`${locKey}|c:${row.CampaignId ?? ''}`);
  }

  res.json({
    routes: result.recordset.map((r: Record<string, any>) => ({
      ...r,
      StopCount: locationsByRoute.get(Number(r.RouteId))?.size ?? 0,
      DoctorCount: doctorsByRoute.get(Number(r.RouteId))?.size ?? 0,
      FlyerCount: dropsByRoute.get(Number(r.RouteId))?.size ?? 0,
      StaffName: String(r.StaffName || '').trim() || null
    }))
  });
});

// Detail (ordered stops) for one saved route.
clientWorkflowRoutes.get('/routes/saved/:routeId', async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  const pool = await getPool();
  const routeRes = await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`
      SELECT r.*, CONCAT(ISNULL(u.User_FirstName,''),' ',ISNULL(u.User_LastName,'')) AS StaffName
      FROM dbo.PharmacyFlyer_Route r
      LEFT JOIN dbo.Master_User u ON u.ID = r.StaffUserId
      WHERE r.RouteId = @RouteId
    `);
  const route = routeRes.recordset[0];
  if (!route) return res.status(404).json({ message: 'Route not found.' });

  const hasDelivery = await hasTable('PharmacyFlyer_Delivery');
  const hasDeliveryPhoto = await hasTable('PharmacyFlyer_DeliveryPhoto');
  // Pull the latest delivery (and whether it has a proof photo) for each stop so
  // the admin can see which locations are completed and view the proof.
  const proofJoin = hasDelivery ? `
      OUTER APPLY (
        SELECT TOP 1 dlv.DeliveryId, dlv.SubmittedAt
        FROM dbo.PharmacyFlyer_Delivery dlv
        WHERE dlv.AssignmentId = s.AssignmentId
        ORDER BY dlv.DeliveryId DESC
      ) d` : '';
  const photoSelect = hasDelivery
    ? (hasDeliveryPhoto
        ? `d.DeliveryId, d.SubmittedAt, CASE WHEN ph.PhotoId IS NULL THEN 0 ELSE 1 END AS HasPhoto`
        : `d.DeliveryId, d.SubmittedAt, CAST(0 AS BIT) AS HasPhoto`)
    : `CAST(NULL AS BIGINT) AS DeliveryId, CAST(NULL AS DATETIME2) AS SubmittedAt, CAST(0 AS BIT) AS HasPhoto`;
  const photoJoin = (hasDelivery && hasDeliveryPhoto) ? `
      OUTER APPLY (
        SELECT TOP 1 p.PhotoId FROM dbo.PharmacyFlyer_DeliveryPhoto p WHERE p.DeliveryId = d.DeliveryId
      ) ph` : '';

  const stopsRes = await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`
      SELECT s.RouteStopId, s.StopOrder, s.TargetName, s.AddressStreet, s.AddressCity, s.AddressZip,
             s.Latitude, s.Longitude, s.StopStatus,
             a.AssignmentId, a.AssignmentStatus, a.Specialty, a.DoctorId, c.CampaignName, c.FlyerTitle,
             ${photoSelect}
      FROM dbo.PharmacyFlyer_RouteStop s
      LEFT JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = s.AssignmentId
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId${proofJoin}${photoJoin}
      WHERE s.RouteId = @RouteId
      ORDER BY s.StopOrder
    `);

  // Each (doctor × flyer) is stored as its own RouteStop row. Collapse them into one
  // entry per physical location; within a location group rows by doctor and collect the
  // distinct flyers that doctor must receive. A location also exposes the union of every
  // flyer to drop there.
  const flyerLabel = (campaignName?: string | null, flyerTitle?: string | null) =>
    String(flyerTitle || campaignName || '').trim();
  const rowIsCompleted = (row: any) =>
    String(row.AssignmentStatus || '').toLowerCase() === 'completed' ||
    String(row.StopStatus || '').toLowerCase() === 'completed' ||
    row.DeliveryId != null;

  const locationMap = new Map<string, any>();
  for (const row of stopsRes.recordset) {
    const key = stopLocationKey(row);
    let loc = locationMap.get(key);
    if (!loc) {
      loc = {
        RouteStopId: row.RouteStopId,
        StopOrder: row.StopOrder,
        AddressStreet: row.AddressStreet,
        AddressCity: row.AddressCity,
        AddressZip: row.AddressZip,
        Latitude: row.Latitude,
        Longitude: row.Longitude,
        doctorMap: new Map<string, any>(),
        flyerSet: new Map<string, any>(),
        totalStops: 0,
        completedStops: 0,
        proofs: new Map<number, any>()
      };
      locationMap.set(key, loc);
    }
    const completed = rowIsCompleted(row);
    loc.totalStops += 1;
    if (completed) loc.completedStops += 1;
    if (row.HasPhoto && row.DeliveryId != null && !loc.proofs.has(Number(row.DeliveryId))) {
      loc.proofs.set(Number(row.DeliveryId), { deliveryId: Number(row.DeliveryId), submittedAt: row.SubmittedAt });
    }

    const docKey = row.DoctorId != null
      ? `id:${row.DoctorId}`
      : `nm:${String(row.TargetName || '').trim().toLowerCase()}`;
    let doc = loc.doctorMap.get(docKey);
    if (!doc) {
      doc = {
        RouteStopId: row.RouteStopId,
        DoctorId: row.DoctorId,
        TargetName: row.TargetName,
        Specialty: row.Specialty,
        flyers: [] as any[],
        totalStops: 0,
        completedStops: 0
      };
      loc.doctorMap.set(docKey, doc);
    }
    doc.totalStops += 1;
    if (completed) doc.completedStops += 1;
    const flyer = { CampaignName: row.CampaignName, FlyerTitle: row.FlyerTitle };
    const fLabel = flyerLabel(row.CampaignName, row.FlyerTitle);
    if (fLabel && !doc.flyers.some((f: any) => flyerLabel(f.CampaignName, f.FlyerTitle) === fLabel)) {
      doc.flyers.push(flyer);
    }
    if (fLabel && !loc.flyerSet.has(fLabel)) loc.flyerSet.set(fLabel, flyer);
  }
  const stops = Array.from(locationMap.values()).map((loc, idx) => {
    const doctors = (Array.from(loc.doctorMap.values()) as any[]).map((d) => ({
      RouteStopId: d.RouteStopId,
      DoctorId: d.DoctorId,
      TargetName: d.TargetName,
      Specialty: d.Specialty,
      flyers: d.flyers,
      completed: d.totalStops > 0 && d.completedStops >= d.totalStops
    }));
    return {
      RouteStopId: loc.RouteStopId,
      StopOrder: idx + 1,
      AddressStreet: loc.AddressStreet,
      AddressCity: loc.AddressCity,
      AddressZip: loc.AddressZip,
      Latitude: loc.Latitude,
      Longitude: loc.Longitude,
      doctors,
      flyers: Array.from(loc.flyerSet.values()),
      DoctorCount: doctors.length,
      FlyerCount: loc.flyerSet.size,
      TargetName: doctors[0]?.TargetName || null,
      completed: loc.totalStops > 0 && loc.completedStops >= loc.totalStops,
      completedStops: loc.completedStops,
      totalStops: loc.totalStops,
      proofs: Array.from(loc.proofs.values())
    };
  });

  const distinctDoctors = new Set(
    stopsRes.recordset.map((r: any) => (r.DoctorId != null
      ? `id:${r.DoctorId}`
      : `nm:${String(r.TargetName || '').trim().toLowerCase()}`))
  );

  res.json({
    route: { ...route, StaffName: String(route.StaffName || '').trim() || null },
    stops,
    stopCount: stops.length,
    completedStopCount: stops.filter((s) => s.completed).length,
    doctorCount: distinctDoctors.size
  });
});

// Assign a saved route to a person → becomes visible in their mobile Today Route.
clientWorkflowRoutes.post('/routes/:routeId/assign', async (req, res) => {
  const routeId = Number(req.params.routeId);
  const staffUserId = numberOrNull(req.body?.staffUserId ?? req.body?.distributorUserId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  if (!staffUserId) return res.status(400).json({ message: 'staffUserId is required.' });

  try {
  const pool = await getPool();
  const existing = await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`SELECT RouteId, RouteDate FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
  if (!existing.recordset[0]) return res.status(404).json({ message: 'Route not found.' });

  // The mobile "Today Route" only shows routes whose RouteDate is today (Florida
  // time). So unless the admin explicitly schedules a date, assigning a route
  // sets its RouteDate to today so it shows up for the assignee right away.
  const routeDate = (req.body?.routeDate || req.body?.scheduledDate)
    ? dateOrToday(req.body?.routeDate || req.body?.scheduledDate)
    : toFloridaDateString();

  await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .input('StaffUserId', sql.Int, staffUserId)
    .input('RouteDate', sql.Date, routeDate)
    .query(`
      UPDATE dbo.PharmacyFlyer_Route
      SET StaffUserId = @StaffUserId, DistributorUserId = @StaffUserId,
          RouteDate = @RouteDate, Status = 'assigned'
      WHERE RouteId = @RouteId;

      UPDATE dbo.PharmacyFlyer_Assignment
      SET StaffUserId = @StaffUserId, ScheduledDate = @RouteDate,
          ApprovalStatus = 'approved', AssignmentStatus = 'routed', LastModifiedDate = SYSDATETIME()
      WHERE RouteId = @RouteId
        AND ISNULL(AssignmentStatus,'') NOT IN ('completed','skipped','checked_in');
    `);

  res.json({ ok: true, routeId, staffUserId, routeDate, status: 'assigned' });
  } catch (err) {
    console.error('[routes/assign] failed:', err);
    res.status(500).json({ message: 'Could not assign route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Remove the person from a route (keeps the route + its locations reserved).
clientWorkflowRoutes.post('/routes/:routeId/unassign', async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  try {
  const pool = await getPool();
  const existing = await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`SELECT RouteId FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
  if (!existing.recordset[0]) return res.status(404).json({ message: 'Route not found.' });

  await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`
      UPDATE dbo.PharmacyFlyer_Route
      SET StaffUserId = NULL, DistributorUserId = NULL, Status = 'draft'
      WHERE RouteId = @RouteId;

      UPDATE dbo.PharmacyFlyer_Assignment
      SET StaffUserId = NULL, AssignmentStatus = 'planned', LastModifiedDate = SYSDATETIME()
      WHERE RouteId = @RouteId
        AND ISNULL(AssignmentStatus,'') NOT IN ('completed','skipped','checked_in');
    `);

  res.json({ ok: true, routeId, status: 'draft' });
  } catch (err) {
    console.error('[routes/unassign] failed:', err);
    res.status(500).json({ message: 'Could not unassign route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Mark a route as completed (the assigned person finished it). Completed routes still
// reserve their locations; delete the route if those locations should become available.
clientWorkflowRoutes.post('/routes/:routeId/complete', async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  try {
  const pool = await getPool();
  const existing = await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`SELECT RouteId FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
  if (!existing.recordset[0]) return res.status(404).json({ message: 'Route not found.' });

  await pool.request()
    .input('RouteId', sql.BigInt, routeId)
    .query(`
      UPDATE dbo.PharmacyFlyer_Route SET Status = 'completed' WHERE RouteId = @RouteId;

      IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop','U') IS NOT NULL
        UPDATE dbo.PharmacyFlyer_RouteStop
        SET StopStatus = 'completed', Status = 'completed'
        WHERE RouteId = @RouteId AND ISNULL(StopStatus,'') NOT IN ('skipped');

      UPDATE dbo.PharmacyFlyer_Assignment
      SET AssignmentStatus = 'completed', CompletedAt = SYSDATETIME(), LastModifiedDate = SYSDATETIME()
      WHERE RouteId = @RouteId AND ISNULL(AssignmentStatus,'') NOT IN ('skipped');
    `);

  res.json({ ok: true, routeId, status: 'completed' });
  } catch (err) {
    console.error('[routes/complete] failed:', err);
    res.status(500).json({ message: 'Could not complete route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Restart a route: wipe ALL delivery progress and proof photos for this route so
// it can be run again from scratch. Keeps the route, its stops, and its assignee
// (if any) — only the progress (deliveries, photos, completed/checked-in status)
// is cleared. Locations stay reserved to this route the whole time.
clientWorkflowRoutes.post('/routes/:routeId/restart', async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  try {
    const pool = await getPool();
    const existing = await pool.request()
      .input('RouteId', sql.BigInt, routeId)
      .query(`SELECT RouteId FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId`);
    if (!existing.recordset[0]) return res.status(404).json({ message: 'Route not found.' });

    const result = await pool.request()
      .input('RouteId', sql.BigInt, routeId)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @photos INT = 0, @deliveries INT = 0;

        -- Proof photos attached to this route's deliveries.
        IF OBJECT_ID('dbo.PharmacyFlyer_DeliveryPhoto','U') IS NOT NULL
           AND OBJECT_ID('dbo.PharmacyFlyer_Delivery','U') IS NOT NULL
        BEGIN
          DELETE ph FROM dbo.PharmacyFlyer_DeliveryPhoto ph
          INNER JOIN dbo.PharmacyFlyer_Delivery d ON d.DeliveryId = ph.DeliveryId
          INNER JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = d.AssignmentId
          WHERE a.RouteId = @RouteId;
          SET @photos = @@ROWCOUNT;
        END

        -- The deliveries themselves.
        IF OBJECT_ID('dbo.PharmacyFlyer_Delivery','U') IS NOT NULL
        BEGIN
          DELETE d FROM dbo.PharmacyFlyer_Delivery d
          INNER JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = d.AssignmentId
          WHERE a.RouteId = @RouteId;
          SET @deliveries = @@ROWCOUNT;
        END

        -- Optional route-stop proof / check-in tables.
        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof','U') IS NOT NULL
          DELETE p FROM dbo.PharmacyFlyer_RouteStopProof p
          INNER JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteStopId = p.RouteStopId WHERE s.RouteId = @RouteId;
        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn','U') IS NOT NULL
          DELETE ci FROM dbo.PharmacyFlyer_RouteStopCheckIn ci
          INNER JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteStopId = ci.RouteStopId WHERE s.RouteId = @RouteId;

        -- Reset every stop back to its initial state.
        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStop','U') IS NOT NULL
          UPDATE dbo.PharmacyFlyer_RouteStop
          SET StopStatus = 'pending', Status = 'pending'
          WHERE RouteId = @RouteId;

        -- Reset assignment progress: keep them routed if a person is assigned,
        -- otherwise back to planned. Clears completion + check-in markers.
        UPDATE a
        SET AssignmentStatus = CASE WHEN r.StaffUserId IS NOT NULL THEN 'routed' ELSE 'planned' END,
            CompletedAt = NULL,
            CheckInStatus = NULL,
            LastModifiedDate = SYSDATETIME()
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = a.RouteId
        WHERE a.RouteId = @RouteId AND ISNULL(a.AssignmentStatus,'') <> 'skipped';

        -- A previously completed route returns to assigned (or draft if no one is on it).
        UPDATE dbo.PharmacyFlyer_Route
        SET Status = CASE WHEN StaffUserId IS NOT NULL THEN 'assigned' ELSE 'draft' END
        WHERE RouteId = @RouteId;

        COMMIT TRANSACTION;
        SELECT @photos AS photos, @deliveries AS deliveries;
      `);
    const stats = result.recordset?.[0] || {};
    res.json({
      ok: true,
      routeId,
      deletedPhotos: Number(stats.photos || 0),
      deletedDeliveries: Number(stats.deliveries || 0)
    });
  } catch (err) {
    console.error('[routes/restart] failed:', err);
    res.status(500).json({ message: 'Could not restart route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Delete a saved route entirely, freeing its locations for future routes.
clientWorkflowRoutes.delete('/routes/:routeId', async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isFinite(routeId)) return res.status(400).json({ message: 'Invalid routeId.' });
  const pool = await getPool();
  try {
    await pool.request()
      .input('RouteId', sql.BigInt, routeId)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopProof','U') IS NOT NULL
          DELETE p FROM dbo.PharmacyFlyer_RouteStopProof p
          INNER JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteStopId = p.RouteStopId WHERE s.RouteId = @RouteId;
        IF OBJECT_ID('dbo.PharmacyFlyer_RouteStopCheckIn','U') IS NOT NULL
          DELETE ci FROM dbo.PharmacyFlyer_RouteStopCheckIn ci
          INNER JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteStopId = ci.RouteStopId WHERE s.RouteId = @RouteId;
        DELETE FROM dbo.PharmacyFlyer_RouteStop WHERE RouteId = @RouteId;
        DELETE FROM dbo.PharmacyFlyer_Assignment WHERE RouteId = @RouteId;
        DELETE FROM dbo.PharmacyFlyer_Route WHERE RouteId = @RouteId;
        COMMIT TRANSACTION;
      `);
    res.json({ ok: true, routeId, deleted: true });
  } catch (err) {
    console.error('[routes/delete] failed:', err);
    res.status(500).json({ message: 'Could not delete route.', detail: err instanceof Error ? err.message : String(err) });
  }
});

clientWorkflowRoutes.post('/assignments/reject', async (req, res) => {
  const assignmentIds = Array.isArray(req.body?.assignmentIds)
    ? req.body.assignmentIds.map(Number).filter(Number.isFinite)
    : [];
  if (!assignmentIds.length) return res.status(400).json({ message: 'assignmentIds array is required.' });

  const pool = await getPool();
  for (const assignmentId of assignmentIds) {
    await pool.request()
      .input('AssignmentId', sql.BigInt, assignmentId)
      .input('RejectedBy', sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET ApprovalStatus = 'rejected', AssignmentStatus = 'skipped', RejectedBy = @RejectedBy, RejectedAt = SYSDATETIME(), LastModifiedDate = SYSDATETIME()
        WHERE AssignmentId = @AssignmentId
      `);
  }
  res.json({ rejectedCount: assignmentIds.length });
});

function legacyTargetType(value: unknown) {
  return normalizeForCompare(value) === 'PHARMACY' ? 'pharmacy' : 'doctor';
}

async function insertWorkflowRouteStop(pool: Awaited<ReturnType<typeof getPool>>, routeId: number | bigint, stop: any) {
  const stopAddress = [stop.AddressStreet, stop.AddressCity, stop.AddressState, stop.AddressZip].filter(Boolean).join(', ');
  const columns: string[] = [];
  const values: string[] = [];
  const request = pool.request();

  const add = async (column: string, param: string, type: any, value: unknown) => {
    if (!(await hasColumn('PharmacyFlyer_RouteStop', column))) return;
    columns.push(column);
    values.push(param);
    request.input(param.replace('@', ''), type, value);
  };

  await add('RouteId', '@RouteId', sql.BigInt, routeId);
  await add('AssignmentId', '@AssignmentId', sql.BigInt, stop.AssignmentId);
  await add('StopOrder', '@StopOrder', sql.Int, stop.RouteStopOrder);
  await add('TargetName', '@TargetName', sql.NVarChar, stop.TargetName);
  await add('AddressStreet', '@AddressStreet', sql.NVarChar, stop.AddressStreet);
  await add('AddressCity', '@AddressCity', sql.NVarChar, stop.AddressCity);
  await add('AddressState', '@AddressState', sql.NVarChar, stop.AddressState);
  await add('AddressZip', '@AddressZip', sql.NVarChar, stop.AddressZip);
  await add('Latitude', '@Latitude', sql.Decimal(10, 7), numberOrNull(stop.Latitude));
  await add('Longitude', '@Longitude', sql.Decimal(10, 7), numberOrNull(stop.Longitude));
  await add('EstimatedDistanceFromPreviousMiles', '@EstimatedDistanceFromPreviousMiles', sql.Decimal(8, 2), stop.EstimatedDistanceFromPreviousMiles);
  await add('TargetType', '@TargetType', sql.VarChar, legacyTargetType(stop.TargetType));
  await add('DoctorId', '@DoctorId', sql.Int, numberOrNull(stop.DoctorId));
  await add('CampaignId', '@CampaignId', sql.Int, numberOrNull(stop.CampaignId));
  await add('StopLabel', '@StopLabel', sql.NVarChar, stop.TargetName);
  await add('StopAddress', '@StopAddress', sql.NVarChar, stopAddress || stop.TargetName);
  await add('StopLatitude', '@StopLatitude', sql.Decimal(10, 7), numberOrNull(stop.Latitude));
  await add('StopLongitude', '@StopLongitude', sql.Decimal(10, 7), numberOrNull(stop.Longitude));
  await add('Status', '@Status', sql.VarChar, 'pending');
  await add('StopStatus', '@StopStatus', sql.NVarChar, 'pending');

  if (!columns.length) throw new Error('PharmacyFlyer_RouteStop table is missing required columns.');

  const result = await request.query(`
    INSERT INTO dbo.PharmacyFlyer_RouteStop (${columns.join(', ')})
    OUTPUT INSERTED.*
    VALUES (${values.join(', ')})
  `);
  return result.recordset[0];
}

async function insertWorkflowRoute(pool: Awaited<ReturnType<typeof getPool>>, data: {
  routeName: string;
  staffUserId: number;
  routeDate: string;
  startAddress: string | null;
  startLatitude: number | null;
  startLongitude: number | null;
  createdBy: number | null;
}) {
  const columns: string[] = [];
  const values: string[] = [];
  const request = pool.request();

  const add = async (column: string, param: string, type: any, value: unknown) => {
    if (!(await hasColumn('PharmacyFlyer_Route', column))) return;
    columns.push(column);
    values.push(param);
    request.input(param.replace('@', ''), type, value);
  };

  await add('RouteName', '@RouteName', sql.NVarChar, data.routeName);
  await add('StaffUserId', '@StaffUserId', sql.Int, data.staffUserId);
  await add('DistributorUserId', '@DistributorUserId', sql.Int, data.staffUserId);
  await add('RouteDate', '@RouteDate', sql.Date, data.routeDate);
  await add('StartAddress', '@StartAddress', sql.NVarChar, data.startAddress);
  await add('StartLatitude', '@StartLatitude', sql.Decimal(10, 7), data.startLatitude);
  await add('StartLongitude', '@StartLongitude', sql.Decimal(10, 7), data.startLongitude);
  await add('CreatedBy', '@CreatedBy', sql.Int, data.createdBy);
  await add('Status', '@Status', sql.VarChar, 'assigned');
  await add('StartType', '@StartType', sql.VarChar, 'custom');

  const result = await request.query(`
    INSERT INTO dbo.PharmacyFlyer_Route (${columns.join(', ')})
    OUTPUT INSERTED.*
    VALUES (${values.join(', ')})
  `);
  return result.recordset[0];
}


function routeCapacityFromBody(body: any) {
  const rawWorkType = (clean(body?.workType) || '').toLowerCase();
  const workType = rawWorkType === 'part-time' || rawWorkType === 'custom' ? rawWorkType : 'full-time';
  const shiftHours = Math.max(1, Math.min(Number(body?.shiftHours) || (workType === 'part-time' ? 4 : 8), 12));
  const maxRouteMinutes = Math.max(
    60,
    Math.min(
      Number(body?.maxRouteMinutes) || (workType === 'part-time' ? 195 : workType === 'custom' ? Math.round(shiftHours * 60 - 75) : 390),
      720
    )
  );
  const defaultDailyLimit = workType === 'part-time' ? 20 : workType === 'custom' ? Math.max(8, Math.floor(maxRouteMinutes / 12)) : 40;
  const hardMaxStops = Math.max(1, Math.min(Number(body?.hardMaxStops) || (workType === 'part-time' ? 25 : 50), 75));
  const requestedStops = Math.max(1, Number(body?.maxStops) || defaultDailyLimit);
  const timeBasedLimit = Math.max(1, Math.floor(maxRouteMinutes / 12));
  const maxStops = Math.max(1, Math.min(requestedStops, defaultDailyLimit, hardMaxStops, timeBasedLimit));

  return {
    workType,
    shiftHours,
    maxRouteMinutes,
    defaultDailyLimit,
    hardMaxStops,
    timeBasedLimit,
    maxStops,
    assumptions: {
      averageMinutesPerMedicalDrop: 12,
      fullTimeRouteMinutes: 390,
      partTimeRouteMinutes: 195,
      fullTimeDefaultStops: 40,
      partTimeDefaultStops: 20
    }
  };
}

type AutoAssignDistributor = {
  staffUserId: number;
  workType: string;
  shiftHours: number;
  startType: string;
  startLatitude: number | null;
  startLongitude: number | null;
  startAddress: string | null;
  capacityMinutes: number;
  remainingMinutes: number;
  routeMinutes: number;
  travelMiles: number;
  travelMinutes: number;
  serviceMinutes: number;
  handlingMinutes: number;
  current: Coordinates;
  startsAt: Coordinates;
  stops: any[];
};

function stopServiceMinutesForType(targetType: unknown) {
  const normalized = normalizeForCompare(targetType);
  if (normalized === 'PHARMACY') return 8;
  if (normalized === 'DOCTOR') return 10;
  return 12;
}

function travelMinutesFromMiles(miles: number) {
  return (miles / 22) * 60;
}

function buildDistributorFromInput(input: any, fallbackStart: Coordinates | null): AutoAssignDistributor | null {
  const staffUserId = numberOrNull(input?.staffUserId);
  if (!staffUserId) return null;
  const capacity = routeCapacityFromBody({
    workType: clean(input?.workType) || 'full-time',
    shiftHours: numberOrNull(input?.shiftHours) ?? undefined
  });
  const startLatitude = numberOrNull(input?.startLatitude);
  const startLongitude = numberOrNull(input?.startLongitude);
  const startsAt = startLatitude !== null && startLongitude !== null
    ? { latitude: startLatitude, longitude: startLongitude }
    : fallbackStart;
  if (!startsAt) return null;
  return {
    staffUserId,
    workType: clean(input?.workType) || capacity.workType,
    shiftHours: Math.max(1, Math.min(numberOrNull(input?.shiftHours) || capacity.shiftHours, 12)),
    startType: clean(input?.startType) || 'custom',
    startLatitude: startsAt.latitude,
    startLongitude: startsAt.longitude,
    startAddress: clean(input?.startAddress),
    capacityMinutes: capacity.maxRouteMinutes,
    remainingMinutes: capacity.maxRouteMinutes,
    routeMinutes: 0,
    travelMiles: 0,
    travelMinutes: 0,
    serviceMinutes: 0,
    handlingMinutes: 0,
    current: { ...startsAt },
    startsAt: { ...startsAt },
    stops: []
  };
}

function stopAssignmentCost(distributor: AutoAssignDistributor, assignment: any) {
  const toCoordinates = {
    latitude: numberOrNull(assignment.Latitude) as number,
    longitude: numberOrNull(assignment.Longitude) as number
  };
  const distanceMiles = milesBetween(distributor.current, toCoordinates);
  const travelMinutes = travelMinutesFromMiles(distanceMiles);
  const serviceMinutes = stopServiceMinutesForType(assignment.TargetType);
  const handlingMinutes = 2;
  const totalMinutes = travelMinutes + serviceMinutes + handlingMinutes;
  return {
    distanceMiles,
    travelMinutes,
    serviceMinutes,
    handlingMinutes,
    totalMinutes
  };
}

async function loadStaffNamesById(staffIds: number[]) {
  if (!staffIds.length) return new Map<number, string>();
  const pool = await getPool();
  const request = pool.request();
  const params = staffIds.map((id, index) => {
    request.input(`StaffId${index}`, sql.Int, id);
    return `@StaffId${index}`;
  });
  const result = await request.query(`
    SELECT ID, CONCAT(User_FirstName, ' ', User_LastName) AS StaffName
    FROM dbo.Master_User
    WHERE ID IN (${params.join(', ')})
  `);
  return new Map<number, string>(
    result.recordset.map((row: any) => [Number(row.ID), clean(row.StaffName) || `User ${row.ID}`])
  );
}

clientWorkflowRoutes.post('/routes/auto-assign', async (req, res) => {
  const routeDate = dateOrToday(req.body?.routeDate || req.body?.scheduledDate);
  const campaignId = numberOrNull(req.body?.campaignId);
  const previewOnly = boolValue(req.body?.previewOnly, true);
  const distributorsInput = Array.isArray(req.body?.distributors) ? req.body.distributors : [];
  if (!distributorsInput.length) {
    return res.status(400).json({ message: 'distributors array is required.' });
  }

  const fallbackStart = cityCoordinate(req.body?.startCity || 'Pinellas Park', req.body?.startState || 'FL');
  const distributors = distributorsInput
    .map((input: any) => buildDistributorFromInput(input, fallbackStart))
    .filter(Boolean) as AutoAssignDistributor[];

  if (!distributors.length) {
    return res.status(400).json({ message: 'No valid distributors with usable start coordinates.' });
  }

  distributors.sort((a, b) => b.capacityMinutes - a.capacityMinutes);
  const warnings: string[] = [];
  const pool = await getPool();
  const eligibleResult = await pool.request()
    .input('CampaignId', sql.Int, campaignId)
    .input('RouteDate', sql.Date, routeDate)
    .query(`
      SELECT TOP 4000
        a.*,
        c.CampaignName,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        rs.StopStatus
      FROM dbo.PharmacyFlyer_Assignment a
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
      LEFT JOIN dbo.PharmacyFlyer_RouteStop rs
        ON rs.AssignmentId = a.AssignmentId
        AND rs.RouteId = a.RouteId
      WHERE a.ApprovalStatus = 'approved'
        AND (@CampaignId IS NULL OR a.CampaignId = @CampaignId)
        AND ISNULL(a.AssignmentStatus, 'approved') IN ('approved', 'assigned', 'routed')
        AND ISNULL(a.AssignmentStatus, 'approved') NOT IN ('completed', 'skipped', 'checked_in')
        AND a.CheckedInAt IS NULL
        AND a.CompletedAt IS NULL
        AND (a.ScheduledDate = @RouteDate OR a.ScheduledDate IS NULL OR a.NextVisitDueDate <= @RouteDate)
        AND (rs.RouteStopId IS NULL OR ISNULL(rs.StopStatus, 'pending') NOT IN ('completed', 'skipped', 'checked_in'))
      ORDER BY ISNULL(a.NextVisitDueDate, a.ScheduledDate), a.CreatedDate
    `);

  const allCandidates = eligibleResult.recordset.map((row: Record<string, any>) => withDerivedWorkflowCoordinates(row));
  const eligibleAssignments: any[] = [];
  let skippedMissingCoordinates = 0;
  for (const assignment of allCandidates) {
    const latitude = numberOrNull(assignment.Latitude);
    const longitude = numberOrNull(assignment.Longitude);
    if (latitude === null || longitude === null) {
      skippedMissingCoordinates += 1;
      continue;
    }
    eligibleAssignments.push({ ...assignment, Latitude: latitude, Longitude: longitude });
  }
  if (skippedMissingCoordinates) {
    warnings.push(`${skippedMissingCoordinates} assignments were skipped because coordinates are missing.`);
  }

  const remaining = [...eligibleAssignments];
  while (remaining.length) {
    let assignedInRound = false;
    for (const distributor of distributors) {
      let bestIndex = -1;
      let bestDistance = Number.MAX_SAFE_INTEGER;
      let bestCost: ReturnType<typeof stopAssignmentCost> | null = null;
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const cost = stopAssignmentCost(distributor, candidate);
        if (cost.totalMinutes > distributor.remainingMinutes) continue;
        if (cost.distanceMiles < bestDistance) {
          bestIndex = i;
          bestDistance = cost.distanceMiles;
          bestCost = cost;
        }
      }
      if (bestIndex < 0 || !bestCost) continue;
      const [selected] = remaining.splice(bestIndex, 1);
      distributor.stops.push({
        ...selected,
        EstimatedDistanceFromPreviousMiles: Number(bestCost.distanceMiles.toFixed(2)),
        EstimatedTravelMinutes: Number(bestCost.travelMinutes.toFixed(1)),
        EstimatedServiceMinutes: bestCost.serviceMinutes,
        EstimatedHandlingMinutes: bestCost.handlingMinutes
      });
      distributor.travelMiles += bestCost.distanceMiles;
      distributor.travelMinutes += bestCost.travelMinutes;
      distributor.serviceMinutes += bestCost.serviceMinutes;
      distributor.handlingMinutes += bestCost.handlingMinutes;
      distributor.routeMinutes += bestCost.totalMinutes;
      distributor.remainingMinutes = Math.max(0, distributor.remainingMinutes - bestCost.totalMinutes);
      distributor.current = { latitude: selected.Latitude, longitude: selected.Longitude };
      assignedInRound = true;
    }
    if (!assignedInRound) break;
  }

  const staffNameMap = await loadStaffNamesById(distributors.map((d) => d.staffUserId));
  const assignedCount = distributors.reduce((sum, d) => sum + d.stops.length, 0);
  const backlog = remaining.map((assignment) => ({
    assignmentId: assignment.AssignmentId,
    targetName: assignment.TargetName,
    reason: 'No distributor capacity remaining'
  }));

  if (!previewOnly) {
    await pool.request()
      .input('CampaignId', sql.Int, campaignId)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        ;WITH Resettable AS (
          SELECT DISTINCT a.AssignmentId
          FROM dbo.PharmacyFlyer_Assignment a
          LEFT JOIN dbo.PharmacyFlyer_RouteStop rs ON rs.AssignmentId = a.AssignmentId AND rs.RouteId = a.RouteId
          WHERE a.ApprovalStatus = 'approved'
            AND (@CampaignId IS NULL OR a.CampaignId = @CampaignId)
            AND ISNULL(a.AssignmentStatus, 'approved') IN ('approved', 'assigned', 'routed')
            AND a.CheckedInAt IS NULL
            AND a.CompletedAt IS NULL
            AND (a.ScheduledDate = @RouteDate OR a.ScheduledDate IS NULL OR a.NextVisitDueDate <= @RouteDate)
            AND (rs.RouteStopId IS NULL OR ISNULL(rs.StopStatus, 'pending') NOT IN ('completed', 'skipped', 'checked_in'))
        )
        DELETE rs
        FROM dbo.PharmacyFlyer_RouteStop rs
        INNER JOIN Resettable r ON r.AssignmentId = rs.AssignmentId
        WHERE ISNULL(rs.StopStatus, 'pending') NOT IN ('completed', 'skipped', 'checked_in');

        UPDATE a
        SET RouteId = NULL,
            RouteStopOrder = NULL,
            StaffUserId = NULL,
            AssignmentStatus = 'approved',
            LastModifiedDate = SYSDATETIME()
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN Resettable r ON r.AssignmentId = a.AssignmentId;
      `);

    for (const distributor of distributors) {
      if (!distributor.stops.length) continue;
      const route = await insertWorkflowRoute(pool, {
        routeName: `Auto Route ${routeDate} - ${staffNameMap.get(distributor.staffUserId) || distributor.staffUserId}`,
        staffUserId: distributor.staffUserId,
        routeDate,
        startAddress: distributor.startAddress,
        startLatitude: distributor.startLatitude,
        startLongitude: distributor.startLongitude,
        createdBy: req.user?.userId || null
      });
      for (let stopIndex = 0; stopIndex < distributor.stops.length; stopIndex += 1) {
        const stop = distributor.stops[stopIndex];
        const routeStop = {
          ...stop,
          RouteStopOrder: stopIndex + 1
        };
        await insertWorkflowRouteStop(pool, route.RouteId, routeStop);
        await pool.request()
          .input('RouteId', sql.BigInt, route.RouteId)
          .input('AssignmentId', sql.BigInt, stop.AssignmentId)
          .input('StaffUserId', sql.Int, distributor.staffUserId)
          .input('StopOrder', sql.Int, stopIndex + 1)
          .input('RouteDate', sql.Date, routeDate)
          .query(`
            UPDATE dbo.PharmacyFlyer_Assignment
            SET RouteId = @RouteId,
                StaffUserId = @StaffUserId,
                RouteStopOrder = @StopOrder,
                AssignmentStatus = 'routed',
                ScheduledDate = COALESCE(ScheduledDate, @RouteDate),
                LastModifiedDate = SYSDATETIME()
            WHERE AssignmentId = @AssignmentId
          `);
      }
      (distributor as any).routeId = route.RouteId;
    }
  }

  const responseRoutes = distributors.map((distributor) => ({
    staffUserId: distributor.staffUserId,
    staffName: staffNameMap.get(distributor.staffUserId) || `User ${distributor.staffUserId}`,
    capacityMinutes: Math.round(distributor.capacityMinutes),
    estimatedRouteMinutes: Math.round(distributor.routeMinutes),
    estimatedTravelMiles: Number(distributor.travelMiles.toFixed(2)),
    stopCount: distributor.stops.length,
    routeId: (distributor as any).routeId ?? null,
    workType: distributor.workType,
    shiftHours: distributor.shiftHours,
    stops: distributor.stops.map((stop, index) => ({
      assignmentId: stop.AssignmentId,
      stopOrder: index + 1,
      targetName: stop.TargetName,
      targetType: stop.TargetType,
      flyerTitle: stop.FlyerTitle || stop.FlyerIdentifier || stop.CampaignName || null,
      address: [stop.AddressStreet, stop.AddressCity, stop.AddressState, stop.AddressZip].filter(Boolean).join(', '),
      latitude: stop.Latitude,
      longitude: stop.Longitude,
      estimatedDistanceFromPreviousMiles: stop.EstimatedDistanceFromPreviousMiles,
      estimatedTravelMinutes: stop.EstimatedTravelMinutes,
      estimatedServiceMinutes: stop.EstimatedServiceMinutes
    }))
  }));

  res.status(previewOnly ? 200 : 201).json({
    routeDate,
    previewOnly,
    totalEligible: eligibleAssignments.length,
    assignedCount,
    backlogCount: backlog.length,
    routes: responseRoutes,
    backlog,
    warnings
  });
});

clientWorkflowRoutes.post('/routes/generate', async (req, res) => {
  const staffUserId = numberOrNull(req.body?.staffUserId);
  if (!staffUserId) return res.status(400).json({ message: 'staffUserId is required.' });

  const routeDate = dateOrToday(req.body?.routeDate || req.body?.scheduledDate);
  const capacity = routeCapacityFromBody(req.body);
  const startLat = numberOrNull(req.body?.startLatitude ?? req.body?.latitude);
  const startLng = numberOrNull(req.body?.startLongitude ?? req.body?.longitude);
  const start = startLat !== null && startLng !== null
    ? { latitude: startLat, longitude: startLng }
    : cityCoordinate(req.body?.startCity || 'Pinellas Park', req.body?.startState || 'FL');
  const pool = await getPool();

  // Make route generation idempotent for a staff member/date.
  // If admin regenerates today's route, remove old pending route-stop rows first so the mobile app
  // does not show duplicate #1, #1, #2, #2 stops from multiple generated routes.
  const hasRoutesForCleanup = await hasTable('PharmacyFlyer_Route');
  const hasStopsForCleanup = await hasTable('PharmacyFlyer_RouteStop');
  if (hasRoutesForCleanup && hasStopsForCleanup) {
    await pool.request()
      .input('StaffUserId', sql.Int, staffUserId)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        DECLARE @ResettableAssignments TABLE (
          AssignmentId BIGINT NOT NULL PRIMARY KEY
        );

        INSERT INTO @ResettableAssignments (AssignmentId)
        SELECT DISTINCT a.AssignmentId
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = a.RouteId
        LEFT JOIN dbo.PharmacyFlyer_RouteStop s
          ON s.RouteId = r.RouteId AND s.AssignmentId = a.AssignmentId
        WHERE r.StaffUserId = @StaffUserId
          AND r.RouteDate = @RouteDate
          AND a.StaffUserId = @StaffUserId
          AND a.ApprovalStatus = 'approved'
          AND ISNULL(a.AssignmentStatus, 'approved') NOT IN ('completed', 'skipped', 'checked_in')
          AND ISNULL(s.StopStatus, 'pending') NOT IN ('completed', 'skipped', 'checked_in');

        DELETE s
        FROM dbo.PharmacyFlyer_RouteStop s
        INNER JOIN @ResettableAssignments ra ON ra.AssignmentId = s.AssignmentId
        INNER JOIN dbo.PharmacyFlyer_Route r ON r.RouteId = s.RouteId
        WHERE r.StaffUserId = @StaffUserId
          AND r.RouteDate = @RouteDate;

        UPDATE a
        SET RouteId = NULL,
            RouteStopOrder = NULL,
            AssignmentStatus = 'approved',
            LastModifiedDate = SYSDATETIME()
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN @ResettableAssignments ra ON ra.AssignmentId = a.AssignmentId;
      `);
  }

  const eligibleCountResult = await pool.request()
    .input('StaffUserId', sql.Int, staffUserId)
    .input('RouteDate', sql.Date, routeDate)
    .query(`
      SELECT COUNT(*) AS TotalEligible
      FROM dbo.PharmacyFlyer_Assignment a
      WHERE a.StaffUserId = @StaffUserId
        AND a.ApprovalStatus = 'approved'
        AND ISNULL(a.AssignmentStatus, 'approved') = 'approved'
        AND (a.ScheduledDate = @RouteDate OR a.ScheduledDate IS NULL OR a.NextVisitDueDate <= @RouteDate)
    `);

  const totalEligible = Number(eligibleCountResult.recordset[0]?.TotalEligible || 0);
  if (totalEligible <= 0) {
    return res.status(400).json({
      message: 'No unrouted approved stops are available for this staff/date.',
      totalEligible: 0,
      backlogCount: 0,
      capacity
    });
  }

  const pendingResult = await pool.request()
    .input('StaffUserId', sql.Int, staffUserId)
    .input('RouteDate', sql.Date, routeDate)
    .query(`
      SELECT TOP ${capacity.maxStops}
        a.*,
        c.CampaignName,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory
      FROM dbo.PharmacyFlyer_Assignment a
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
      WHERE a.StaffUserId = @StaffUserId
        AND a.ApprovalStatus = 'approved'
        AND ISNULL(a.AssignmentStatus, 'approved') = 'approved'
        AND (a.ScheduledDate = @RouteDate OR a.ScheduledDate IS NULL OR a.NextVisitDueDate <= @RouteDate)
      ORDER BY ISNULL(a.NextVisitDueDate, a.ScheduledDate), a.CreatedDate
    `);

  const pendingStops = pendingResult.recordset.map((row: Record<string, any>) => withDerivedWorkflowCoordinates(row));
  const ordered = sortStopsByNearest(start, pendingStops);
  if (!ordered.length) {
    return res.status(400).json({
      message: 'No stops fit today route capacity.',
      totalEligible,
      backlogCount: totalEligible,
      capacity
    });
  }

  const routeName = clean(req.body?.routeName) || `${capacity.workType === 'part-time' ? 'Part-time' : 'Full-time'} Route ${routeDate} - ${staffUserId}`;
  const route = await insertWorkflowRoute(pool, {
    routeName,
    staffUserId,
    routeDate,
    startAddress: clean(req.body?.startAddress),
    startLatitude: start?.latitude ?? null,
    startLongitude: start?.longitude ?? null,
    createdBy: req.user?.userId || null
  });

  const stops: any[] = [];
  for (const stop of ordered) {
    const insertedStop = await insertWorkflowRouteStop(pool, route.RouteId, stop);
    await pool.request()
      .input('RouteId', sql.BigInt, route.RouteId)
      .input('AssignmentId', sql.BigInt, stop.AssignmentId)
      .input('StopOrder', sql.Int, stop.RouteStopOrder)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        UPDATE dbo.PharmacyFlyer_Assignment
        SET RouteId = @RouteId,
            RouteStopOrder = @StopOrder,
            AssignmentStatus = 'routed',
            ScheduledDate = COALESCE(ScheduledDate, @RouteDate),
            LastModifiedDate = SYSDATETIME()
        WHERE AssignmentId = @AssignmentId
      `);
    stops.push({ ...insertedStop, assignment: stop });
  }

  const backlogCount = Math.max(totalEligible - stops.length, 0);

  res.status(201).json({
    route,
    stopCount: stops.length,
    totalEligible,
    backlogCount,
    capacity,
    stops
  });
});

clientWorkflowRoutes.get('/routes/today', async (req, res) => {
  const pool = await getPool();
  const staffUserId = req.user?.userId;
  const routeDate = dateOrToday(req.query.date || req.query.routeDate);

  await ensureWorkflowColumns();
  const hasAssignments = await hasTable('PharmacyFlyer_Assignment');
  if (!hasAssignments) {
    return res.json({
      date: routeDate,
      routes: [],
      stops: [],
      schemaMissing: true,
      message: 'Workflow schema is not installed yet. Run database/006_client_prompt_full_workflow.sql.'
    });
  }

  const hasRoutes = await hasTable('PharmacyFlyer_Route');
  const hasRouteStops = await hasTable('PharmacyFlyer_RouteStop');
  const routes = hasRoutes
    ? await pool.request()
      .input('StaffUserId', sql.Int, staffUserId)
      .input('RouteDate', sql.Date, routeDate)
      .query(`
        SELECT *
        FROM dbo.PharmacyFlyer_Route
        WHERE StaffUserId = @StaffUserId
          AND RouteDate = @RouteDate
          AND ISNULL(Status, 'assigned') NOT IN ('cancelled', 'draft')
        ORDER BY CreatedDate DESC, RouteId DESC
      `)
    : { recordset: [] };

  const stopsQuery = hasRoutes && hasRouteStops ? `
      ;WITH ActiveRoutes AS (
        SELECT RouteId, RouteName, CreatedDate
        FROM dbo.PharmacyFlyer_Route
        WHERE StaffUserId = @StaffUserId
          AND RouteDate = @RouteDate
          AND ISNULL(Status, 'assigned') NOT IN ('cancelled', 'draft')
      ), RoutedStops AS (
        SELECT
          a.*,
          c.CampaignName,
          c.FlyerTitle,
          c.FlyerIdentifier,
          c.FlyerCategory,
          c.FlyerFileUrl,
          ar.RouteName,
          ROW_NUMBER() OVER (
            ORDER BY ar.CreatedDate DESC, ar.RouteId DESC, ISNULL(s.StopOrder, ISNULL(a.RouteStopOrder, 2147483647)), a.TargetName
          ) AS StopOrder,
          s.EstimatedDistanceFromPreviousMiles,
          s.StopStatus,
          CAST(0 AS BIT) AS IsBacklog,
          CAST(0 AS INT) AS SortGroup,
          ROW_NUMBER() OVER (
            ORDER BY ar.CreatedDate DESC, ar.RouteId DESC, ISNULL(s.StopOrder, ISNULL(a.RouteStopOrder, 2147483647)), a.TargetName
          ) AS SortOrder,
          ROW_NUMBER() OVER (
            PARTITION BY a.AssignmentId
            ORDER BY ar.CreatedDate DESC, ar.RouteId DESC, s.RouteStopId DESC
          ) AS rn
        FROM ActiveRoutes ar
        INNER JOIN dbo.PharmacyFlyer_RouteStop s ON s.RouteId = ar.RouteId
        INNER JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = s.AssignmentId
        INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
        WHERE a.StaffUserId = @StaffUserId
          AND a.ApprovalStatus = 'approved'
          AND ISNULL(a.AssignmentStatus, 'approved') NOT IN ('completed', 'skipped')
          AND ISNULL(s.StopStatus, 'pending') NOT IN ('completed', 'skipped')
      ), RoutedAssignmentsWithoutStop AS (
        SELECT
          a.*,
          c.CampaignName,
          c.FlyerTitle,
          c.FlyerIdentifier,
          c.FlyerCategory,
          c.FlyerFileUrl,
          COALESCE(ar.RouteName, CONCAT('Route ', CONVERT(NVARCHAR(20), a.RouteId))) AS RouteName,
          ISNULL(a.RouteStopOrder, ROW_NUMBER() OVER (
            ORDER BY ISNULL(ar.CreatedDate, a.LastModifiedDate), ISNULL(a.RouteStopOrder, 2147483647), a.TargetName
          )) AS StopOrder,
          CAST(NULL AS DECIMAL(8,2)) AS EstimatedDistanceFromPreviousMiles,
          ISNULL(a.AssignmentStatus, 'routed') AS StopStatus,
          CAST(0 AS BIT) AS IsBacklog,
          CAST(0 AS INT) AS SortGroup,
          ROW_NUMBER() OVER (
            ORDER BY ISNULL(ar.CreatedDate, a.LastModifiedDate) DESC, ISNULL(a.RouteStopOrder, 2147483647), a.TargetName
          ) AS SortOrder,
          ROW_NUMBER() OVER (
            PARTITION BY a.AssignmentId
            ORDER BY ISNULL(ar.CreatedDate, a.LastModifiedDate) DESC, a.AssignmentId DESC
          ) AS rn
        FROM dbo.PharmacyFlyer_Assignment a
        INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
        LEFT JOIN dbo.PharmacyFlyer_Route ar ON ar.RouteId = a.RouteId
        LEFT JOIN dbo.PharmacyFlyer_RouteStop s ON s.AssignmentId = a.AssignmentId AND s.RouteId = a.RouteId
        WHERE a.StaffUserId = @StaffUserId
          AND a.ApprovalStatus = 'approved'
          AND ISNULL(a.AssignmentStatus, 'approved') NOT IN ('approved', 'assigned', 'completed', 'skipped')
          AND (a.RouteId IS NOT NULL OR ISNULL(a.RouteStopOrder, 0) > 0)
          AND s.RouteStopId IS NULL
          AND CONVERT(DATE, COALESCE(ar.RouteDate, a.ScheduledDate)) = @RouteDate
      ), MobileRoutedStops AS (
        SELECT * FROM RoutedStops
        UNION ALL
        SELECT * FROM RoutedAssignmentsWithoutStop
      )
      SELECT *
      FROM MobileRoutedStops
      WHERE rn = 1
      ORDER BY SortOrder, TargetName
    ` : `
      SELECT TOP 0
        a.*,
        c.CampaignName,
        c.FlyerTitle,
        c.FlyerIdentifier,
        c.FlyerCategory,
        c.FlyerFileUrl,
        CAST(NULL AS NVARCHAR(200)) AS RouteName,
        a.RouteStopOrder AS StopOrder,
        CAST(NULL AS DECIMAL(8,2)) AS EstimatedDistanceFromPreviousMiles,
        a.AssignmentStatus AS StopStatus,
        CAST(0 AS BIT) AS IsBacklog,
        CAST(0 AS INT) AS SortGroup,
        CAST(0 AS INT) AS SortOrder,
        CAST(1 AS BIGINT) AS rn
      FROM dbo.PharmacyFlyer_Assignment a
      INNER JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = a.CampaignId
      WHERE 1 = 0
    `;
  const stops = await pool.request()
    .input('StaffUserId', sql.Int, staffUserId)
    .input('RouteDate', sql.Date, routeDate)
    .query(stopsQuery);

  const assignmentRows = stops.recordset.map((row: Record<string, any>) => withDerivedWorkflowCoordinates(row));

  // The mobile app navigates by PHYSICAL LOCATION, not by individual assignment. Group
  // the remaining assignment rows into one stop per location; within a location, the
  // flyers to drop are the DISTINCT campaigns — exactly one flyer per campaign no matter
  // how many doctors at that location need it. Each flyer carries every underlying
  // assignment id so completing the flyer once finishes all of them.
  const locMap = new Map<string, any>();
  for (const row of assignmentRows) {
    const key = stopLocationKey(row);
    let loc = locMap.get(key);
    if (!loc) {
      loc = {
        LocationKey: key,
        RouteId: row.RouteId,
        RouteName: row.RouteName,
        TargetName: row.TargetName,
        PracticeName: row.PracticeName,
        TargetType: row.TargetType,
        AddressStreet: row.AddressStreet,
        AddressCity: row.AddressCity,
        AddressState: row.AddressState,
        AddressZip: row.AddressZip,
        Phone: row.Phone,
        Latitude: row.Latitude,
        Longitude: row.Longitude,
        _campaigns: new Map<number, any>(),
        _doctors: new Set<string>()
      };
      locMap.set(key, loc);
    }
    const docKey = row.DoctorId != null
      ? `id:${row.DoctorId}`
      : `nm:${String(row.TargetName || '').trim().toLowerCase()}`;
    loc._doctors.add(docKey);

    const cid = Number(row.CampaignId);
    let flyer = loc._campaigns.get(cid);
    if (!flyer) {
      flyer = {
        CampaignId: cid,
        CampaignName: row.CampaignName,
        FlyerTitle: row.FlyerTitle,
        FlyerIdentifier: row.FlyerIdentifier,
        FlyerCategory: row.FlyerCategory,
        FlyerFileUrl: row.FlyerFileUrl,
        assignmentIds: [] as number[],
        doctorIds: new Set<string>(),
        checkedIn: false
      };
      loc._campaigns.set(cid, flyer);
    }
    flyer.assignmentIds.push(Number(row.AssignmentId));
    flyer.doctorIds.add(docKey);
    const st = String(row.AssignmentStatus || row.StopStatus || '').toLowerCase();
    if (String(row.CheckInStatus || '').toLowerCase() === 'confirmed' || st === 'checked_in') {
      flyer.checkedIn = true;
    }
  }

  // locMap preserves the query's route order, so location order follows the route.
  const locationStops = Array.from(locMap.values()).map((loc: any, idx: number) => {
    const flyers = Array.from(loc._campaigns.values()).map((f: any) => ({
      CampaignId: f.CampaignId,
      CampaignName: f.CampaignName,
      FlyerTitle: f.FlyerTitle,
      FlyerIdentifier: f.FlyerIdentifier,
      FlyerCategory: f.FlyerCategory,
      FlyerFileUrl: f.FlyerFileUrl,
      AssignmentId: f.assignmentIds[0],
      assignmentIds: f.assignmentIds,
      doctorCount: f.doctorIds.size,
      checkedIn: f.checkedIn
    }));
    return {
      LocationKey: loc.LocationKey,
      StopOrder: idx + 1,
      RouteId: loc.RouteId,
      RouteName: loc.RouteName,
      TargetName: loc.TargetName,
      PracticeName: loc.PracticeName,
      TargetType: loc.TargetType,
      AddressStreet: loc.AddressStreet,
      AddressCity: loc.AddressCity,
      AddressState: loc.AddressState,
      AddressZip: loc.AddressZip,
      Phone: loc.Phone,
      Latitude: loc.Latitude,
      Longitude: loc.Longitude,
      DoctorCount: loc._doctors.size,
      FlyerCount: flyers.length,
      checkedIn: flyers.length > 0 && flyers.every((f: any) => f.checkedIn),
      flyers
    };
  });

  const mobileRoutes = routes.recordset.length
    ? routes.recordset
    : locationStops.length
      ? [{
          RouteId: locationStops[0].RouteId || 0,
          RouteName: locationStops[0].RouteName || `Today's Route`,
          StaffUserId: staffUserId,
          RouteDate: routeDate,
          Status: 'planned'
        }]
      : [];

  res.json({ date: routeDate, routes: mobileRoutes, stops: locationStops });
});

clientWorkflowRoutes.post('/assignments/:assignmentId/checkin', async (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const userLatitude = numberOrNull(req.body?.userLatitude ?? req.body?.latitude);
  const userLongitude = numberOrNull(req.body?.userLongitude ?? req.body?.longitude);
  if (!Number.isFinite(assignmentId) || userLatitude === null || userLongitude === null) {
    return res.status(400).json({ message: 'assignmentId, latitude, and longitude are required.' });
  }

  const pool = await getPool();
  const lookup = await pool.request()
    .input('AssignmentId', sql.BigInt, assignmentId)
    .input('StaffUserId', sql.Int, req.user?.userId)
    .query(`
      SELECT TOP 1 AssignmentId, StaffUserId, Latitude, Longitude, TargetName, AddressCity, AddressState, AddressZip
      FROM dbo.PharmacyFlyer_Assignment
      WHERE AssignmentId = @AssignmentId AND StaffUserId = @StaffUserId AND ApprovalStatus = 'approved'
    `);
  const assignment = lookup.recordset[0];
  if (!assignment) return res.status(404).json({ message: 'Approved assignment not found for this user.' });

  const assignmentWithCoordinates = withDerivedWorkflowCoordinates(assignment);
  const targetLatitude = numberOrNull(assignmentWithCoordinates.Latitude);
  const targetLongitude = numberOrNull(assignmentWithCoordinates.Longitude);
  const distanceMiles = targetLatitude !== null && targetLongitude !== null
    ? milesBetween({ latitude: userLatitude, longitude: userLongitude }, { latitude: targetLatitude, longitude: targetLongitude })
    : null;
  if (distanceMiles !== null && distanceMiles > CHECK_IN_RADIUS_MILES) {
    return res.status(403).json({ message: `Outside ${CHECK_IN_RADIUS_MILES}-mile check-in radius.`, distanceMiles: Number(distanceMiles.toFixed(2)), radiusMiles: CHECK_IN_RADIUS_MILES });
  }

  await pool.request()
    .input('AssignmentId', sql.BigInt, assignmentId)
    .input('CheckInLatitude', sql.Decimal(10, 7), userLatitude)
    .input('CheckInLongitude', sql.Decimal(10, 7), userLongitude)
    .input('CheckInDistanceMiles', sql.Decimal(8, 2), distanceMiles === null ? null : Number(distanceMiles.toFixed(2)))
    .query(`
      UPDATE dbo.PharmacyFlyer_Assignment
      SET CheckInStatus = 'confirmed',
          CheckedInAt = SYSDATETIME(),
          CheckInLatitude = @CheckInLatitude,
          CheckInLongitude = @CheckInLongitude,
          CheckInDistanceMiles = @CheckInDistanceMiles,
          AssignmentStatus = 'checked_in',
          LastModifiedDate = SYSDATETIME()
      WHERE AssignmentId = @AssignmentId;

      UPDATE s
      SET StopStatus = 'checked_in'
      FROM dbo.PharmacyFlyer_RouteStop s
      INNER JOIN dbo.PharmacyFlyer_Assignment a ON a.AssignmentId = s.AssignmentId
      WHERE a.AssignmentId = @AssignmentId;
    `);

  res.json({ assignmentId, checkInStatus: 'confirmed', distanceMiles: distanceMiles === null ? null : Number(distanceMiles.toFixed(2)) });
});
