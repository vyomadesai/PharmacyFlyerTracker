export const FLORIDA_TIME_ZONE = 'America/New_York';

const floridaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: FLORIDA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toFloridaDateString(date: Date = new Date()) {
  const parts = floridaDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Unable to format Florida date.');
  }
  return `${year}-${month}-${day}`;
}
