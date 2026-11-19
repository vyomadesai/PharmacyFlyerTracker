// Route planning orchestrator — the Node "data_processing_node" pipeline,
// adapted to run in-process against the doctors already matched in Step 1.
//
// This mirrors optimize_routes.js (load -> geocode -> travel matrix -> solve ->
// build outputs) but, instead of writing CSV/HTML files, it returns plain JSON
// objects so the workflow UI can render the optimized route directly.
//
// Pipeline (identical idea to data_processing_node):
//   1. Geocode each doctor address via OSM/Nominatim (cached, ZIP fallback).
//   2. Merge doctors at the same building (~11 m) into one routable location.
//   3. Build an N x N driving-time matrix from OSRM (offline fallback).
//   4. Solve the single-person open route within the time budget (hours).
//   5. Emit ordered stops with arrival/departure clocks + a Google Maps link.

import { buildQuery, geocodeAddresses, GeocodeOptions } from './geocoding.js';
import { buildTravelMatrix, TravelOptions } from './travel.js';
import { solveRoute } from './optimizer.js';

const MPH_TO_KMH = 1.60934;

export type PlanDoctor = {
  doctorId?: number | null;
  targetName?: string | null;
  npiNumber?: string | null;
  specialty?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type PlanProgress = {
  phase: 'geocode' | 'matrix' | 'solve';
  done?: number;
  total?: number;
};

export type PlanOptions = {
  hours?: number;
  pitStopMinutes?: number;
  travel?: 'osrm' | 'offline';
  avgSpeedMph?: number;
  detourFactor?: number;
  osrmUrl?: string;
  startTime?: string; // 'HH:MM'
  onGeocodeProgress?: GeocodeOptions['onProgress'];
  // Coarse phase-level progress for the UI (geocode -> matrix -> solve).
  onProgress?: (ev: PlanProgress) => void;
};

export type RouteStop = {
  stopOrder: number;
  arrive: string;
  depart: string;
  driveMinFromPrev: number;
  serviceMin: number;
  addressStreet: string | null;
  city: string | null;
  zip: string | null;
  numDoctors: number;
  doctorIds: (number | null)[];
  doctorNames: string;
  phones: string;
  specialties: string[];
  latitude: number;
  longitude: number;
  doctors: PlanDoctor[];
};

export type UncoveredDoctor = {
  reason: 'not_enough_capacity' | 'could_not_geocode';
  doctorId: number | null;
  targetName: string;
  addressStreet: string | null;
  city: string | null;
  zip: string | null;
  specialty: string | null;
};

export type RoutePlan = {
  engine: string;
  travelEngineRequested: string;
  params: { hours: number; pitStopMinutes: number; startTime: string };
  totals: {
    inputDoctors: number;
    routableLocations: number;
    routedLocations: number;
    routedDoctors: number;
    ungeocodedDoctors: number;
    droppedLocations: number;
  };
  summary: {
    shiftHours: number;
    locations: number;
    doctors: number;
    driveMin: number;
    serviceMin: number;
    totalMin: number;
    utilizationPct: number;
    gmapsUrl: string;
  };
  stops: RouteStop[];
  uncovered: UncoveredDoctor[];
  routedDoctorIds: (number | null)[];
};

// Keep this in sync with stopLocationKey() in client-workflow.routes.ts so the
// optimizer's stop count matches what the saved route reports. The street
// address is authoritative (different streets = different physical locations);
// coordinates are only used as a fallback when there is no street at all. This
// stops many distinct addresses that share one ZIP-centroid coordinate from
// collapsing into a single stop.
const STOP_SUITE_RE = /[,\s]*(?:#|STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?\s*#?\s*\w+\b/gi;
function normalizeStopStreet(street?: string | null): string {
  let s = ' ' + String(street || '').toUpperCase().trim() + ' ';
  s = s.replace(STOP_SUITE_RE, ' ');
  s = s.replace(/[#.,]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
function locationMergeKey(doc: PlanDoctor, coord: [number, number]): string {
  const street = normalizeStopStreet(doc.addressStreet);
  const zip = String(doc.addressZip || '').trim();
  if (street) return `addr:${street}|${zip}`;
  return `geo:${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function clock(startMin: number, sec: number): string {
  const total = startMin + Math.round(sec / 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function gmapsUrl(coords: [number, number][]): string {
  if (!coords.length) return '';
  const base = 'https://www.google.com/maps/dir/?api=1';
  const origin = `&origin=${coords[0][0]},${coords[0][1]}`;
  const dest = `&destination=${coords[coords.length - 1][0]},${coords[coords.length - 1][1]}`;
  let way = '';
  if (coords.length > 2) {
    way = '&waypoints=' + coords.slice(1, -1).map(([la, lo]) => `${la},${lo}`).join('|');
  }
  return base + origin + dest + way;
}

function doctorName(d: PlanDoctor): string {
  return String(d.targetName || '').trim() || `Doctor ${d.doctorId ?? ''}`.trim();
}

/**
 * Build the optimized single-person route for a set of doctors.
 */
export async function planRoute(doctors: PlanDoctor[], options: PlanOptions = {}): Promise<RoutePlan> {
  const hours = options.hours ?? 8;
  const pitStopMinutes = options.pitStopMinutes ?? 10;
  const travelEngine = options.travel ?? 'osrm';
  const startTime = options.startTime ?? '09:00';
  const emit = options.onProgress ?? (() => {});

  // 1. Geocode every doctor address (cache + ZIP-centroid fallback).
  const queries = doctors.map((d) =>
    buildQuery(d.addressStreet, d.addressCity, d.addressState, d.addressZip)
  );
  emit({ phase: 'geocode', done: 0, total: 0 });
  const coordsByQuery = await geocodeAddresses(queries, {
    onProgress: (done, total) => {
      options.onGeocodeProgress?.(done, total);
      emit({ phase: 'geocode', done, total });
    }
  });

  // 2. Merge doctors at the same building (~11 m) into one routable location.
  const locCoords: [number, number][] = [];
  const locDoctors: PlanDoctor[][] = [];
  const keyToIdx = new Map<string, number>();
  const ungeocoded: PlanDoctor[] = [];

  doctors.forEach((doc, i) => {
    let c = coordsByQuery.get(queries[i]) || null;
    // Fall back to coordinates already known for this doctor (e.g. the
    // zip-centroid the preview step derived) so a Nominatim miss does not
    // silently drop a matched doctor.
    if (!c && doc.latitude != null && doc.longitude != null) {
      c = [Number(doc.latitude), Number(doc.longitude)];
    }
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      ungeocoded.push(doc);
      return;
    }
    const key = locationMergeKey(doc, c);
    if (!keyToIdx.has(key)) {
      keyToIdx.set(key, locCoords.length);
      locCoords.push([c[0], c[1]]);
      locDoctors.push([]);
    }
    locDoctors[keyToIdx.get(key)!].push(doc);
  });

  if (locCoords.length < 2) {
    // Not enough routable locations — return an empty-but-valid plan.
    return emptyPlan(doctors, ungeocoded, hours, pitStopMinutes, startTime, travelEngine, locCoords, locDoctors);
  }

  // 3. Driving-time matrix (OSRM real roads, offline fallback).
  emit({ phase: 'matrix', done: 0, total: 0 });
  const { matrix: M, engine } = await buildTravelMatrix(locCoords, {
    engine: travelEngine,
    avgSpeedKmh: (options.avgSpeedMph ?? 30) * MPH_TO_KMH,
    detourFactor: options.detourFactor ?? 1.3,
    osrmUrl: options.osrmUrl,
    onProgress: (done, total) => emit({ phase: 'matrix', done, total })
  } as TravelOptions);

  // 4. Solve the single-person open route within the time budget.
  emit({ phase: 'solve' });
  const stopSec = Math.round(pitStopMinutes * 60);
  const service = locCoords.map(() => stopSec);
  const budget = Math.round(hours * 3600);
  const { route, dropped } = solveRoute(M, service, budget);

  // 5. Build ordered stops with arrival/departure timing.
  const [sh, sm] = startTime.split(':').map(Number);
  const startMin = sh * 60 + sm;

  const stops: RouteStop[] = [];
  const routeCoords: [number, number][] = [];
  const routedDoctorIds: (number | null)[] = [];
  let departPrev = 0;
  let driveSum = 0;
  let serviceSum = 0;

  route.forEach((locIdx, k) => {
    const docs = locDoctors[locIdx];
    const [la, lo] = locCoords[locIdx];
    routeCoords.push([la, lo]);
    const drive = k === 0 ? 0 : M[route[k - 1]][locIdx];
    const arrive = k === 0 ? 0 : departPrev + drive;
    const svc = service[locIdx];
    const depart = arrive + svc;
    departPrev = depart;
    driveSum += drive;
    serviceSum += svc;
    docs.forEach((d) => routedDoctorIds.push(d.doctorId ?? null));

    const names = docs.map(doctorName).join('; ');
    const phones = [...new Set(docs.map((d) => String(d.phone || '').trim()).filter(Boolean))].sort().join('; ');
    const specialties = [...new Set(docs.map((d) => String(d.specialty || '').trim()).filter(Boolean))];

    stops.push({
      stopOrder: k + 1,
      arrive: clock(startMin, arrive),
      depart: clock(startMin, depart),
      driveMinFromPrev: Math.round((drive / 60) * 10) / 10,
      serviceMin: Math.round((svc / 60) * 10) / 10,
      addressStreet: docs[0].addressStreet ?? null,
      city: docs[0].addressCity ?? null,
      zip: docs[0].addressZip ?? null,
      numDoctors: docs.length,
      doctorIds: docs.map((d) => d.doctorId ?? null),
      doctorNames: names,
      phones,
      specialties,
      latitude: la,
      longitude: lo,
      doctors: docs
    });
  });

  const gmaps = gmapsUrl(routeCoords);

  // Uncovered: locations dropped for capacity + addresses that could not geocode.
  const uncovered: UncoveredDoctor[] = [];
  for (const li of dropped) {
    for (const d of locDoctors[li]) {
      uncovered.push({
        reason: 'not_enough_capacity',
        doctorId: d.doctorId ?? null,
        targetName: doctorName(d),
        addressStreet: d.addressStreet ?? null,
        city: d.addressCity ?? null,
        zip: d.addressZip ?? null,
        specialty: d.specialty ?? null
      });
    }
  }
  for (const d of ungeocoded) {
    uncovered.push({
      reason: 'could_not_geocode',
      doctorId: d.doctorId ?? null,
      targetName: doctorName(d),
      addressStreet: d.addressStreet ?? null,
      city: d.addressCity ?? null,
      zip: d.addressZip ?? null,
      specialty: d.specialty ?? null
    });
  }

  const totalSec = driveSum + serviceSum;
  const routedDoctors = stops.reduce((sum, s) => sum + s.numDoctors, 0);

  return {
    engine,
    travelEngineRequested: travelEngine,
    params: { hours, pitStopMinutes, startTime },
    totals: {
      inputDoctors: doctors.length,
      routableLocations: locCoords.length,
      routedLocations: stops.length,
      routedDoctors,
      ungeocodedDoctors: ungeocoded.length,
      droppedLocations: dropped.length
    },
    summary: {
      shiftHours: Math.round((budget / 3600) * 100) / 100,
      locations: stops.length,
      doctors: routedDoctors,
      driveMin: Math.round((driveSum / 60) * 10) / 10,
      serviceMin: Math.round((serviceSum / 60) * 10) / 10,
      totalMin: Math.round((totalSec / 60) * 10) / 10,
      utilizationPct: budget ? Math.round((1000 * totalSec) / budget) / 10 : 0,
      gmapsUrl: gmaps
    },
    stops,
    uncovered,
    routedDoctorIds
  };
}

function emptyPlan(
  doctors: PlanDoctor[],
  ungeocoded: PlanDoctor[],
  hours: number,
  pitStopMinutes: number,
  startTime: string,
  travelEngine: string,
  locCoords: [number, number][],
  locDoctors: PlanDoctor[][]
): RoutePlan {
  const uncovered: UncoveredDoctor[] = ungeocoded.map((d) => ({
    reason: 'could_not_geocode',
    doctorId: d.doctorId ?? null,
    targetName: doctorName(d),
    addressStreet: d.addressStreet ?? null,
    city: d.addressCity ?? null,
    zip: d.addressZip ?? null,
    specialty: d.specialty ?? null
  }));
  return {
    engine: 'none',
    travelEngineRequested: travelEngine,
    params: { hours, pitStopMinutes, startTime },
    totals: {
      inputDoctors: doctors.length,
      routableLocations: locCoords.length,
      routedLocations: 0,
      routedDoctors: 0,
      ungeocodedDoctors: ungeocoded.length,
      droppedLocations: 0
    },
    summary: {
      shiftHours: Math.round(hours * 100) / 100,
      locations: 0,
      doctors: 0,
      driveMin: 0,
      serviceMin: 0,
      totalMin: 0,
      utilizationPct: 0,
      gmapsUrl: ''
    },
    stops: [],
    uncovered,
    routedDoctorIds: []
  };
}
