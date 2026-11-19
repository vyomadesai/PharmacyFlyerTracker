import type { OrgVerificationStatus, ProviderVerificationStatus } from '../new-entry/types';

// Field-friendly language. The field user should never see cfg / uncfg / npi_only.
export const STATUS_COLORS = {
  known: { bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3' },
  needsMapping: { bg: '#fff7ed', border: '#fed7aa', text: '#b45309' },
  newProvider: { bg: '#ecfeff', border: '#a5f3fc', text: '#0e7490' },
  confirmed: { bg: '#f0fdf4', border: '#86efac', text: '#16a34a' },
  notHere: { bg: '#fee2e2', border: '#fecaca', text: '#b91c1c' },
  neutral: { bg: '#f1f5f9', border: '#e2e8f0', text: '#475569' },
} as const;

// Organization verification, shown as human field labels (npi_only is the "unset" default).
export const ORG_STATUS_OPTIONS: Array<{ value: OrgVerificationStatus; label: string }> = [
  { value: 'confirmed_on_site', label: 'Confirmed here' },
  { value: 'not_present', label: 'Not here' },
  { value: 'virtual_mail_only', label: 'Virtual/mail only' },
  { value: 'unsure', label: 'Unsure' },
];

export function orgStatusLabel(status: OrgVerificationStatus): string {
  switch (status) {
    case 'confirmed_on_site':
      return 'Confirmed here';
    case 'not_present':
      return 'Not here';
    case 'virtual_mail_only':
      return 'Virtual/mail only';
    case 'unsure':
      return 'Unsure';
    default:
      return 'Needs review';
  }
}

export function providerKindLabel(alreadyKnown: boolean): string {
  return alreadyKnown ? 'Needs Mapping' : 'New Provider';
}

export function providerStatusLabel(status: ProviderVerificationStatus, alreadyKnown: boolean): string {
  switch (status) {
    case 'selected_for_review':
      return 'Added for review';
    case 'confirmed_on_site':
      return 'Confirmed here';
    case 'ignore':
      return 'Not here';
    default:
      return alreadyKnown ? 'Needs Mapping' : 'New Provider';
  }
}

// Digits-only phone comparison so "(727) 555-1234" matches "7275551234".
export function samePhone(a?: string | null, b?: string | null): boolean {
  const da = (a || '').replace(/\D/g, '');
  const db = (b || '').replace(/\D/g, '');
  return da.length >= 7 && db.length >= 7 && da.slice(-10) === db.slice(-10);
}

export function sameStreet(address?: string | null, street?: string | null): boolean {
  const a = (address || '').toLowerCase();
  const s = (street || '').toLowerCase().trim();
  if (!a || !s) return false;
  const firstToken = s.split(/\s+/).slice(0, 2).join(' ');
  return a.includes(firstToken);
}
