import type {
  NewEntrySession,
  OrgLink,
  OrgListItem,
  PhysicalDrop,
  ProviderSelection,
} from './types';

export type { NewEntrySession };

let activeSession: NewEntrySession | null = null;

export function setNewEntrySession(session: NewEntrySession) {
  activeSession = session;
}

export function getNewEntrySession() {
  return activeSession;
}

export function updateNewEntrySession(patch: Partial<NewEntrySession>) {
  if (!activeSession) return;
  activeSession = { ...activeSession, ...patch };
}

export function updatePhysicalDrop(patch: Partial<PhysicalDrop>) {
  if (!activeSession) return;
  activeSession = {
    ...activeSession,
    physicalDrop: {
      dropStatus: 'dropped',
      stopType: 'unknown',
      campaignId: null,
      flyerTitle: null,
      flyerQuantity: 1,
      photoUri: '',
      notes: '',
      droppedAt: null,
      ...activeSession.physicalDrop,
      ...patch,
    },
  };
}

export function initOrgLinksFromOrganizations(organizations: OrgListItem[], highDensity = false) {
  const defaultStatus = highDensity ? 'npi_only' as const : 'npi_only' as const;
  const orgLinks: OrgLink[] = organizations.map((org) => ({
    organizationNpi: org.npi,
    organizationName: org.organizationName,
    organizationAddress: org.organizationAddress,
    taxonomyCode: org.taxonomyCode,
    taxonomyDescription: org.taxonomyDesc,
    distanceMiles: org.distanceMiles,
    suiteLabel: org.suiteLabel || null,
    verificationStatus: defaultStatus,
    flyerAttributed: false,
  }));
  updateNewEntrySession({ orgLinks });
  return orgLinks;
}

export function updateOrgLink(npi: string, patch: Partial<OrgLink>) {
  if (!activeSession?.orgLinks) return;
  activeSession = {
    ...activeSession,
    orgLinks: activeSession.orgLinks.map((link) =>
      link.organizationNpi === npi ? { ...link, ...patch } : link,
    ),
  };
}

export function bulkUpdateOrgLinks(
  npis: string[],
  patch: Partial<Pick<OrgLink, 'verificationStatus' | 'flyerAttributed'>>,
) {
  if (!activeSession?.orgLinks) return;
  const selected = new Set(npis);
  activeSession = {
    ...activeSession,
    orgLinks: activeSession.orgLinks.map((link) =>
      selected.has(link.organizationNpi) ? { ...link, ...patch } : link,
    ),
  };
}

export function setOrgLinks(orgLinks: OrgLink[]) {
  updateNewEntrySession({ orgLinks });
}

export function setProviderSelections(providers: ProviderSelection[]) {
  updateNewEntrySession({ providerSelections: providers });
}

export function updateProviderSelection(npi: string, patch: Partial<ProviderSelection>) {
  if (!activeSession?.providerSelections) return;
  activeSession = {
    ...activeSession,
    providerSelections: activeSession.providerSelections.map((provider) =>
      provider.npi === npi ? { ...provider, ...patch } : provider,
    ),
  };
}

export function updateOrgVisit(patch: Partial<NonNullable<NewEntrySession['orgVisit']>>) {
  if (!activeSession?.orgVisit) return;
  activeSession = {
    ...activeSession,
    orgVisit: { ...activeSession.orgVisit, ...patch },
  };
}

export function setProviderDraft(npi: string, draft: import('./types').OrgProviderDraft) {
  if (!activeSession?.orgVisit) return;
  activeSession = {
    ...activeSession,
    orgVisit: {
      ...activeSession.orgVisit,
      providerDrafts: { ...activeSession.orgVisit.providerDrafts, [npi]: draft },
    },
  };
}

export function setProviderSelected(npi: string, selected: boolean) {
  if (!activeSession?.orgVisit) return;
  const current = new Set(activeSession.orgVisit.selectedProviderNpis);
  if (selected) current.add(npi);
  else current.delete(npi);
  updateOrgVisit({ selectedProviderNpis: [...current] });
}

export function clearNewEntrySession() {
  activeSession = null;
}

export function ensureVisitBatchId() {
  if (!activeSession) return null;
  if (!activeSession.visitBatchId) {
    activeSession = {
      ...activeSession,
      visitBatchId: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
    };
  }
  return activeSession.visitBatchId || null;
}
