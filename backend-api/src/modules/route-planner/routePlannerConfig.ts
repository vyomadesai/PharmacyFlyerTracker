/*
 * Route planner configuration.
 *
 * Three different radii — do not mix them:
 * 1. Territory (pharmacy center): who is eligible for a campaign.
 * 2. Daily discovery (rep check-in GPS): offices shown for today's route.
 * 3. Arrival proof (CHECK_IN_RADIUS_MILES in env.ts): must be at the stop to check in.
 */

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Default territory radius (miles) around the pharmacy — eligible doctor universe. */
export const DEFAULT_TERRITORY_RADIUS_MILES = positiveNumberFromEnv('ROUTE_PLANNER_TERRITORY_RADIUS_MILES', 30);

/**
 * @deprecated Rep GPS no longer filters eligibility. Kept for legacy route plan records.
 * Territory radius from PharmacyFlyer_RouteTerritoryV2 is the eligibility filter.
 */
export const ROUTE_PLANNER_RADIUS_MILES = positiveNumberFromEnv('ROUTE_PLANNER_RADIUS_MILES', 15);

/** Radius for local NPI registry stop discovery at check-in (aligned with daily work radius). */
export const NPI_REGISTRY_RADIUS_MILES = Math.min(
  positiveNumberFromEnv('NPI_REGISTRY_RADIUS_MILES', 5),
  15,
);

/** Per-stop enrichment radius when searching local NPI registry around a stop. */
export const NPI_REGISTRY_ENRICHMENT_RADIUS_MILES = Math.min(
  positiveNumberFromEnv('NPI_REGISTRY_ENRICHMENT_RADIUS_MILES', 0.5),
  5,
);

/**
 * Daily work radius (miles) around the rep's check-in GPS.
 * A flyer drop is typically 15–20 minutes including drive, so 10+ miles dumps
 * more offices than one person can cover in a day.
 */
export const CHECK_IN_DISCOVERY_RADIUS_MILES = Math.min(
  positiveNumberFromEnv('CHECK_IN_DISCOVERY_RADIUS_MILES', 5),
  15,
);

/** Set ROUTE_THREE_USE_LIVE_NPPES=true to supplement local registry with live NPPES API calls. */
export const ROUTE_THREE_USE_LIVE_NPPES = process.env.ROUTE_THREE_USE_LIVE_NPPES === 'true';

/**
 * Legacy cap for admin-saved manual route plans only.
 * Mobile check-in does not use a stop cap.
 */
export const ROUTE_PLANNER_MAX_STOPS_PER_ROUTE = Math.floor(
  positiveNumberFromEnv('ROUTE_PLANNER_MAX_STOPS_PER_ROUTE', 15),
);

/**
 * Default number of days between sales-rep visits to a location, used when a
 * location has no explicitly saved Visit Frequency. Next Visit Date =
 * Last Visit Date + Visit Frequency.
 */
export const DEFAULT_VISIT_FREQUENCY_DAYS = Math.floor(
  positiveNumberFromEnv('ROUTE_PLANNER_DEFAULT_VISIT_FREQUENCY_DAYS', 30),
);
