import { reverseGeocodeParts } from '../../services/routeOptimizer/addressSearch.js';
import { standardizeAddress } from '../../utils/standardizeAddress.js';
import {
  lookupNpiRegistryNearby,
} from '../npi-registry/npiRegistryLocationLookup.js';
import { DEFAULT_VISIT_FREQUENCY_DAYS, CHECK_IN_DISCOVERY_RADIUS_MILES } from './routePlannerConfig.js';
import type { RouteLocationStop } from './routePlannerStops.js';

export async function appendCampaignNpiRegistryStops(
  existingStops: RouteLocationStop[],
  input: {
    latitude: number;
    longitude: number;
    radiusMiles: number;
  },
) {
  const geocoded = await reverseGeocodeParts(input.latitude, input.longitude);
  const checkInZip = geocoded?.postalCode?.replace(/\D/g, '').slice(0, 5) || null;
  if (!checkInZip) return existingStops;

  const effectiveRadius = Math.min(input.radiusMiles ?? CHECK_IN_DISCOVERY_RADIUS_MILES, CHECK_IN_DISCOVERY_RADIUS_MILES);
  const nearby = await lookupNpiRegistryNearby({
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMiles: effectiveRadius,
    postalCode: checkInZip,
  });

  const existingKeys = new Set(existingStops.map((stop) => stop.locationKey));
  const added: RouteLocationStop[] = [];

  for (const group of nearby.groups) {
    const standardized = standardizeAddress({
      street: group.street,
      city: group.city,
      state: group.state,
      postalCode: group.postalCode,
    });
    if (existingKeys.has(standardized.locationKey)) continue;
    if (group.latitude == null || group.longitude == null) continue;

    added.push({
      locationKey: standardized.locationKey,
      practiceId: null,
      locationId: null,
      stopLabel: group.records[0]?.providerName || standardized.formattedAddress,
      addressStreet: standardized.street,
      addressCity: standardized.city,
      addressState: standardized.state,
      addressZip: standardized.postalCode,
      phone: group.phone,
      latitude: group.latitude,
      longitude: group.longitude,
      distanceMiles: group.distanceMiles,
      doctorCount: group.records.length,
      flyerCount: 0,
      doctors: [],
      flyers: [],
      visitFrequencyDays: DEFAULT_VISIT_FREQUENCY_DAYS,
      lastVisitDate: null,
      nextVisitDate: null,
      isDue: true,
      isConfigured: false,
    });
    existingKeys.add(standardized.locationKey);
  }

  return [...existingStops, ...added];
}
