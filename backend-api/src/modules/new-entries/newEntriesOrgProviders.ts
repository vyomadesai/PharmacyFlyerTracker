import {
  fetchNppesProviderByNpi,
  formatProviderAddress,
} from '../../services/nppesLookup.js';
import { lookupProvidersAtAddress } from './newEntriesProvidersAtAddress.js';

export type OrgProviderResult = {
  npi: string;
  providerName: string;
  taxonomyDesc: string | null;
  taxonomyCode: string | null;
  phone: string | null;
  providerAddress: string;
  alreadyKnown: boolean;
};

export async function lookupProvidersAtOrgAddress(organizationNpi: string) {
  const org = await fetchNppesProviderByNpi(organizationNpi);
  if (!org) {
    return { error: 'Organization not found in NPI Registry.' } as const;
  }
  if (!org.isOrganization) {
    return { error: 'This NPI is not an organization (NPI-2).' } as const;
  }

  const street = [org.address1, org.address2].filter(Boolean).join(' ');
  const result = await lookupProvidersAtAddress({
    street,
    city: org.city,
    state: org.state,
    postalCode: org.postalCode,
    exactSuite: Boolean(street),
  });

  if ('error' in result && result.error) {
    return { error: result.error } as const;
  }

  const providers = result.providers.map((provider) => ({
    npi: provider.npi,
    providerName: provider.providerName,
    taxonomyDesc: provider.taxonomyDesc,
    taxonomyCode: provider.taxonomyCode,
    phone: provider.phone,
    providerAddress: provider.providerAddress,
    alreadyKnown: provider.alreadyKnown,
  }));

  const allProviders = result.allProviders.map((provider) => ({
    npi: provider.npi,
    providerName: provider.providerName,
    taxonomyDesc: provider.taxonomyDesc,
    taxonomyCode: provider.taxonomyCode,
    phone: provider.phone,
    providerAddress: provider.providerAddress,
    alreadyKnown: provider.alreadyKnown,
  }));

  return {
    organization: {
      npi: org.npi,
      organizationName: org.providerName,
      organizationAddress: formatProviderAddress(org),
      taxonomyDesc: org.taxonomyDesc,
      taxonomyCode: org.taxonomyCode,
      primaryTaxonomy: org.primaryTaxonomy,
      selectedTaxonomy: org.selectedTaxonomy,
      taxonomyState: org.taxonomyState,
      licenseNumber: org.licenseNumber,
      phone: org.phone,
    },
    providers,
    allProviders,
    newCount: result.newCount,
    alreadyKnownCount: result.alreadyKnownCount,
    summaryHint: result.summaryHint,
  };
}

export { lookupProvidersAtAddress };
