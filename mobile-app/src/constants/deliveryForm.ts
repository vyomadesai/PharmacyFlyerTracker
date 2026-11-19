export const PERSON_MET_OPTIONS = [
  'Doctor',
  'Nurse / MA',
  'Receptionist',
  'Office Manager',
  'No one available',
  'Other'
] as const;

export const RESPONSE_STATUS_OPTIONS = [
  'Flyer accepted',
  'Left with staff',
  'Doctor not available',
  'Clinic closed',
  'Flyer declined',
  'Interested - wants callback',
  'Not interested',
  'Follow up requested'
] as const;

export type PersonMetOption = (typeof PERSON_MET_OPTIONS)[number];
export type ResponseStatusOption = (typeof RESPONSE_STATUS_OPTIONS)[number];

export const DEFAULT_PERSON_MET: PersonMetOption = 'Receptionist';
export const DEFAULT_RESPONSE_STATUS: ResponseStatusOption = 'Flyer accepted';

export const FOLLOW_UP_STATUSES: ResponseStatusOption[] = [
  'Interested - wants callback',
  'Follow up requested',
  'Doctor not available',
  'Clinic closed'
];
