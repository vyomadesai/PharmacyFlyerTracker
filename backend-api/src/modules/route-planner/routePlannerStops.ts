import { getPool, sql } from '../../config/db.js';
import { isValidCoordinatePair, parseCoordinate } from '../../utils/geography.js';
import {
  filterByRadius,
  resolveCoordinatesForAddresses,
  resolveCoordinatesNearPoint,
  resolveStartPoint,
  isMappedLocationStop,
  stopLocationKey,
  type StartPointInput,
} from './routePlannerGeo.js';
import {
  findMatchingDoctorsForCampaign,
  type MatchedDoctorRow,
} from './routePlannerMatching.js';
import {
  computeLocationVisit,
  getLastVisitDateByDoctor,
  getLocationVisitFrequencies,
} from './routePlannerVisit.js';
import { DEFAULT_VISIT_FREQUENCY_DAYS } from './routePlannerConfig.js';
import type { TerritoryFilter } from './routePlannerTerritory.js';

export type RoutePlannerMatchOptions = StartPointInput & {
  radiusMiles?: number | null;
  /** Default visit frequency (days) applied to locations without a saved value. */
  visitFrequencyDays?: number | null;
  /** Include doctors without an active Doctor_Location_Mapping row (unconfigured stops). */
  includeUnmappedLocations?: boolean;
};

export type EnrichedDoctor = MatchedDoctorRow & {
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  coordinateSource: string | null;
};

export type RouteStopDoctor = {
  doctorId: number;
  doctorName: string;
  npi: string | null;
  matchedSpecialityCode: string | null;
  matchedSpecialityDescription: string | null;
  matchedLevel: string | null;
  phone: string | null;
  /** Campaign this doctor was matched under (required for multi-campaign merged stops). */
  matchedCampaignId?: number;
};

export type RouteStopFlyer = {
  campaignId: number;
  campaignName: string;
  flyerTitle: string | null;
};

export type RouteLocationStop = {
  locationKey: string;
  practiceId: number | null;
  locationId: number | null;
  stopLabel: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  doctorCount: number;
  flyerCount: number;
  doctors: RouteStopDoctor[];
  flyers: RouteStopFlyer[];
  // Location-based visit scheduling.
  visitFrequencyDays: number;
  lastVisitDate: string | null; // YYYY-MM-DD
  nextVisitDate: string | null; // YYYY-MM-DD
  isDue: boolean;
  /** True when tied to Master_Location via Doctor_Location_Mapping (loc:N key). */
  isConfigured: boolean;
};

type MasterLocationRecord = {
  locationId: number;
  locationName: string | null;
  practiceName: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

async function loadMasterLocationsByIds(locationIds: number[]): Promise<Map<number, MasterLocationRecord>> {
  const ids = [...new Set(locationIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, MasterLocationRecord>();
  if (!ids.length) return out;

  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, index) => request.input(`LocId${index}`, sql.Int, id));
  const inClause = ids.map((_, index) => `@LocId${index}`).join(', ');

  const result = await request.query(`
    SELECT
      ml.ID AS LocationId,
      LTRIM(RTRIM(ISNULL(ml.Location_Name, ''))) AS LocationName,
      LTRIM(RTRIM(ISNULL(mp.Practice_Name, ''))) AS PracticeName,
      LTRIM(RTRIM(ISNULL(ml.Location_AddressStreet, ''))) AS AddressStreet,
      LTRIM(RTRIM(ISNULL(ml.Location_AddressCity, ''))) AS AddressCity,
      '' AS AddressState,
      LTRIM(RTRIM(ISNULL(CAST(ml.Location_AddressZip AS VARCHAR(20)), ''))) AS AddressZip,
      NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_Phone, ''))), '') AS Phone
    FROM dbo.Master_Location ml
    LEFT JOIN dbo.Master_Practice mp ON mp.ID = ml.Practice_Id
    WHERE ml.ID IN (${inClause})
      AND ISNULL(ml.Location_IsActive, 1) = 1
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const locationId = Number(row.LocationId);
    if (!Number.isFinite(locationId) || locationId <= 0) continue;
    out.set(locationId, {
      locationId,
      locationName: trimOrNull(row.LocationName as string | null),
      practiceName: trimOrNull(row.PracticeName as string | null),
      addressStreet: trimOrNull(row.AddressStreet as string | null),
      addressCity: trimOrNull(row.AddressCity as string | null),
      addressState: trimOrNull(row.AddressState as string | null),
      addressZip: trimOrNull(row.AddressZip as string | null),
      phone: trimOrNull(row.Phone as string | null),
    });
  }

  return out;
}

function applyMasterLocationToDoctor(
  doctor: MatchedDoctorRow,
  location: MasterLocationRecord | undefined,
): MatchedDoctorRow {
  if (!location) return doctor;
  return {
    ...doctor,
    practiceName: location.practiceName || doctor.practiceName,
    locationName: location.locationName || doctor.locationName,
    locationAddressStreet: location.addressStreet,
    locationAddressCity: location.addressCity,
    locationAddressZip: location.addressZip,
    locationPhone: location.phone || doctor.locationPhone,
    addressState: location.addressState || doctor.addressState,
  };
}

async function enrichDoctorsWithCoordinates(
  doctors: MatchedDoctorRow[],
  near?: { latitude: number; longitude: number; radiusMiles: number },
): Promise<EnrichedDoctor[]> {
  const addressInputs = doctors.map((d) => ({
    key: d.locationId && d.locationId > 0
      ? `${d.doctorId}:loc:${d.locationId}`
      : `${d.doctorId}:doc`,
    street: d.locationAddressStreet || d.addressStreet,
    city: d.locationAddressCity || d.addressCity,
    state: d.addressState,
    zip: d.locationAddressZip || d.addressZip,
  }));

  const coordsByKey = near
    ? await resolveCoordinatesNearPoint(addressInputs, near.latitude, near.longitude, near.radiusMiles)
    : await resolveCoordinatesForAddresses(addressInputs);

  return doctors.map((d) => {
    const coordKey = d.locationId && d.locationId > 0
      ? `${d.doctorId}:loc:${d.locationId}`
      : `${d.doctorId}:doc`;
    const coord = coordsByKey.get(coordKey);
    return {
      ...d,
      latitude: coord?.latitude ?? null,
      longitude: coord?.longitude ?? null,
      distanceMiles: null,
      coordinateSource: coord?.source ?? null,
    };
  });
}

function stopAddressFields(doctor: EnrichedDoctor) {
  const mapped = Boolean(doctor.locationId && doctor.locationId > 0);
  return {
    addressStreet: mapped ? doctor.locationAddressStreet : doctor.addressStreet,
    addressCity: mapped ? doctor.locationAddressCity : doctor.addressCity,
    addressZip: mapped ? doctor.locationAddressZip : doctor.addressZip,
    stopLabel: doctor.practiceName || doctor.locationName || doctor.doctorName,
    phone: doctor.locationPhone || doctor.phone,
  };
}

async function finalizeMappedStopAddresses(stops: RouteLocationStop[]): Promise<void> {
  const locationMap = await loadMasterLocationsByIds(
    stops.map((stop) => stop.locationId).filter((id): id is number => id != null && id > 0),
  );

  for (const stop of stops) {
    const location = stop.locationId != null ? locationMap.get(stop.locationId) : undefined;
    if (!location) continue;
    stop.stopLabel = location.practiceName || location.locationName || stop.stopLabel;
    stop.addressStreet = location.addressStreet;
    stop.addressCity = location.addressCity;
    stop.addressState = location.addressState;
    stop.addressZip = location.addressZip;
    stop.phone = location.phone || stop.phone;
  }

  const geocodeInputs = stops
    .filter((stop) => stop.latitude == null || stop.longitude == null)
    .map((stop) => ({
      key: stop.locationKey,
      street: stop.addressStreet,
      city: stop.addressCity,
      state: stop.addressState,
      zip: stop.addressZip,
    }));

  if (!geocodeInputs.length) return;

  const coordsByKey = await resolveCoordinatesForAddresses(geocodeInputs);
  for (const stop of stops) {
    if (stop.latitude != null && stop.longitude != null) continue;
    const coord = coordsByKey.get(stop.locationKey);
    if (coord) {
      stop.latitude = coord.latitude;
      stop.longitude = coord.longitude;
    }
  }
}

export async function findEnrichedDoctorsForCampaign(
  campaignId: number,
  options: RoutePlannerMatchOptions = {},
) {
  const loaded = await findMatchingDoctorsForCampaign(
    campaignId,
    Boolean(options.includeUnmappedLocations),
  );
  if (!loaded) return null;

  const radiusMiles = options.radiusMiles != null && Number(options.radiusMiles) > 0
    ? Number(options.radiusMiles)
    : 10;

  const locationMap = await loadMasterLocationsByIds(
    loaded.doctors.map((d) => d.locationId).filter((id): id is number => id != null && id > 0),
  );
  const doctorsWithLocation = loaded.doctors.map((d) =>
    applyMasterLocationToDoctor(d, d.locationId != null ? locationMap.get(d.locationId) : undefined),
  );

  const startLat = parseCoordinate(options.startLatitude);
  const startLng = parseCoordinate(options.startLongitude);
  const startZip = String(options.startZip || '').replace(/\D/g, '').slice(0, 5);
  const startAddress = String(options.startAddress || '').trim();
  const hasStart =
    isValidCoordinatePair(startLat, startLng) || startZip.length === 5 || startAddress.length > 0;
  const near = isValidCoordinatePair(startLat, startLng)
    ? { latitude: startLat as number, longitude: startLng as number, radiusMiles }
    : undefined;

  let doctors = await enrichDoctorsWithCoordinates(doctorsWithLocation, near);

  let startPoint: Awaited<ReturnType<typeof resolveStartPoint>> | null = null;

  if (hasStart) {
    const resolved = await resolveStartPoint(options, radiusMiles);
    if ('error' in resolved) {
      return {
        error: resolved.error,
        campaign: loaded.campaign,
        doctors: [] as EnrichedDoctor[],
        startPoint: null,
        radiusMiles,
      };
    }
    startPoint = resolved;

    if (startPoint.centerLatitude != null && startPoint.centerLongitude != null) {
      doctors = filterByRadius(doctors, startPoint.centerLatitude, startPoint.centerLongitude, radiusMiles);
    }
  }

  return {
    campaign: loaded.campaign,
    doctors,
    startPoint,
    radiusMiles: hasStart ? radiusMiles : null,
  };
}

export async function buildLocationStopsForCampaign(
  campaignId: number,
  options: RoutePlannerMatchOptions = {},
) {
  const result = await findEnrichedDoctorsForCampaign(campaignId, options);
  if (!result) return null;
  if ('error' in result && result.error) {
    return {
      error: result.error,
      campaign: result.campaign,
      stops: [] as RouteLocationStop[],
      startPoint: null,
      radiusMiles: result.radiusMiles,
      doctorCount: 0,
    };
  }

  const campaign = result.campaign;
  const campaignIdNum = Number(campaign.CampaignId);
  const campaignName = String(campaign.CampaignName || '');
  const flyerTitle = campaign.FlyerTitle != null ? String(campaign.FlyerTitle) : campaignName;

  const stopMap = new Map<string, RouteLocationStop>();

  for (const doctor of result.doctors) {
    const { addressStreet, addressCity, addressZip, stopLabel, phone } = stopAddressFields(doctor);
    const locationId = doctor.locationId && doctor.locationId > 0 ? doctor.locationId : null;
    const key = stopLocationKey({
      locationId,
      practiceId: doctor.practiceId,
      addressStreet,
      addressZip,
      latitude: doctor.latitude,
      longitude: doctor.longitude,
      coordinateSource: doctor.coordinateSource,
    });

    let stop = stopMap.get(key);
    if (!stop) {
      stop = {
        locationKey: key,
        practiceId: doctor.practiceId,
        locationId,
        stopLabel,
        addressStreet,
        addressCity,
        addressState: doctor.addressState,
        addressZip,
        phone,
        latitude: doctor.latitude,
        longitude: doctor.longitude,
        distanceMiles: doctor.distanceMiles,
        doctorCount: 0,
        flyerCount: 1,
        doctors: [],
        flyers: [{
          campaignId: campaignIdNum,
          campaignName,
          flyerTitle,
        }],
        visitFrequencyDays: DEFAULT_VISIT_FREQUENCY_DAYS,
        lastVisitDate: null,
        nextVisitDate: null,
        isDue: true,
        isConfigured: isMappedLocationStop({ locationId, locationKey: key }),
      };
      stopMap.set(key, stop);
    } else if (doctor.distanceMiles != null && (stop.distanceMiles == null || doctor.distanceMiles < stop.distanceMiles)) {
      stop.distanceMiles = doctor.distanceMiles;
    }

    if (!stop.doctors.some((d) =>
      (doctor.doctorId !== 0 && d.doctorId === doctor.doctorId && d.matchedCampaignId === campaignIdNum)
      || (Boolean(doctor.npi) && d.npi === doctor.npi && d.matchedCampaignId === campaignIdNum)
    )) {
      stop.doctors.push({
        doctorId: doctor.doctorId,
        doctorName: doctor.doctorName,
        npi: doctor.npi,
        matchedSpecialityCode: doctor.matchedSpecialityCode,
        matchedSpecialityDescription: doctor.matchedSpecialityDescription,
        matchedLevel: doctor.matchedLevel,
        phone: doctor.phone,
        matchedCampaignId: campaignIdNum,
      });
      stop.doctorCount = stop.doctors.length;
    }
  }

  let stops = [...stopMap.values()]
    .sort((a, b) => {
      const aDist = a.distanceMiles ?? Number.MAX_VALUE;
      const bDist = b.distanceMiles ?? Number.MAX_VALUE;
      return aDist - bDist;
    });

  await finalizeMappedStopAddresses(stops.filter((stop) => stop.isConfigured));

  // Location-based visit scheduling: per-location saved frequency (falling back
  // to the requested default), last visit computed from completed drops/deliveries.
  const defaultVisitFrequencyDays =
    options.visitFrequencyDays != null && Number(options.visitFrequencyDays) > 0
      ? Math.floor(Number(options.visitFrequencyDays))
      : DEFAULT_VISIT_FREQUENCY_DAYS;

  const savedFrequencies = await getLocationVisitFrequencies(stops.map((s) => s.locationKey));
  const allDoctorIds = stops.flatMap((s) => s.doctors.map((d) => d.doctorId));
  const lastVisitByDoctor = await getLastVisitDateByDoctor(campaignIdNum, allDoctorIds);

  let dueLocations = 0;
  for (const stop of stops) {
    const freq = savedFrequencies.get(stop.locationKey) ?? defaultVisitFrequencyDays;
    const doctorDates = stop.doctors.map((d) => lastVisitByDoctor.get(d.doctorId) ?? null);
    const visit = computeLocationVisit(freq, doctorDates);
    stop.visitFrequencyDays = visit.visitFrequencyDays;
    stop.lastVisitDate = visit.lastVisitDate;
    stop.nextVisitDate = visit.nextVisitDate;
    stop.isDue = visit.isDue;
    if (visit.isDue) dueLocations += 1;
  }

  return {
    campaign,
    stops,
    startPoint: result.startPoint,
    radiusMiles: result.radiusMiles,
    doctorCount: result.doctors.length,
    defaultVisitFrequencyDays,
    coverage: {
      totalLocations: stops.length,
      dueLocations,
      notDueLocations: stops.length - dueLocations,
    },
  };
}

/** Build location stops filtered by pharmacy territory (not rep GPS). */
export async function buildLocationStopsForTerritory(
  campaignId: number,
  territory: TerritoryFilter,
  options: { visitFrequencyDays?: number | null } = {},
) {
  return buildLocationStopsForCampaign(campaignId, {
    startLatitude: territory.centerLatitude,
    startLongitude: territory.centerLongitude,
    radiusMiles: territory.radiusMiles,
    visitFrequencyDays: options.visitFrequencyDays,
  });
}
