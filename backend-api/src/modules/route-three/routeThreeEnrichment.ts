import { getPool } from '../../config/db.js';
import { findNearbyOrganizations, type NearbyOrgResult } from '../new-entries/newEntriesNearbyOrgs.js';
import {
  lookupProvidersAtAddress,
  type AddressProviderResult,
} from '../new-entries/newEntriesProvidersAtAddress.js';
import { buildLocalRegistryEnrichment } from '../npi-registry/npiRegistryEnrichment.js';
import { matchesTrackedDoctorSpecialty } from '../route-planner/specialtyCatalog.js';
import { isMappedLocationStop } from '../route-planner/routePlannerGeo.js';
import {
  NPI_REGISTRY_ENRICHMENT_RADIUS_MILES,
  ROUTE_THREE_USE_LIVE_NPPES,
} from '../route-planner/routePlannerConfig.js';
import { standardizeAddress, addressesLikelySame } from '../../utils/standardizeAddress.js';
import {
  buildUnifiedLocationEntities,
  type UnifiedLocationEntity,
} from './unifiedLocationEntities.js';
import {
  attachSpecialtyMatchedFlyers,
  loadDoctorSpecialties,
} from './routeThreeFlyerMatch.js';

// Explicit, user-facing status the mobile app can render without inferring from
// backend flags like cfg/uncfg/alreadyKnown. The first three are backend-assigned
// classifications; the rest are set by field users and mapped back on save.
export type FrontendEntityStatus =
  | 'known'
  | 'needs_mapping'
  | 'new_provider'
  | 'selected_for_review'
  | 'confirmed_here'
  | 'not_here'
  | 'unsure'
  | 'virtual_mail_only';

export type MatchConfidence = 'high' | 'medium' | 'low';

export type RouteThreeConfiguredDoctor = {
  doctorId: number;
  doctorName: string | null;
  phone: string | null;
  npi: string | null;
  campaignId: number | null;
  campaignName: string | null;
  flyerTitle: string | null;
  matchedSpecialityCode: string | null;
  status: string | null;
  routePlanDropId: number | null;
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
};

export type RouteThreeUnmappedDoctor = {
  doctorId: number;
  doctorName: string | null;
  phone: string | null;
  npi: string | null;
  matchedSpecialityCode: string | null;
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
};

export type RouteThreeLocationMappedDoctor = RouteThreeUnmappedDoctor;

export type RouteThreeMasterDoctorAtAddress = RouteThreeUnmappedDoctor;

export type RouteThreeOrganization = NearbyOrgResult & {
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
  sameAddress: boolean;
  samePhone: boolean;
  source: string;
};

export type RouteThreeProvider = AddressProviderResult & {
  frontendStatus: FrontendEntityStatus;
  matchReason: string;
  matchConfidence: MatchConfidence;
  sameAddress: boolean;
  samePhone: boolean;
  source: string;
};

export type RouteThreeEnrichmentResult = {
  routePlanStopId: number;
  locationKey: string | null;
  isConfigured: boolean;
  stopLabel: string | null;
  practiceName: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  configuredDoctors: RouteThreeConfiguredDoctor[];
  /** All doctors with active Doctor_Location_Mapping at this practice. */
  locationMappedDoctors: RouteThreeLocationMappedDoctor[];
  /** Master_Doctor rows at this address without mapping to this practice. */
  masterDoctorsAtAddress: RouteThreeMasterDoctorAtAddress[];
  /** @deprecated Use masterDoctorsAtAddress — kept for older mobile builds. */
  unmappedDoctors: RouteThreeUnmappedDoctor[];
  organizations: RouteThreeOrganization[];
  allProviders: RouteThreeProvider[];
  newProviders: RouteThreeProvider[];
  stats: {
    configuredDoctorCount: number;
    mappedDoctorCount: number;
    unmappedDoctorCount: number;
    organizationCount: number;
    allProviderCount: number;
    newProviderCount: number;
    alreadyKnownProviderCount: number;
    needsMappingCount: number;
    newProvidersDiscoveryCount: number;
    prescriberCount: number;
    atAddressOrgCount: number;
  };
  lookupHint: string | null;
  highDensity: boolean;
  standardizedAddress: string | null;
  unifiedEntities: UnifiedLocationEntity[];
  recommendedFlyers: Array<{
    campaignId: number;
    campaignName: string;
    flyerTitle: string | null;
    matchReason: string;
    doctorNames: string[];
  }>;
};

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  return da.length >= 7 && db.length >= 7 && da.slice(-10) === db.slice(-10);
}

// Loose street match: compares the leading house-number + street tokens.
function streetsMatch(address: string | null | undefined, street: string | null | undefined): boolean {
  const addr = String(address ?? '').toLowerCase();
  const target = String(street ?? '').toLowerCase().trim();
  if (!addr || !target) return false;
  const firstTokens = target.split(/\s+/).slice(0, 2).join(' ');
  return firstTokens.length > 1 && addr.includes(firstTokens);
}

function confidenceFor(sameAddress: boolean, samePhone: boolean): MatchConfidence {
  if (sameAddress && samePhone) return 'high';
  if (sameAddress || samePhone) return 'medium';
  return 'low';
}

function normalizeNpi(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

const ACTIVE_DOCTOR_FILTER = `LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'`;

const PHONE_DIGITS = (column: string) =>
  `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(${column}, ''))), '-', ''), '(', ''), ')', ''), ' ', ''), '.', ''), '+', ''), '/', ''), 10)`;

const ACTIVE_MAPPING_DLM_FILTERS = `
  ISNULL(dlm.Mapping_IsActive, 0) = 1
  AND dlm.Location_Id IS NOT NULL
  AND (
    NULLIF(LTRIM(RTRIM(dlm.Doctor_Phone)), '') IS NULL
    OR ${PHONE_DIGITS('dlm.Doctor_Phone')} = ${PHONE_DIGITS('COALESCE(d.Doctor_Phone, d.Doctor_MobileNo)')}
  )
`;

async function loadPracticeNameForLocation(locationId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('LocationId', locationId)
    .query(`
      SELECT TOP 1 NULLIF(LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))), '') AS PracticeName
      FROM dbo.Master_Location ml
      INNER JOIN dbo.Master_Practice mp ON mp.ID = ml.Practice_Id
      WHERE ml.ID = @LocationId
        AND ISNULL(ml.Location_IsActive, 1) = 1
    `);
  return clean(result.recordset[0]?.PracticeName);
}

async function resolveLocationIdForStop(input: {
  locationId: number | null;
  locationKey: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
}) {
  if (input.locationId != null && input.locationId > 0) return input.locationId;

  const keyMatch = String(input.locationKey || '').match(/^loc:(\d+)$/i);
  if (keyMatch) return Number(keyMatch[1]);

  if (!input.street || !input.postalCode) return null;

  const pool = await getPool();
  const std = standardizeAddress({
    street: input.street,
    city: input.city,
    state: 'FL',
    postalCode: input.postalCode,
  });
  const result = await pool.request()
    .input('Zip', std.postalCode)
    .query(`
      SELECT ml.ID AS LocationId,
        LTRIM(RTRIM(ISNULL(ml.Location_AddressStreet, ''))) AS AddressStreet,
        LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, ''))) AS AddressCity,
        LTRIM(RTRIM(ISNULL(CAST(ml.Location_AddressZip AS VARCHAR(20)), ''))) AS AddressZip
      FROM dbo.Master_Location ml
      WHERE ISNULL(ml.Location_IsActive, 1) = 1
        AND LEFT(REPLACE(LTRIM(RTRIM(ISNULL(CAST(ml.Location_AddressZip AS VARCHAR(20)), ''))), '-', ''), 5) = @Zip
    `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    if (addressesLikelySame(
      { street: String(row.AddressStreet || ''), city: String(row.AddressCity || ''), state: 'FL', postalCode: String(row.AddressZip || '') },
      { street: std.street, city: std.city, state: std.state, postalCode: std.postalCode },
    )) {
      return Number(row.LocationId);
    }
  }
  return null;
}

async function loadLocationPhone(locationId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('LocationId', locationId)
    .query(`
      SELECT TOP 1 NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_Phone, ''))), '') AS LocationPhone
      FROM dbo.Master_Location ml
      WHERE ml.ID = @LocationId
    `);
  return clean(result.recordset[0]?.LocationPhone);
}

function mapDoctorRow(row: Record<string, unknown>, matchReason: string): RouteThreeLocationMappedDoctor {
  return {
    doctorId: Number(row.DoctorId) || 0,
    doctorName: clean(row.DoctorName),
    phone: clean(row.DoctorPhone),
    npi: clean(row.DoctorNpi),
    matchedSpecialityCode: clean(row.MatchedSpecialityCode),
    frontendStatus: 'known',
    matchReason,
    matchConfidence: 'high',
  };
}

async function loadLocationMappedDoctors(locationId: number): Promise<RouteThreeLocationMappedDoctor[]> {
  const pool = await getPool();
  const result = await pool.request()
    .input('LocationId', locationId)
    .query(`
    SELECT
      d.ID AS DoctorId,
      NULLIF(LTRIM(RTRIM(CONCAT(
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))), ' ',
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, '')))
      ))), '') AS DoctorName,
      NULLIF(LTRIM(RTRIM(COALESCE(dlm.Doctor_Phone, d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS DoctorPhone,
      NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, ''))), '') AS DoctorNpi,
      (
        SELECT TOP 1 LTRIM(RTRIM(ISNULL(sl.SpecialityCode, '')))
        FROM dbo.Master_PrescribSpeciality ps
        INNER JOIN dbo.Master_PrsSpecialitiesList sl ON sl.RecID = ps.SpecialityID
        WHERE ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
          AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
          AND ISNULL(sl.IsActive, 1) = 1
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) IN ('1', 'P', 'Primary') THEN 0
            WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) = '2' THEN 1
            ELSE 2
          END,
          sl.SpecialityCode
      ) AS MatchedSpecialityCode
    FROM dbo.Doctor_Location_Mapping dlm
    INNER JOIN dbo.Master_Doctor d ON d.Doctor_NO = dlm.Doctor_No
    INNER JOIN dbo.Master_Location ml ON ml.ID = dlm.Location_Id
      AND ISNULL(ml.Location_IsActive, 1) = 1
    WHERE dlm.Location_Id = @LocationId
      AND ${ACTIVE_MAPPING_DLM_FILTERS}
      AND ${ACTIVE_DOCTOR_FILTER}
    ORDER BY d.Doctor_LastName, d.Doctor_FirstName, d.ID
  `);

  return (result.recordset as Record<string, unknown>[])
    .map((row) => mapDoctorRow(row, 'Mapped to this practice (Doctor_Location_Mapping)'))
    .filter((row) => row.doctorId > 0);
}

async function loadMasterDoctorsAtAddress(input: {
  street: string | null;
  city: string | null;
  state: string;
  postalCode: string | null;
  practicePhone?: string | null;
  excludeDoctorIds: number[];
}) {
  const zip = String(input.postalCode || '').replace(/\D/g, '').slice(0, 5);
  if (!zip) return [];

  const pool = await getPool();
  const request = pool.request().input('Zip', zip);
  const excludeClause = input.excludeDoctorIds.length
    ? `AND d.ID NOT IN (${input.excludeDoctorIds.map((_, index) => {
        request.input(`ExcludeDoctorId${index}`, input.excludeDoctorIds[index]);
        return `@ExcludeDoctorId${index}`;
      }).join(', ')})`
    : '';

  const phoneDigits = digitsOnly(input.practicePhone).slice(-10);
  const phoneClause = phoneDigits.length >= 7
    ? `OR ${PHONE_DIGITS('d.Doctor_Phone')} = @PracticePhone OR ${PHONE_DIGITS('d.Doctor_MobileNo')} = @PracticePhone`
    : '';
  if (phoneDigits.length >= 7) request.input('PracticePhone', phoneDigits);

  const result = await request.query(`
    SELECT
      d.ID AS DoctorId,
      NULLIF(LTRIM(RTRIM(CONCAT(
        LTRIM(RTRIM(ISNULL(d.Doctor_FirstName, ''))), ' ',
        LTRIM(RTRIM(ISNULL(d.Doctor_LastName, '')))
      ))), '') AS DoctorName,
      NULLIF(LTRIM(RTRIM(COALESCE(d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS DoctorPhone,
      NULLIF(LTRIM(RTRIM(ISNULL(d.Doctor_NPINo, ''))), '') AS DoctorNpi,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressStreet, ''))) AS AddressStreet,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressCity, ''))) AS AddressCity,
      LTRIM(RTRIM(ISNULL(d.Doctor_AddressState, ''))) AS AddressState,
      LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
      (
        SELECT TOP 1 LTRIM(RTRIM(ISNULL(sl.SpecialityCode, '')))
        FROM dbo.Master_PrescribSpeciality ps
        INNER JOIN dbo.Master_PrsSpecialitiesList sl ON sl.RecID = ps.SpecialityID
        WHERE ps.PresNo = TRY_CONVERT(INT, d.Doctor_NO)
          AND ISNULL(ps.PrescribSpeciality_IsActive, 1) = 1
          AND ISNULL(sl.IsActive, 1) = 1
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) IN ('1', 'P', 'Primary') THEN 0
            WHEN LTRIM(RTRIM(ISNULL(CAST(ps.Level AS VARCHAR(20)), ''))) = '2' THEN 1
            ELSE 2
          END,
          sl.SpecialityCode
      ) AS MatchedSpecialityCode
    FROM dbo.Master_Doctor d
    WHERE ${ACTIVE_DOCTOR_FILTER}
      AND (
        LEFT(REPLACE(LTRIM(RTRIM(ISNULL(CAST(d.Doctor_AddressZip AS VARCHAR(20)), ''))), '-', ''), 5) = @Zip
        ${phoneClause}
      )
      ${excludeClause}
    ORDER BY d.Doctor_LastName, d.Doctor_FirstName, d.ID
  `);

  const stopAddress = {
    street: input.street,
    city: input.city,
    state: input.state || 'FL',
    postalCode: input.postalCode,
  };

  const seen = new Set<number>();
  const out: RouteThreeMasterDoctorAtAddress[] = [];
  for (const row of result.recordset as Record<string, unknown>[]) {
    const doctorId = Number(row.DoctorId) || 0;
    if (doctorId <= 0 || seen.has(doctorId)) continue;

    const doctorAddress = {
      street: clean(row.AddressStreet),
      city: clean(row.AddressCity),
      state: clean(row.AddressState) || 'FL',
      postalCode: clean(row.AddressZip),
    };
    const phoneMatch = phoneDigits.length >= 7
      && (digitsOnly(clean(row.DoctorPhone)).slice(-10) === phoneDigits);
    const addressMatch = addressesLikelySame(doctorAddress, stopAddress);
    if (!addressMatch && !phoneMatch) continue;

    seen.add(doctorId);
    out.push({
      doctorId,
      doctorName: clean(row.DoctorName),
      phone: clean(row.DoctorPhone),
      npi: clean(row.DoctorNpi),
      matchedSpecialityCode: clean(row.MatchedSpecialityCode),
      frontendStatus: 'needs_mapping',
      matchReason: addressMatch
        ? 'In Master_Doctor at this address, not mapped to this practice'
        : 'In Master_Doctor at this practice phone, not mapped to this practice',
      matchConfidence: addressMatch ? 'high' : 'medium',
    });
  }
  return out;
}

function filterProvidersAgainstDoctors(
  providers: RouteThreeProvider[],
  doctors: Array<{ doctorId: number; npi: string | null; doctorName: string | null }>,
): RouteThreeProvider[] {
  const npis = new Set(doctors.map((d) => normalizeNpi(d.npi)).filter((npi) => npi.length === 10));
  const names = new Set(
    doctors.map((d) => String(d.doctorName || '').trim().toLowerCase()).filter(Boolean),
  );
  return providers.filter((provider) => {
    const npi = normalizeNpi(provider.npi);
    if (npi.length === 10 && npis.has(npi)) return false;
    const name = String(provider.providerName || '').trim().toLowerCase();
    if (name && names.has(name)) return false;
    return true;
  });
}

const STOP_PRACTICE_COLUMNS = `
  s.RoutePlanStopId,
  s.LocationKey,
  s.LocationId,
  s.StopLabel,
  s.AddressStreet,
  s.AddressCity,
  s.AddressState,
  s.AddressZip,
  s.Latitude,
  s.Longitude,
  s.Status,
  p.AssignedUserId
`;

async function loadStopForUser(routePlanStopId: number, userId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RoutePlanStopId', routePlanStopId)
    .input('UserId', userId)
    .query(`
      SELECT TOP 1 ${STOP_PRACTICE_COLUMNS}
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
      WHERE s.RoutePlanStopId = @RoutePlanStopId
        AND p.AssignedUserId = @UserId
    `);

  return (result.recordset[0] as Record<string, unknown> | undefined) ?? null;
}

async function loadStopRow(routePlanStopId: number) {
  const pool = await getPool();
  const result = await pool.request()
    .input('RoutePlanStopId', routePlanStopId)
    .query(`
      SELECT TOP 1 ${STOP_PRACTICE_COLUMNS}
      FROM dbo.PharmacyFlyer_RoutePlanStopV2 s
      INNER JOIN dbo.PharmacyFlyer_RoutePlanV2 p ON p.RoutePlanId = s.RoutePlanId
      WHERE s.RoutePlanStopId = @RoutePlanStopId
    `);

  return (result.recordset[0] as Record<string, unknown> | undefined) ?? null;
}

async function loadConfiguredDoctors(routePlanStopId: number): Promise<RouteThreeConfiguredDoctor[]> {
  const pool = await getPool();
  const dropsResult = await pool.request()
    .input('RoutePlanStopId', routePlanStopId)
    .query(`
      SELECT
        d.RoutePlanDropId,
        d.DoctorId,
        d.DoctorName,
        d.MatchedSpecialityCode,
        d.Status,
        d.CampaignId,
        c.CampaignName,
        c.FlyerTitle,
        md.Doctor_Phone AS DoctorPhone,
        md.Doctor_NPINo AS DoctorNpi
      FROM dbo.PharmacyFlyer_RoutePlanDropV2 d
      LEFT JOIN dbo.PharmacyFlyer_Campaign c ON c.CampaignId = d.CampaignId
      LEFT JOIN dbo.Master_Doctor md ON md.ID = d.DoctorId
      WHERE d.RoutePlanStopId = @RoutePlanStopId
      ORDER BY d.DoctorName, d.RoutePlanDropId
    `);

  return (dropsResult.recordset as Record<string, unknown>[]).map((row) => ({
    doctorId: Number(row.DoctorId) || 0,
    doctorName: clean(row.DoctorName),
    phone: clean(row.DoctorPhone),
    npi: clean(row.DoctorNpi),
    campaignId: row.CampaignId != null ? Number(row.CampaignId) : null,
    campaignName: clean(row.CampaignName),
    flyerTitle: clean(row.FlyerTitle),
    matchedSpecialityCode: clean(row.MatchedSpecialityCode),
    status: clean(row.Status),
    routePlanDropId: row.RoutePlanDropId != null ? Number(row.RoutePlanDropId) : null,
    frontendStatus: 'known' as const,
    matchReason: 'Mapped to this location',
    matchConfidence: 'high' as const,
  })).filter((row) => row.doctorId > 0 || row.doctorName);
}

let practiceNameColumnReady: Promise<void> | null = null;

/** Make sure the PracticeNameEntered column exists (see database/034_route_plan_stop_practice_name.sql). */
function ensurePracticeNameColumn() {
  if (!practiceNameColumnReady) {
    practiceNameColumnReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'PracticeNameEntered') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD PracticeNameEntered NVARCHAR(300) NULL;
      `);
    })().catch((err) => {
      practiceNameColumnReady = null;
      throw err;
    });
  }
  return practiceNameColumnReady;
}

async function loadEnteredPracticeName(routePlanStopId: number): Promise<string | null> {
  await ensurePracticeNameColumn();
  const pool = await getPool();
  const result = await pool.request()
    .input('RoutePlanStopId', routePlanStopId)
    .query(`
      SELECT TOP 1 PracticeNameEntered
      FROM dbo.PharmacyFlyer_RoutePlanStopV2
      WHERE RoutePlanStopId = @RoutePlanStopId
    `);
  return clean(result.recordset[0]?.PracticeNameEntered);
}

async function practiceNameFromStop(stop: Record<string, unknown>) {
  const routePlanStopId = Number(stop.RoutePlanStopId);
  const locationKey = clean(stop.LocationKey);
  const resolvedLocationId = await resolveLocationIdForStop({
    locationId: stop.LocationId != null ? Number(stop.LocationId) : null,
    locationKey,
    street: clean(stop.AddressStreet),
    city: clean(stop.AddressCity),
    postalCode: clean(stop.AddressZip)?.replace(/\D/g, '').slice(0, 5) || null,
  });

  const enteredPracticeName = await loadEnteredPracticeName(routePlanStopId);
  const masterPracticeName = resolvedLocationId != null && resolvedLocationId > 0
    ? await loadPracticeNameForLocation(resolvedLocationId)
    : null;

  return {
    routePlanStopId,
    isConfigured: isMappedLocationStop({ locationId: resolvedLocationId, locationKey }),
    practiceName: enteredPracticeName || masterPracticeName,
    enteredPracticeName,
    masterPracticeName,
  };
}

/**
 * Lightweight practice-name lookup for a stop (no NPI / org enrichment).
 * Returns only a real practice name: the one the distributor typed, or Master_Practice.
 * Never falls back to StopLabel, which can be a doctor/provider name on unmapped stops.
 */
export async function loadStopPracticeName(input: { routePlanStopId: number; userId: number }) {
  const stop = await loadStopForUser(input.routePlanStopId, input.userId);
  if (!stop) {
    return { error: 'Route stop not found or not assigned to you.' } as const;
  }
  return practiceNameFromStop(stop);
}

/** Same name the route screen shows, for a stop already limited to this person's check-in. */
export async function loadPracticeNameForRouteStop(routePlanStopId: number) {
  const stop = await loadStopRow(routePlanStopId);
  if (!stop) {
    return { error: 'Route stop not found.' } as const;
  }
  return practiceNameFromStop(stop);
}

/** Save the practice name the distributor typed for a stop (own column; StopLabel untouched). */
export async function saveStopPracticeName(input: { routePlanStopId: number; userId: number; practiceName: string }) {
  const stop = await loadStopForUser(input.routePlanStopId, input.userId);
  if (!stop) {
    return { error: 'Route stop not found or not assigned to you.' } as const;
  }

  const practiceName = String(input.practiceName || '').trim().slice(0, 300);
  if (!practiceName) {
    return { error: 'Practice name is required.' } as const;
  }

  await ensurePracticeNameColumn();
  const pool = await getPool();
  await pool.request()
    .input('RoutePlanStopId', Number(stop.RoutePlanStopId))
    .input('PracticeNameEntered', practiceName)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanStopV2
      SET PracticeNameEntered = @PracticeNameEntered
      WHERE RoutePlanStopId = @RoutePlanStopId
    `);

  return { routePlanStopId: Number(stop.RoutePlanStopId), practiceName };
}

// ---------------------------------------------------------------------------
// Front-desk notes (office intel the distributor collects at the stop)
// ---------------------------------------------------------------------------

export const FRONT_DESK_OUTCOMES = ['accepted', 'left_at_desk', 'refused', 'closed', 'wrong_address'] as const;
export const BEST_TIMES_TO_VISIT = ['morning', 'midday', 'afternoon'] as const;
export type FrontDeskOutcome = (typeof FRONT_DESK_OUTCOMES)[number];
export type BestTimeToVisit = (typeof BEST_TIMES_TO_VISIT)[number];

export type StopFrontDesk = {
  routePlanStopId: number;
  outcome: FrontDeskOutcome | null;
  bestTime: BestTimeToVisit | null;
  contactName: string | null;
  note: string | null;
  updatedAt: string | null;
};

let frontDeskColumnsReady: Promise<void> | null = null;

/** Make sure the front-desk columns exist (see database/035_route_plan_stop_front_desk.sql). */
function ensureFrontDeskColumns() {
  if (!frontDeskColumnsReady) {
    frontDeskColumnsReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskOutcome') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskOutcome NVARCHAR(40) NULL;
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'BestTimeToVisit') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD BestTimeToVisit NVARCHAR(40) NULL;
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskContactName') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskContactName NVARCHAR(200) NULL;
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskNote') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskNote NVARCHAR(1000) NULL;
        IF COL_LENGTH('dbo.PharmacyFlyer_RoutePlanStopV2', 'FrontDeskUpdatedAt') IS NULL
          ALTER TABLE dbo.PharmacyFlyer_RoutePlanStopV2 ADD FrontDeskUpdatedAt DATETIME2 NULL;
      `);
    })().catch((err) => {
      frontDeskColumnsReady = null;
      throw err;
    });
  }
  return frontDeskColumnsReady;
}

function pickEnum<T extends readonly string[]>(allowed: T, value: unknown): T[number] | null {
  const text = String(value ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(text) ? (text as T[number]) : null;
}

export async function loadStopFrontDesk(input: { routePlanStopId: number; userId: number }) {
  const stop = await loadStopForUser(input.routePlanStopId, input.userId);
  if (!stop) {
    return { error: 'Route stop not found or not assigned to you.' } as const;
  }

  await ensureFrontDeskColumns();
  const pool = await getPool();
  const result = await pool.request()
    .input('RoutePlanStopId', Number(stop.RoutePlanStopId))
    .query(`
      SELECT TOP 1 FrontDeskOutcome, BestTimeToVisit, FrontDeskContactName, FrontDeskNote, FrontDeskUpdatedAt
      FROM dbo.PharmacyFlyer_RoutePlanStopV2
      WHERE RoutePlanStopId = @RoutePlanStopId
    `);
  const row = result.recordset[0] || {};
  const payload: StopFrontDesk = {
    routePlanStopId: Number(stop.RoutePlanStopId),
    outcome: pickEnum(FRONT_DESK_OUTCOMES, row.FrontDeskOutcome),
    bestTime: pickEnum(BEST_TIMES_TO_VISIT, row.BestTimeToVisit),
    contactName: clean(row.FrontDeskContactName),
    note: clean(row.FrontDeskNote),
    updatedAt: row.FrontDeskUpdatedAt ? new Date(row.FrontDeskUpdatedAt).toISOString() : null,
  };
  return payload;
}

/** Save what the distributor learned at the front desk. Any field may be null to clear it. */
export async function saveStopFrontDesk(input: {
  routePlanStopId: number;
  userId: number;
  outcome?: unknown;
  bestTime?: unknown;
  contactName?: unknown;
  note?: unknown;
}) {
  const stop = await loadStopForUser(input.routePlanStopId, input.userId);
  if (!stop) {
    return { error: 'Route stop not found or not assigned to you.' } as const;
  }

  const outcome = pickEnum(FRONT_DESK_OUTCOMES, input.outcome);
  const bestTime = pickEnum(BEST_TIMES_TO_VISIT, input.bestTime);
  const contactName = String(input.contactName ?? '').trim().slice(0, 200) || null;
  const note = String(input.note ?? '').trim().slice(0, 1000) || null;

  await ensureFrontDeskColumns();
  const pool = await getPool();
  await pool.request()
    .input('RoutePlanStopId', Number(stop.RoutePlanStopId))
    .input('FrontDeskOutcome', outcome)
    .input('BestTimeToVisit', bestTime)
    .input('FrontDeskContactName', contactName)
    .input('FrontDeskNote', note)
    .query(`
      UPDATE dbo.PharmacyFlyer_RoutePlanStopV2
      SET FrontDeskOutcome = @FrontDeskOutcome,
          BestTimeToVisit = @BestTimeToVisit,
          FrontDeskContactName = @FrontDeskContactName,
          FrontDeskNote = @FrontDeskNote,
          FrontDeskUpdatedAt = SYSUTCDATETIME()
      WHERE RoutePlanStopId = @RoutePlanStopId
    `);

  const payload: StopFrontDesk = {
    routePlanStopId: Number(stop.RoutePlanStopId),
    outcome,
    bestTime,
    contactName,
    note,
    updatedAt: new Date().toISOString(),
  };
  return payload;
}

export async function enrichRoutePlanStop(input: {
  routePlanStopId: number;
  userId: number;
  radiusMiles?: number;
}) {
  const stop = await loadStopForUser(input.routePlanStopId, input.userId);
  if (!stop) {
    return { error: 'Route stop not found or not assigned to you.' } as const;
  }

  const routePlanStopId = Number(stop.RoutePlanStopId);
  const locationKey = clean(stop.LocationKey);
  const street = clean(stop.AddressStreet);
  const city = clean(stop.AddressCity);
  const state = clean(stop.AddressState) || 'FL';
  const postalCode = clean(stop.AddressZip)?.replace(/\D/g, '').slice(0, 5) || null;
  const standardized = standardizeAddress({ street, city, state, postalCode });
  const latitude = stop.Latitude != null ? Number(stop.Latitude) : null;
  const longitude = stop.Longitude != null ? Number(stop.Longitude) : null;

  const resolvedLocationId = await resolveLocationIdForStop({
    locationId: stop.LocationId != null ? Number(stop.LocationId) : null,
    locationKey,
    street,
    city,
    postalCode,
  });
  const isConfigured = isMappedLocationStop({ locationId: resolvedLocationId, locationKey });

  const configuredDoctors = await loadConfiguredDoctors(routePlanStopId);

  const enteredPracticeName = await loadEnteredPracticeName(routePlanStopId).catch(() => null);
  const masterPracticeName = resolvedLocationId != null && resolvedLocationId > 0
    ? await loadPracticeNameForLocation(resolvedLocationId)
    : null;
  const practiceName = enteredPracticeName || masterPracticeName;

  const locationMappedDoctors = resolvedLocationId != null && resolvedLocationId > 0
    ? await loadLocationMappedDoctors(resolvedLocationId)
    : [];

  const locationPhone = resolvedLocationId != null && resolvedLocationId > 0
    ? await loadLocationPhone(resolvedLocationId)
    : null;
  const stopPhoneEarly = locationPhone
    || configuredDoctors.find((doc) => doc.phone)?.phone
    || null;

  const mappedDoctorIds = locationMappedDoctors.map((doctor) => doctor.doctorId);
  const masterDoctorsAtAddress = await loadMasterDoctorsAtAddress({
    street: standardized.street,
    city: standardized.city,
    state: standardized.state,
    postalCode: standardized.postalCode,
    practicePhone: stopPhoneEarly,
    excludeDoctorIds: mappedDoctorIds,
  });
  const unmappedDoctors = masterDoctorsAtAddress;

  const enrichmentRadius = input.radiusMiles ?? NPI_REGISTRY_ENRICHMENT_RADIUS_MILES;

  const localRegistry = await buildLocalRegistryEnrichment({
    street: standardized.street,
    city: standardized.city,
    state: standardized.state,
    postalCode: standardized.postalCode,
    latitude,
    longitude,
    radiusMiles: enrichmentRadius,
    includeNearby: false,
  });

  let rawOrganizations: NearbyOrgResult[] = localRegistry.organizations;
  let rawAllProviders: AddressProviderResult[] = localRegistry.allProviders.filter((provider) =>
    matchesTrackedDoctorSpecialty(provider.taxonomyCode, provider.taxonomyDesc),
  );
  let providerSummaryHint = localRegistry.summaryHint;
  let alreadyKnownCount = localRegistry.alreadyKnownCount;
  let prescriberCount = localRegistry.prescriberCount;
  let providerError: string | null = null;
  let orgSearchHint: string | null = localRegistry.lookupHint;

  if (ROUTE_THREE_USE_LIVE_NPPES) {
    const orgSearch = await findNearbyOrganizations({
      latitude,
      longitude,
      street,
      city,
      state,
      postalCode,
      radiusMiles: enrichmentRadius,
    });
    const providerSearch = await lookupProvidersAtAddress({
      street,
      city,
      state,
      postalCode,
      exactSuite: false,
    });

    providerError = 'error' in providerSearch ? (providerSearch.error ?? null) : null;
    const liveProviders = 'allProviders' in providerSearch ? providerSearch.allProviders || [] : [];
    const liveOrganizations = orgSearch.organizations || [];
    orgSearchHint = orgSearch.hint || orgSearchHint;

    const localOrgNpis = new Set(rawOrganizations.map((org) => org.npi));
    const localProviderNpis = new Set(rawAllProviders.map((provider) => provider.npi));
    rawOrganizations = [
      ...rawOrganizations,
      ...liveOrganizations.filter((org) => !localOrgNpis.has(org.npi)),
    ];
    rawAllProviders = [
      ...rawAllProviders,
      ...liveProviders.filter((provider) =>
        !localProviderNpis.has(provider.npi)
        && matchesTrackedDoctorSpecialty(provider.taxonomyCode, provider.taxonomyDesc),
      ),
    ];
    if ('summaryHint' in providerSearch && providerSearch.summaryHint) {
      providerSummaryHint = [localRegistry.summaryHint, providerSearch.summaryHint].filter(Boolean).join(' · ');
    }
    if ('alreadyKnownCount' in providerSearch) {
      alreadyKnownCount += providerSearch.alreadyKnownCount ?? 0;
    }
    if ('prescriberCount' in providerSearch) {
      prescriberCount += providerSearch.prescriberCount ?? 0;
    }
  }

  const stopPhone = configuredDoctors.find((doc) => doc.phone)?.phone ?? null;

  const organizations: RouteThreeOrganization[] = rawOrganizations.map((org) => {
    const sameAddress = Boolean(org.atSearchAddress) || streetsMatch(org.organizationAddress, street);
    const samePhone = phonesMatch(org.phone, stopPhone);
    const matchReason = sameAddress
      ? 'Same address'
      : samePhone
        ? 'Same phone'
        : 'Nearby NPI result';
    return {
      ...org,
      frontendStatus: 'new_provider' as const,
      matchReason,
      matchConfidence: confidenceFor(sameAddress, samePhone),
      sameAddress,
      samePhone,
      source: 'NPI Registry (local)',
    };
  });

  function decorateProvider(provider: AddressProviderResult): RouteThreeProvider {
    const sameAddress = streetsMatch(provider.providerAddress, street);
    const samePhone = phonesMatch(provider.phone, stopPhone);
    const frontendStatus: FrontendEntityStatus = provider.alreadyKnown ? 'needs_mapping' : 'new_provider';
    const matchReason = provider.alreadyKnown
      ? 'Already in system, not mapped'
      : sameAddress
        ? 'Same address'
        : samePhone
          ? 'Same phone'
          : 'Nearby NPI result';
    return {
      ...provider,
      frontendStatus,
      matchReason,
      matchConfidence: confidenceFor(sameAddress, samePhone),
      sameAddress,
      samePhone,
      source: 'NPI Registry (local)',
    };
  }

  const allProviders: RouteThreeProvider[] = filterProvidersAgainstDoctors(
    rawAllProviders.map(decorateProvider),
    [
      ...locationMappedDoctors.map((doctor) => ({
        doctorId: doctor.doctorId,
        npi: doctor.npi,
        doctorName: doctor.doctorName,
      })),
      ...masterDoctorsAtAddress.map((doctor) => ({
        doctorId: doctor.doctorId,
        npi: doctor.npi,
        doctorName: doctor.doctorName,
      })),
    ],
  );
  const newProviders: RouteThreeProvider[] = allProviders.filter((provider) => !provider.alreadyKnown);

  const rawUnifiedEntities = buildUnifiedLocationEntities({
    configuredDoctors,
    locationMappedDoctors,
    masterDoctorsAtAddress,
    organizations: ROUTE_THREE_USE_LIVE_NPPES
      ? organizations.filter((org) => !localRegistry.organizationRecords.some((record) => record.npi === org.npi))
      : [],
    allProviders: ROUTE_THREE_USE_LIVE_NPPES
      ? allProviders.filter((provider) => !localRegistry.records.some((record) => record.npi === provider.npi))
      : [],
    npiRegistryRecords: localRegistry.records.filter((record) =>
      matchesTrackedDoctorSpecialty(record.taxonomyCode, record.taxonomyDescription),
    ),
    npiRegistryOrganizations: localRegistry.organizationRecords,
  });
  const doctorIds = [
    ...locationMappedDoctors.map((doctor) => doctor.doctorId),
    ...masterDoctorsAtAddress.map((doctor) => doctor.doctorId),
    ...configuredDoctors.map((doctor) => doctor.doctorId),
  ];
  const specialtiesByDoctorId = await loadDoctorSpecialties(doctorIds);
  const { entities: unifiedEntities, recommendedFlyers } = await attachSpecialtyMatchedFlyers(
    rawUnifiedEntities,
    specialtiesByDoctorId,
  );

  const atAddressOrgCount = organizations.filter((org) => org.atSearchAddress).length;
  const needsMappingCount = masterDoctorsAtAddress.length + allProviders.filter((p) => p.frontendStatus === 'needs_mapping').length;
  const newProvidersDiscoveryCount = newProviders.length + organizations.length;
  const highDensity = organizations.length >= 8;
  return {
    routePlanStopId,
    locationKey,
    isConfigured,
    stopLabel: practiceName || clean(stop.StopLabel),
    // Only a real practice name (typed by the distributor or from Master_Practice).
    // Never the StopLabel, which can be a doctor/provider name on unmapped stops.
    practiceName,
    addressStreet: street,
    addressCity: city,
    addressState: state,
    addressZip: postalCode,
    latitude,
    longitude,
    phone: stopPhone,
    configuredDoctors,
    locationMappedDoctors,
    masterDoctorsAtAddress,
    unmappedDoctors,
    organizations,
    allProviders,
    newProviders,
    stats: {
      configuredDoctorCount: configuredDoctors.length,
      mappedDoctorCount: locationMappedDoctors.length,
      unmappedDoctorCount: masterDoctorsAtAddress.length,
      organizationCount: organizations.length,
      allProviderCount: allProviders.length,
      newProviderCount: newProviders.length,
      alreadyKnownProviderCount: allProviders.filter((p) => p.alreadyKnown).length,
      needsMappingCount,
      newProvidersDiscoveryCount,
      prescriberCount,
      atAddressOrgCount,
    },
    lookupHint: [localRegistry.lookupHint, orgSearchHint, providerSummaryHint, providerError].filter(Boolean).join(' · ') || null,
    highDensity,
    standardizedAddress: standardized.formattedAddress,
    unifiedEntities,
    recommendedFlyers,
  } satisfies RouteThreeEnrichmentResult;
}
