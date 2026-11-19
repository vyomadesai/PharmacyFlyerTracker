import { milesBetween } from '../../utils/geography.js';
import { osrmDrivingDistancesFromOrigin } from '../../services/routeOptimizer/travel.js';
import type { RouteLocationStop } from './routePlannerStops.js';

/**
 * Route ordering uses driving distance from check-in (OSRM, road network).
 * Falls back to straight-line miles when OSRM is unavailable.
 */

export type CoordStop = {
  latitude?: number | null;
  longitude?: number | null;
  distanceMiles?: number | null;
};

function stopCoord(stop: CoordStop): { lat: number; lng: number } | null {
  const lat = stop.latitude != null ? Number(stop.latitude) : null;
  const lng = stop.longitude != null ? Number(stop.longitude) : null;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function straightLineMilesFromPoint(
  fromLat: number,
  fromLng: number,
  stop: CoordStop,
): number {
  const coord = stopCoord(stop);
  if (!coord) return Number.MAX_VALUE;
  return milesBetween(fromLat, fromLng, coord.lat, coord.lng);
}

function distanceFromPoint(
  fromLat: number,
  fromLng: number,
  stop: CoordStop,
): number {
  if (stop.distanceMiles != null && Number.isFinite(stop.distanceMiles)) {
    return stop.distanceMiles;
  }
  return straightLineMilesFromPoint(fromLat, fromLng, stop);
}

/** Set stop.distanceMiles using OSRM driving distance from the rep's check-in GPS. */
export async function applyDrivingDistancesFromCheckIn(
  stops: RouteLocationStop[],
  startLat: number,
  startLng: number,
): Promise<void> {
  const withCoords = stops.filter(
    (stop) => stop.latitude != null && stop.longitude != null,
  );
  if (!withCoords.length) return;

  const applyStraightLine = () => {
    withCoords.forEach((stop) => {
      stop.distanceMiles = Math.round(
        straightLineMilesFromPoint(startLat, startLng, stop) * 100,
      ) / 100;
    });
  };

  // Public OSRM caps table requests around 100 coordinates. Don't block check-in
  // if the table call is slow or the destination list is too large.
  const MAX_OSRM_DESTINATIONS = 80;
  const OSRM_BUDGET_MS = 8000;
  if (withCoords.length > MAX_OSRM_DESTINATIONS) {
    applyStraightLine();
    return;
  }

  let drivingMiles: Array<number | null> | null = null;
  try {
    drivingMiles = await Promise.race([
      osrmDrivingDistancesFromOrigin(
        { latitude: startLat, longitude: startLng },
        withCoords.map((stop) => ({
          latitude: Number(stop.latitude),
          longitude: Number(stop.longitude),
        })),
      ),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), OSRM_BUDGET_MS);
      }),
    ]);
  } catch {
    drivingMiles = null;
  }

  if (!drivingMiles) {
    applyStraightLine();
    return;
  }

  withCoords.forEach((stop, index) => {
    const driving = drivingMiles[index];
    if (driving != null && Number.isFinite(driving)) {
      stop.distanceMiles = driving;
      return;
    }
    stop.distanceMiles = Math.round(
      straightLineMilesFromPoint(startLat, startLng, stop) * 100,
    ) / 100;
  });
}

/** Pick the N stops nearest to the rep's check-in GPS (maximize count in range). */
export function selectNearestStops<T extends CoordStop>(
  stops: T[],
  startLat: number,
  startLng: number,
  maxCount: number,
): T[] {
  if (maxCount <= 0 || !stops.length) return [];

  const withDistance = stops.map((stop, index) => ({
    stop,
    index,
    dist: distanceFromPoint(startLat, startLng, stop),
  }));

  withDistance.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.index - b.index;
  });

  return withDistance.slice(0, maxCount).map((row) => row.stop);
}

/** Order stops by straight-line distance from the rep's check-in GPS (closest first). */
export function sortStopsByDistanceFromStart(
  stops: RouteLocationStop[],
  startLat: number,
  startLng: number,
): RouteLocationStop[] {
  return [...stops]
    .map((stop, index) => ({
      stop,
      index,
      dist: distanceFromPoint(startLat, startLng, stop),
    }))
    .sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : a.index - b.index))
    .map((row) => ({
      ...row.stop,
      distanceMiles:
        row.stop.distanceMiles != null && Number.isFinite(row.stop.distanceMiles)
          ? row.stop.distanceMiles
          : Math.round(straightLineMilesFromPoint(startLat, startLng, row.stop) * 100) / 100,
    }));
}

/** Greedy nearest-neighbor tour starting from the rep's GPS. */
export function orderStopsNearestNeighbor<T extends CoordStop>(
  stops: T[],
  startLat: number,
  startLng: number,
): T[] {
  const withCoords: T[] = [];
  const withoutCoords: T[] = [];

  for (const stop of stops) {
    if (stopCoord(stop)) withCoords.push(stop);
    else withoutCoords.push(stop);
  }

  const remaining = [...withCoords];
  const ordered: T[] = [];
  let cursorLat = startLat;
  let cursorLng = startLng;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.MAX_VALUE;
    for (let i = 0; i < remaining.length; i++) {
      const coord = stopCoord(remaining[i])!;
      const dist = milesBetween(cursorLat, cursorLng, coord.lat, coord.lng);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    const coord = stopCoord(next)!;
    cursorLat = coord.lat;
    cursorLng = coord.lng;
  }

  return [...ordered, ...withoutCoords];
}

function tourLength(stops: CoordStop[], startLat: number, startLng: number): number {
  if (!stops.length) return 0;
  let total = 0;
  let prevLat = startLat;
  let prevLng = startLng;
  for (const stop of stops) {
    const coord = stopCoord(stop);
    if (!coord) continue;
    total += milesBetween(prevLat, prevLng, coord.lat, coord.lng);
    prevLat = coord.lat;
    prevLng = coord.lng;
  }
  return total;
}

/** 2-opt improvement on a stop sequence (straight-line distances). */
export function improveStopOrderTwoOpt<T extends CoordStop>(
  stops: T[],
  startLat: number,
  startLng: number,
): T[] {
  const withCoords = stops.filter((s) => stopCoord(s));
  const withoutCoords = stops.filter((s) => !stopCoord(s));
  if (withCoords.length < 3) return [...withCoords, ...withoutCoords];

  let best = [...withCoords];
  let bestLen = tourLength(best, startLat, startLng);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const len = tourLength(candidate, startLat, startLng);
        if (len + 1e-9 < bestLen) {
          best = candidate;
          bestLen = len;
          improved = true;
        }
      }
    }
  }

  return [...best, ...withoutCoords];
}

/** Skip expensive 2-opt when the due list is very large (check-in must stay fast). */
const TWO_OPT_MAX_STOPS = 60;

/**
 * Order all due stops as a shortest path from check-in GPS.
 * When maxStops is set, only the nearest N are included (legacy/admin use).
 * Mobile check-in omits maxStops so the rep gets every due location in range.
 */
export function buildOptimizedStopRoute(
  stops: RouteLocationStop[],
  startLat: number,
  startLng: number,
  maxStops?: number,
): RouteLocationStop[] {
  const pool =
    maxStops != null && maxStops > 0
      ? selectNearestStops(stops, startLat, startLng, maxStops)
      : stops;
  const nnOrdered = orderStopsNearestNeighbor(pool, startLat, startLng);
  if (nnOrdered.length <= TWO_OPT_MAX_STOPS) {
    return improveStopOrderTwoOpt(nnOrdered, startLat, startLng);
  }
  return nnOrdered;
}
