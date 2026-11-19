import { normalizeStopStreet } from '../modules/route-planner/routePlannerGeo.js';

/** Suite/unit markers in USPS-style addresses (STE 300, #27924, SUITE/#327, etc.). */
const SUITE_SEGMENT_RE =
  /(?:^|[\s,]+)(?:#|(?:STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?)\s*(?:[/#]\s*)?\#?\s*([A-Z0-9-]+)\b/gi;

const STRIP_SUITE_RE =
  /(?:^|[\s,]+)(?:#|(?:STE|SUITE|APT|APARTMENT|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\.?)\s*(?:[/#]\s*)?\#?\s*[A-Z0-9-]+\b/gi;

export type ParsedStreetAddress = {
  /** Original street line (may include suite). */
  fullStreet: string;
  /** Street number + name without suite/unit. */
  buildingStreet: string;
  /** Normalized suite key (e.g. "300", "27924") or null when absent. */
  suiteKey: string | null;
  /** Human-readable suite label for UI (e.g. "STE 300", "#27924"). */
  suiteLabel: string | null;
};

export function normalizeSuiteKey(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim().toUpperCase();
  if (!text) return null;
  const cleaned = text.replace(/[^A-Z0-9]/g, '');
  return cleaned || null;
}

function extractSuiteMatches(text: string) {
  const matches: Array<{ key: string; label: string; index: number }> = [];
  const re = new RegExp(SUITE_SEGMENT_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = normalizeSuiteKey(match[1]);
    if (!key) continue;
    matches.push({
      key,
      label: match[0].trim().replace(/^[\s,]+/, ''),
      index: match.index,
    });
  }
  return matches;
}

export function stripSuiteFromStreet(street: string): string {
  return String(street || '')
    .replace(STRIP_SUITE_RE, ' ')
    .replace(/#/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a single street line into building + optional suite. */
export function parseStreetWithSuite(street: string | null | undefined): ParsedStreetAddress {
  const fullStreet = String(street || '').trim();
  if (!fullStreet) {
    return { fullStreet: '', buildingStreet: '', suiteKey: null, suiteLabel: null };
  }

  const suiteMatches = extractSuiteMatches(fullStreet.toUpperCase());
  const lastSuite = suiteMatches.length ? suiteMatches[suiteMatches.length - 1] : null;

  return {
    fullStreet,
    buildingStreet: stripSuiteFromStreet(fullStreet),
    suiteKey: lastSuite?.key ?? null,
    suiteLabel: lastSuite?.label ?? null,
  };
}

export function combineAddressLines(...lines: Array<string | null | undefined>) {
  return lines.map((line) => String(line || '').trim()).filter(Boolean).join(' ');
}

function buildingStreetsMatch(
  providerBuilding: string,
  searchBuilding: string,
): boolean {
  const left = normalizeStopStreet(providerBuilding);
  const right = normalizeStopStreet(searchBuilding);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

export type AddressMatchProvider = {
  address1: string | null;
  address2: string | null;
};

/**
 * Match a provider location to a typed search street.
 * When the search includes a suite/unit, require an exact suite match on address1+address2.
 * When the search is building-only, match any org on the same building street.
 */
export function providerMatchesSearchStreet(
  provider: AddressMatchProvider,
  searchStreet: string | null | undefined,
): boolean {
  if (!searchStreet?.trim()) return true;

  const search = parseStreetWithSuite(searchStreet);
  const providerLine = combineAddressLines(provider.address1, provider.address2);
  const providerParsed = parseStreetWithSuite(providerLine);

  const providerBuilding = providerParsed.buildingStreet || providerLine;
  if (!buildingStreetsMatch(providerBuilding, search.buildingStreet || searchStreet)) {
    return false;
  }

  if (search.suiteKey) {
    if (!providerParsed.suiteKey) return false;
    return providerParsed.suiteKey === search.suiteKey;
  }

  return true;
}

export function providerSuiteLabel(provider: AddressMatchProvider): string | null {
  const line = combineAddressLines(provider.address1, provider.address2);
  return parseStreetWithSuite(line).suiteLabel;
}
