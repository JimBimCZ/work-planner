export type DueState = 'plain' | 'soon' | 'over';

const DAY = 86_400_000;

// The column is a timestamptz, but the value is a calendar date stored at
// midnight UTC. Both sides are reduced to a day number before comparing:
// the due date from its UTC parts, and "now" from the viewer's local parts,
// because whether something is overdue is a question about the reader's day.
const utcDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY;

const localDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;

export function daysUntilDue(due: Date, now: Date): number {
  return utcDay(due) - localDay(now);
}

export function dueState(due: Date, now: Date): DueState {
  const days = daysUntilDue(due, now);
  if (days < 0) return 'over';
  return days <= 1 ? 'soon' : 'plain';
}

export function dueLabel(due: Date, now: Date): string | null {
  const days = daysUntilDue(due, now);
  return days < 0 ? `${-days}d over` : null;
}

export function toDateInputValue(due: Date): string {
  return due.toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const due = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime())) return null;
  // new Date rolls '2026-02-30' over into March rather than failing.
  return toDateInputValue(due) === value ? due : null;
}

export function formatDue(due: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(due);
}
