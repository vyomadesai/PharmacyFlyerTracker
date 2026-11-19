import { getPool, sql } from '../../config/db.js';
import { parseCoordinate } from '../../utils/geography.js';
import { geocodeAddresses } from '../../services/routeOptimizer/geocoding.js';
import { resolveStartPoint } from './routePlannerGeo.js';
import { DEFAULT_TERRITORY_RADIUS_MILES } from './routePlannerConfig.js';

export type RouteTerritory = {
  pharmacyId: number | null;
  centerLabel: string | null;
  centerAddress: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number;
  updatedAt: string | null;
};

export type TerritoryFilter = {
  centerLatitude: number;
  centerLongitude: number;
  radiusMiles: number;
  centerLabel?: string | null;
  centerAddress?: string | null;
  pharmacyId?: number | null;
};

function rowToTerritory(row: Record<string, unknown>): RouteTerritory {
  return {
    pharmacyId: row.PharmacyId != null ? Number(row.PharmacyId) : null,
    centerLabel: row.CenterLabel != null ? String(row.CenterLabel) : null,
    centerAddress: row.CenterAddress != null ? String(row.CenterAddress) : null,
    centerLatitude: row.CenterLatitude != null ? Number(row.CenterLatitude) : null,
    centerLongitude: row.CenterLongitude != null ? Number(row.CenterLongitude) : null,
    radiusMiles: row.RadiusMiles != null ? Number(row.RadiusMiles) : DEFAULT_TERRITORY_RADIUS_MILES,
    updatedAt: row.UpdatedAt instanceof Date
      ? row.UpdatedAt.toISOString()
      : row.UpdatedAt != null
        ? String(row.UpdatedAt)
        : null,
  };
}

async function resolveTerritoryCenter(territory: RouteTerritory): Promise<{
  centerLabel: string;
  centerAddress: string | null;
  centerLatitude: number;
  centerLongitude: number;
  radiusMiles: number;
  pharmacyId: number | null;
} | { error: string }> {
  const radiusMiles = territory.radiusMiles > 0
    ? territory.radiusMiles
    : DEFAULT_TERRITORY_RADIUS_MILES;

  const address = territory.centerAddress?.trim() || null;
  let lat = territory.centerLatitude;
  let lng = territory.centerLongitude;
  const label = territory.centerLabel?.trim() || address || 'Centroid';

  if (lat != null && lng != null) {
    return {
      centerLabel: label,
      centerAddress: address,
      centerLatitude: lat,
      centerLongitude: lng,
      radiusMiles,
      pharmacyId: null,
    };
  }

  if (address) {
    const resolved = await resolveStartPoint({ startAddress: address }, radiusMiles);
    if ('error' in resolved) return { error: resolved.error };
    if (resolved.centerLatitude != null && resolved.centerLongitude != null) {
      return {
        centerLabel: label,
        centerAddress: address,
        centerLatitude: resolved.centerLatitude,
        centerLongitude: resolved.centerLongitude,
        radiusMiles,
        pharmacyId: null,
      };
    }
  }

  return { error: 'Coverage centroid is not configured. Enter a center address and save.' };
}

export async function getRouteTerritory(): Promise<RouteTerritory> {
  const pool = await getPool();
  try {
    const result = await pool.request().query(`
      SELECT TOP 1
        PharmacyId,
        CenterLabel,
        CenterAddress,
        CenterLatitude,
        CenterLongitude,
        RadiusMiles,
        UpdatedAt
      FROM dbo.PharmacyFlyer_RouteTerritoryV2
      WHERE TerritoryId = 1
    `);
    if (result.recordset[0]) {
      return rowToTerritory(result.recordset[0] as Record<string, unknown>);
    }
  } catch {
    /* table may not exist yet */
  }

  return {
    pharmacyId: null,
    centerLabel: null,
    centerAddress: null,
    centerLatitude: null,
    centerLongitude: null,
    radiusMiles: DEFAULT_TERRITORY_RADIUS_MILES,
    updatedAt: null,
  };
}

export async function getResolvedRouteTerritory() {
  const territory = await getRouteTerritory();
  const resolved = await resolveTerritoryCenter(territory);
  if ('error' in resolved) {
    return { territory, resolved: null, error: resolved.error };
  }
  return { territory, resolved, error: null };
}

export async function saveRouteTerritory(
  input: {
    pharmacyId?: number | null;
    centerLabel?: string | null;
    centerAddress?: string | null;
    centerLatitude?: number | null;
    centerLongitude?: number | null;
    radiusMiles?: number | null;
  },
  updatedBy?: number | null,
): Promise<{ territory: RouteTerritory; resolved: Awaited<ReturnType<typeof resolveTerritoryCenter>> extends infer R
  ? R extends { error: string } ? never : R
  : never } | { error: string }> {
  const radiusRaw = input.radiusMiles != null ? Number(input.radiusMiles) : DEFAULT_TERRITORY_RADIUS_MILES;
  const radiusMiles = Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : DEFAULT_TERRITORY_RADIUS_MILES;

  let lat = input.centerLatitude != null ? parseCoordinate(input.centerLatitude) : null;
  let lng = input.centerLongitude != null ? parseCoordinate(input.centerLongitude) : null;
  const centerAddress = input.centerAddress != null ? String(input.centerAddress).trim() || null : null;
  if (!centerAddress) {
    return { error: 'centerAddress is required.' };
  }
  const centerLabel = input.centerLabel?.trim() || centerAddress.split(',')[0]?.trim() || 'Centroid';

  if ((lat == null || lng == null) && centerAddress) {
    const geocoded = await geocodeAddresses([centerAddress], { minDelaySeconds: 1.1 });
    const coord = geocoded.get(centerAddress);
    if (coord) {
      lat = coord[0];
      lng = coord[1];
    }
  }

  const pool = await getPool();
  await pool.request()
    .input('PharmacyId', sql.Int, null)
    .input('CenterLabel', sql.NVarChar, centerLabel)
    .input('CenterAddress', sql.NVarChar, centerAddress)
    .input('CenterLatitude', sql.Decimal(10, 7), lat)
    .input('CenterLongitude', sql.Decimal(10, 7), lng)
    .input('RadiusMiles', sql.Decimal(8, 2), radiusMiles)
    .input('UpdatedBy', sql.Int, updatedBy ?? null)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.PharmacyFlyer_RouteTerritoryV2 WHERE TerritoryId = 1)
        UPDATE dbo.PharmacyFlyer_RouteTerritoryV2
        SET PharmacyId = @PharmacyId,
            CenterLabel = @CenterLabel,
            CenterAddress = @CenterAddress,
            CenterLatitude = @CenterLatitude,
            CenterLongitude = @CenterLongitude,
            RadiusMiles = @RadiusMiles,
            UpdatedAt = SYSDATETIME(),
            UpdatedBy = @UpdatedBy
        WHERE TerritoryId = 1
      ELSE
        INSERT INTO dbo.PharmacyFlyer_RouteTerritoryV2 (
          TerritoryId, PharmacyId, CenterLabel, CenterAddress,
          CenterLatitude, CenterLongitude, RadiusMiles, UpdatedAt, UpdatedBy
        )
        VALUES (1, @PharmacyId, @CenterLabel, @CenterAddress,
                @CenterLatitude, @CenterLongitude, @RadiusMiles, SYSDATETIME(), @UpdatedBy)
    `);

  const territory = await getRouteTerritory();
  const resolved = await resolveTerritoryCenter(territory);
  if ('error' in resolved) return { error: resolved.error };
  return { territory, resolved };
}
