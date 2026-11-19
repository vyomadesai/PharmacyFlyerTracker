import { parseStreetWithSuite } from '../../utils/streetAddressMatch.js';
import { findNearbyOrganizations } from './newEntriesNearbyOrgs.js';
import { lookupProvidersAtAddress } from './newEntriesProvidersAtAddress.js';

const HIGH_DENSITY_ORG_THRESHOLD = 10;
const SUSPICIOUS_SUITE_NUMBER = 1000;

function isSuspiciousSuiteLabel(suiteLabel: string | null | undefined) {
  const parsed = parseStreetWithSuite(suiteLabel || '');
  const key = parsed.suiteKey;
  if (!key || !/^\d+$/.test(key)) return false;
  return Number(key) >= SUSPICIOUS_SUITE_NUMBER;
}

function countLlcOrgs(orgs: Array<{ organizationName: string }>) {
  return orgs.filter((org) => /\bLLC\b/i.test(org.organizationName)).length;
}

function countUniqueTaxonomies(orgs: Array<{ taxonomyCode?: string | null; taxonomyDesc?: string | null }>) {
  const codes = new Set(
    orgs.map((org) => String(org.taxonomyCode || org.taxonomyDesc || '').trim()).filter(Boolean),
  );
  return codes.size;
}

export async function buildNpiSummaryAtAddress(input: {
  latitude?: number | null;
  longitude?: number | null;
  addressText?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  exactSuite?: boolean;
  dropStatus?: string | null;
}) {
  const street = input.street?.trim() || null;
  const parsedStreet = street ? parseStreetWithSuite(street) : null;
  const typedSuiteKey = parsedStreet?.suiteKey ?? null;

  const orgResult = await findNearbyOrganizations({
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMiles: 0.5,
    street,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    addressText: input.addressText,
  });

  const organizations = orgResult.organizations || [];
  const exactSuiteOrgs = typedSuiteKey
    ? organizations.filter((org) => {
        const orgSuite = parseStreetWithSuite(org.suiteLabel || org.organizationAddress);
        return orgSuite.suiteKey === typedSuiteKey || org.atSearchAddress;
      })
    : organizations.filter((org) => org.atSearchAddress);

  const suiteOrgCount = exactSuiteOrgs.length || organizations.length;
  const highDensity = suiteOrgCount >= HIGH_DENSITY_ORG_THRESHOLD;
  const suspiciousSuite = isSuspiciousSuiteLabel(parsedStreet?.suiteLabel || street);
  const llcCount = countLlcOrgs(organizations);
  const taxonomyCount = countUniqueTaxonomies(organizations);
  const manyUnrelatedTaxonomies = taxonomyCount >= 8 && suiteOrgCount >= 5;
  const manyLlcs = llcCount >= 5 && suiteOrgCount >= 5;

  const providerResult = await lookupProvidersAtAddress({
    street,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    exactSuite: Boolean(input.exactSuite && typedSuiteKey),
  });

  const providerStats = 'error' in providerResult
    ? {
        providerCount: 0,
        newProviderCount: 0,
        alreadyKnownProviderCount: 0,
        prescriberCount: 0,
        nonPrescriberCount: 0,
      }
    : {
        providerCount: providerResult.allProviders.length,
        newProviderCount: providerResult.newCount,
        alreadyKnownProviderCount: providerResult.alreadyKnownCount,
        prescriberCount: providerResult.prescriberCount,
        nonPrescriberCount: providerResult.nonPrescriberCount,
      };

  const dropStatus = String(input.dropStatus || '').trim().toLowerCase();
  const physicalFlyerDrops = dropStatus === 'dropped' ? 1 : 0;

  const warnings: string[] = [];
  if (highDensity) {
    warnings.push(
      'High NPI density detected.',
    );
  }
  if (suspiciousSuite) {
    warnings.push('Suite label uses an unusually large number, which may indicate a virtual mailbox or registered-agent address.');
  }
  if (manyUnrelatedTaxonomies) {
    warnings.push('Many unrelated taxonomies share this suite.');
  }
  if (manyLlcs) {
    warnings.push('Many LLC organizations share this address/suite.');
  }

  return {
    physicalFlyerDrops,
    organizationCount: organizations.length,
    exactSuiteMatchCount: exactSuiteOrgs.length,
    providerCount: providerStats.providerCount,
    alreadyKnownProviderCount: providerStats.alreadyKnownProviderCount,
    newProviderCandidateCount: providerStats.newProviderCount,
    prescriberCount: providerStats.prescriberCount,
    nonPrescriberCount: providerStats.nonPrescriberCount,
    highDensity,
    suspiciousSuite,
    manyUnrelatedTaxonomies,
    manyLlcs,
    warnings,
    suiteLabel: parsedStreet?.suiteLabel || null,
    lookupHint: orgResult.hint || null,
  };
}
