import { getPool, sql } from '../../config/db.js';
import { standardizeAddress } from '../../utils/standardizeAddress.js';
import {
  filterByRadius,
  isMappedLocationStop,
  resolveCoordinatesNearPoint,
  stopLocationKey,
} from './routePlannerGeo.js';
import { DEFAULT_VISIT_FREQUENCY_DAYS, CHECK_IN_DISCOVERY_RADIUS_MILES } from './routePlannerConfig.js';
import type { RouteLocationStop, RouteStopDoctor } from './routePlannerStops.js';


type MappedLocationRow = {
  locationId: number;
  locationName: string | null;
  practiceName: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  phone: string | null;
};

type MappedDoctorRow = {
  doctorId: number;
  doctorName: string;
  npi: string | null;
  phone: string | null;
  locationId: number;
};

async function loadActiveMappedLocations() {
  const pool = await getPool();
  const result = await pool.request().query(`
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
    WHERE ISNULL(ml.Location_IsActive, 1) = 1
      AND NULLIF(LTRIM(RTRIM(ISNULL(ml.Location_AddressStreet, ''))), '') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM dbo.Doctor_Location_Mapping dlm
        WHERE dlm.Location_Id = ml.ID
          AND ISNULL(dlm.Mapping_IsActive, 0) = 1
          AND dlm.Location_Id IS NOT NULL
      )
    ORDER BY ml.ID
  `);

  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    locationId: Number(row.LocationId),
    locationName: String(row.LocationName || '').trim() || null,
    practiceName: String(row.PracticeName || '').trim() || null,
    addressStreet: String(row.AddressStreet || '').trim() || null,
    addressCity: String(row.AddressCity || '').trim() || null,
    addressState: String(row.AddressState || '').trim() || 'FL',
    addressZip: String(row.AddressZip || '').trim() || null,
    phone: String(row.Phone || '').trim() || null,
  })).filter((row) => row.locationId > 0) as MappedLocationRow[];
}

async function loadMappedDoctorsByLocationIds(locationIds: number[]) {
  const ids = [...new Set(locationIds.filter((id) => id > 0))];
  const byLocation = new Map<number, MappedDoctorRow[]>();
  if (!ids.length) return byLocation;

  const pool = await getPool();
  const request = pool.request();
  ids.forEach((id, index) => request.input(`LocId${index}`, sql.Int, id));
  const inClause = ids.map((_, index) => `@LocId${index}`).join(', ');

  const result = await request.query(`
    SELECT
      dlm.Location_Id AS LocationId,
      d.ID AS DoctorId,
      LTRIM(RTRIM(CONCAT(ISNULL(d.Doctor_FirstName, ''), ' ', ISNULL(d.Doctor_LastName, '')))) AS DoctorName,
      NULLIF(LTRIM(RTRIM(CAST(d.Doctor_NPINo AS VARCHAR(20)))), '') AS Npi,
      NULLIF(LTRIM(RTRIM(COALESCE(dlm.Doctor_Phone, d.Doctor_Phone, d.Doctor_MobileNo, ''))), '') AS Phone
    FROM dbo.Doctor_Location_Mapping dlm
    INNER JOIN dbo.Master_Doctor d ON d.Doctor_NO = dlm.Doctor_No
    WHERE ISNULL(dlm.Mapping_IsActive, 0) = 1
      AND dlm.Location_Id IN (${inClause})
      AND LTRIM(RTRIM(ISNULL(d.Doctor_IsActive, ' '))) <> 'N'
    ORDER BY dlm.Location_Id, DoctorName
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const locationId = Number(row.LocationId);
    const doctor: MappedDoctorRow = {
      locationId,
      doctorId: Number(row.DoctorId),
      doctorName: String(row.DoctorName || '').trim() || 'Doctor',
      npi: row.Npi != null ? String(row.Npi).trim() : null,
      phone: row.Phone != null ? String(row.Phone).trim() : null,
    };
    const list = byLocation.get(locationId) || [];
    list.push(doctor);
    byLocation.set(locationId, list);
  }

  return byLocation;
}

export async function appendMappedLocationStops(
  existingStops: RouteLocationStop[],
  input: {
    latitude: number;
    longitude: number;
    radiusMiles?: number;
  },
) {
  const radiusMiles = Math.min(input.radiusMiles ?? CHECK_IN_DISCOVERY_RADIUS_MILES, CHECK_IN_DISCOVERY_RADIUS_MILES);
  const locations = await loadActiveMappedLocations();
  if (!locations.length) return existingStops;

  const geocodeInputs = locations.map((location) => ({
    key: `loc:${location.locationId}`,
    street: location.addressStreet,
    city: location.addressCity,
    state: location.addressState || 'FL',
    zip: location.addressZip,
  }));
  const coordsByKey = await resolveCoordinatesNearPoint(
    geocodeInputs,
    input.latitude,
    input.longitude,
    radiusMiles,
  );

  const withCoords = locations.map((location) => {
    const key = `loc:${location.locationId}`;
    const coord = coordsByKey.get(key);
    return {
      ...location,
      latitude: coord?.latitude ?? null,
      longitude: coord?.longitude ?? null,
    };
  });

  const withinRadius = filterByRadius(
    withCoords,
    input.latitude,
    input.longitude,
    radiusMiles,
  );

  const doctorsByLocation = await loadMappedDoctorsByLocationIds(
    withinRadius.map((location) => location.locationId),
  );

  const existingKeys = new Set(existingStops.map((stop) => stop.locationKey));
  const existingAddrKeys = new Set(
    existingStops.map((stop) => standardizeAddress({
      street: stop.addressStreet,
      city: stop.addressCity,
      state: stop.addressState || 'FL',
      postalCode: stop.addressZip,
    }).locationKey),
  );

  const added: RouteLocationStop[] = [];

  for (const location of withinRadius) {
    const locationKey = stopLocationKey({
      locationId: location.locationId,
      addressStreet: location.addressStreet,
      addressZip: location.addressZip,
      latitude: location.latitude,
      longitude: location.longitude,
    });
    const addrKey = standardizeAddress({
      street: location.addressStreet,
      city: location.addressCity,
      state: location.addressState || 'FL',
      postalCode: location.addressZip,
    }).locationKey;

    if (existingKeys.has(locationKey) || existingAddrKeys.has(addrKey)) continue;

    const doctors = doctorsByLocation.get(location.locationId) || [];
    const doctorRows: RouteStopDoctor[] = doctors.map((doctor) => ({
      doctorId: doctor.doctorId,
      doctorName: doctor.doctorName,
      npi: doctor.npi,
      matchedSpecialityCode: null,
      matchedSpecialityDescription: null,
      matchedLevel: null,
      phone: doctor.phone,
    }));

    added.push({
      locationKey,
      practiceId: null,
      locationId: location.locationId,
      stopLabel: location.practiceName || location.locationName || location.addressStreet || 'Mapped practice',
      addressStreet: location.addressStreet,
      addressCity: location.addressCity,
      addressState: location.addressState || 'FL',
      addressZip: location.addressZip,
      phone: location.phone,
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMiles: location.distanceMiles,
      doctorCount: doctorRows.length,
      flyerCount: 0,
      doctors: doctorRows,
      flyers: [],
      visitFrequencyDays: DEFAULT_VISIT_FREQUENCY_DAYS,
      lastVisitDate: null,
      nextVisitDate: null,
      isDue: true,
      isConfigured: isMappedLocationStop({ locationId: location.locationId, locationKey }),
    });
    existingKeys.add(locationKey);
    existingAddrKeys.add(addrKey);
  }

  return [...existingStops, ...added];
}

export function stopStandardizedAddressKey(stop: RouteLocationStop) {
  return standardizeAddress({
    street: stop.addressStreet,
    city: stop.addressCity,
    state: stop.addressState || 'FL',
    postalCode: stop.addressZip,
  }).locationKey;
}

export function mergeStopsByLocationAndAddress(stops: RouteLocationStop[]): RouteLocationStop[] {
  const byCanonicalKey = new Map<string, RouteLocationStop>();
  const addrToCanonical = new Map<string, string>();

  for (const stop of stops) {
    const addrKey = stopStandardizedAddressKey(stop);
    let canonicalKey = byCanonicalKey.has(stop.locationKey)
      ? stop.locationKey
      : addrToCanonical.get(addrKey) || stop.locationKey;

    if (stop.locationId && stop.locationId > 0) {
      const locKey = `loc:${stop.locationId}`;
      if (byCanonicalKey.has(locKey)) canonicalKey = locKey;
      else if (!addrToCanonical.has(addrKey)) canonicalKey = locKey;
    }

    const existing = byCanonicalKey.get(canonicalKey);
    if (!existing) {
      byCanonicalKey.set(canonicalKey, {
        ...stop,
        locationKey: canonicalKey,
        doctors: [...stop.doctors],
        flyers: [...stop.flyers],
      });
      addrToCanonical.set(addrKey, canonicalKey);
      continue;
    }

    for (const doctor of stop.doctors) {
      const dup = existing.doctors.some(
        (d) => d.doctorId === doctor.doctorId && d.matchedCampaignId === doctor.matchedCampaignId,
      );
      if (!dup) existing.doctors.push({ ...doctor });
    }
    existing.doctorCount = existing.doctors.length;

    for (const flyer of stop.flyers) {
      if (!existing.flyers.some((f) => f.campaignId === flyer.campaignId)) {
        existing.flyers.push({ ...flyer });
      }
    }
    existing.flyerCount = existing.flyers.length;

    if (stop.distanceMiles != null && (existing.distanceMiles == null || stop.distanceMiles < existing.distanceMiles)) {
      existing.distanceMiles = stop.distanceMiles;
    }
    if (!existing.phone && stop.phone) existing.phone = stop.phone;
    if (!existing.latitude && stop.latitude) existing.latitude = stop.latitude;
    if (!existing.longitude && stop.longitude) existing.longitude = stop.longitude;
    if (!existing.locationId && stop.locationId) existing.locationId = stop.locationId;
    if (!existing.isConfigured && stop.isConfigured) existing.isConfigured = stop.isConfigured;
    if (stop.locationId && !existing.stopLabel && stop.stopLabel) existing.stopLabel = stop.stopLabel;

    addrToCanonical.set(addrKey, canonicalKey);
  }

  return [...byCanonicalKey.values()].sort((a, b) => {
    const aDist = a.distanceMiles ?? Number.MAX_VALUE;
    const bDist = b.distanceMiles ?? Number.MAX_VALUE;
    return aDist - bDist;
  });
}
