export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseCoordinate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Reject null island and other unset coordinate pairs. */
export function isValidCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): lat is number {
  return lat != null && lng != null && !(lat === 0 && lng === 0);
}

export function parseOptionalBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return null;
}

export function cleanString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function haversineSql(alias: string, latParam: string, lonParam: string) {
  return `
    (3958.8 * 2 * ATN2(
      SQRT(
        POWER(SIN((RADIANS(${alias}.Latitude) - RADIANS(${latParam})) / 2.0), 2)
        + COS(RADIANS(${latParam})) * COS(RADIANS(${alias}.Latitude))
        * POWER(SIN((RADIANS(${alias}.Longitude) - RADIANS(${lonParam})) / 2.0), 2)
      ),
      SQRT(1.0 - (
        POWER(SIN((RADIANS(${alias}.Latitude) - RADIANS(${latParam})) / 2.0), 2)
        + COS(RADIANS(${latParam})) * COS(RADIANS(${alias}.Latitude))
        * POWER(SIN((RADIANS(${alias}.Longitude) - RADIANS(${lonParam})) / 2.0), 2)
      ))
    ))
  `;
}
