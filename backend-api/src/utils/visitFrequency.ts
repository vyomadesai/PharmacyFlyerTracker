import { toFloridaDateString } from './timezone.js';

export const VISIT_DUE_FILTERS = ['due_now', 'overdue', 'upcoming', 'visited_recently'] as const;
export type VisitDueFilter = typeof VISIT_DUE_FILTERS[number];

export type VisitFrequencyType = 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'custom_days';
const FLORIDA_SQL_TODAY = `CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DATE)`;

export function todayDateString(date = new Date()) {
  return toFloridaDateString(date);
}

/** Next due date after a visit (or approval baseline). one_time => null. */
export function computeNextDueDate(
  visitFrequencyType: string,
  visitFrequencyDays: number | null,
  fromDate: Date = new Date(),
): string | null {
  const base = new Date(fromDate);
  switch (visitFrequencyType) {
    case 'weekly':
      base.setDate(base.getDate() + 7);
      return todayDateString(base);
    case 'biweekly':
      base.setDate(base.getDate() + 14);
      return todayDateString(base);
    case 'monthly':
      base.setMonth(base.getMonth() + 1);
      return todayDateString(base);
    case 'custom_days':
      if (visitFrequencyDays && visitFrequencyDays > 0) {
        base.setDate(base.getDate() + visitFrequencyDays);
        return todayDateString(base);
      }
      return null;
    case 'one_time':
    default:
      return null;
  }
}

/** First visit due immediately for recurring schedules; one_time has no next due until visited. */
export function initialDueDateOnApproval(visitFrequencyType: string): string | null {
  if (visitFrequencyType === 'one_time') return null;
  return todayDateString();
}

export function computeVisitDueStatus(input: {
  visitFrequencyType?: string | null;
  nextDueDate?: string | Date | null;
  lastVisitedAt?: string | Date | null;
}) {
  const type = input.visitFrequencyType || 'one_time';
  const nextDue = input.nextDueDate ? String(input.nextDueDate).slice(0, 10) : null;
  const today = todayDateString();

  if (type === 'one_time') {
    return input.lastVisitedAt ? 'completed' : 'due_now';
  }

  if (!nextDue) return 'due_now';
  if (nextDue < today) return 'overdue';
  if (nextDue === today) return 'due_now';
  return 'upcoming';
}

export function isTargetDueForVisit(input: {
  visitFrequencyType?: string | null;
  nextDueDate?: string | Date | null;
  lastVisitedAt?: string | Date | null;
}) {
  const status = computeVisitDueStatus(input);
  return status === 'due_now' || status === 'overdue';
}

export function visitDueSqlFilterClause(filter?: string | null) {
  switch (filter) {
    case 'overdue':
      return `AND t.NextDueDate IS NOT NULL AND t.NextDueDate < ${FLORIDA_SQL_TODAY}`;
    case 'due_now':
      return `AND (
        (t.NextDueDate IS NOT NULL AND t.NextDueDate <= ${FLORIDA_SQL_TODAY})
        OR (t.VisitFrequencyType = 'one_time' AND t.LastVisitedAt IS NULL)
        OR (t.NextDueDate IS NULL AND t.VisitFrequencyType <> 'one_time' AND t.LastVisitedAt IS NULL)
      )`;
    case 'upcoming':
      return `AND t.NextDueDate IS NOT NULL AND t.NextDueDate > ${FLORIDA_SQL_TODAY}`;
    case 'visited_recently':
      return `AND t.LastVisitedAt IS NOT NULL AND t.LastVisitedAt >= DATEADD(day, -14, SYSDATETIME())`;
    default:
      return '';
  }
}

export const VISIT_DUE_STATUS_SQL = `
  CASE
    WHEN t.VisitFrequencyType = 'one_time' AND t.LastVisitedAt IS NOT NULL THEN 'completed'
    WHEN t.VisitFrequencyType = 'one_time' THEN 'due_now'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate < ${FLORIDA_SQL_TODAY} THEN 'overdue'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate = ${FLORIDA_SQL_TODAY} THEN 'due_now'
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate > ${FLORIDA_SQL_TODAY} THEN 'upcoming'
    ELSE 'due_now'
  END AS VisitDueStatus
`;

export const VISIT_DUE_PRIORITY_ORDER_SQL = `
  CASE
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate < ${FLORIDA_SQL_TODAY} THEN 0
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate = ${FLORIDA_SQL_TODAY} THEN 1
    WHEN t.VisitFrequencyType = 'one_time' AND t.LastVisitedAt IS NULL THEN 1
    WHEN t.NextDueDate IS NULL AND t.VisitFrequencyType <> 'one_time' THEN 2
    WHEN t.NextDueDate IS NOT NULL AND t.NextDueDate > ${FLORIDA_SQL_TODAY} THEN 3
    ELSE 4
  END,
  t.NextDueDate ASC,
  t.LastVisitedAt ASC
`;
