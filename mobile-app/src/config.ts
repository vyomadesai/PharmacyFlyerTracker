import { useEffect, useState } from 'react';
import { api } from './services/api';

// Single source of truth for the check-in radius is the BACKEND. Set it once in
// the backend's .env (CHECK_IN_RADIUS_MILES=...) and the mobile app reads it
// from GET /client-workflow/app-config at runtime — nothing to configure here.
export const DEFAULT_CHECK_IN_RADIUS_MILES = 0.1;

// Module-level cache so the value is fetched once per app session and reused
// instantly by every screen that mounts afterwards.
let cachedRadiusMiles: number | null = null;

export async function fetchCheckInRadiusMiles(): Promise<number> {
  if (cachedRadiusMiles != null) return cachedRadiusMiles;
  try {
    const res = await api.get('/client-workflow/app-config');
    const value = Number(res.data?.checkInRadiusMiles);
    cachedRadiusMiles = Number.isFinite(value) && value > 0 ? value : DEFAULT_CHECK_IN_RADIUS_MILES;
  } catch {
    cachedRadiusMiles = DEFAULT_CHECK_IN_RADIUS_MILES;
  }
  return cachedRadiusMiles;
}

// React hook: returns the configured check-in radius, loading it from the
// backend on first use. Falls back to the default until the value arrives.
export function useCheckInRadiusMiles(): number {
  const [radius, setRadius] = useState<number>(cachedRadiusMiles ?? DEFAULT_CHECK_IN_RADIUS_MILES);
  useEffect(() => {
    let active = true;
    fetchCheckInRadiusMiles().then((value) => { if (active) setRadius(value); });
    return () => { active = false; };
  }, []);
  return radius;
}
