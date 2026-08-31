import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  daysUntilDue,
  dueLabel,
  dueState,
  formatDue,
  fromDateInputValue,
  toDateInputValue,
} from './due';

const due = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const at = (y: number, m: number, d: number, hour = 12) => new Date(y, m - 1, d, hour);

describe('daysUntilDue', () => {
  test('counts calendar days, not elapsed time', () => {
    expect(daysUntilDue(due(2026, 9, 3), at(2026, 9, 1))).toBe(2);
    expect(daysUntilDue(due(2026, 8, 29), at(2026, 9, 1))).toBe(-3);
  });

  // The bug this whole module exists to prevent. A due date of today, read late
  // in the evening west of Greenwich, is 'today' — not yesterday. Comparing the
  // stored instant against the current instant would say otherwise.
  test('a date due today is today, even at 23:00', () => {
    expect(daysUntilDue(due(2026, 9, 1), at(2026, 9, 1, 23))).toBe(0);
  });

  test('and at 00:30', () => {
    expect(daysUntilDue(due(2026, 9, 1), at(2026, 9, 1, 0))).toBe(0);
  });
});

describe('west of Greenwich', () => {
  // The local-vs-UTC distinction in localDay is only observable when the
  // runner's zone differs from UTC, and CI (ubuntu-latest, no TZ set) runs in
  // UTC — so this block pins a zone itself rather than depending on where the
  // suite happens to run, and restores it afterwards.
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test('a date due today is today, even at 23:00', () => {
    expect(daysUntilDue(due(2026, 9, 1), at(2026, 9, 1, 23))).toBe(0);
  });

  test('and dueState still says soon', () => {
    expect(dueState(due(2026, 9, 1), at(2026, 9, 1, 23))).toBe('soon');
  });
});

describe('dueState', () => {
  test('today and tomorrow are soon', () => {
    expect(dueState(due(2026, 9, 1), at(2026, 9, 1))).toBe('soon');
    expect(dueState(due(2026, 9, 2), at(2026, 9, 1))).toBe('soon');
  });

  test('the day after tomorrow is plain', () => {
    expect(dueState(due(2026, 9, 3), at(2026, 9, 1))).toBe('plain');
  });

  test('yesterday is over', () => {
    expect(dueState(due(2026, 8, 31), at(2026, 9, 1))).toBe('over');
  });
});

describe('dueLabel', () => {
  test('names how far past it is, and says nothing otherwise', () => {
    expect(dueLabel(due(2026, 8, 29), at(2026, 9, 1))).toBe('3d over');
    expect(dueLabel(due(2026, 8, 31), at(2026, 9, 1))).toBe('1d over');
    expect(dueLabel(due(2026, 9, 1), at(2026, 9, 1))).toBeNull();
    expect(dueLabel(due(2026, 9, 5), at(2026, 9, 1))).toBeNull();
  });
});

describe('the input round trip', () => {
  test('a date survives it unchanged', () => {
    expect(toDateInputValue(due(2026, 9, 1))).toBe('2026-09-01');
    expect(fromDateInputValue('2026-09-01')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  test('rejects anything that is not a plain calendar date', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('01/09/2026')).toBeNull();
    expect(fromDateInputValue('2026-13-01')).toBeNull();
    expect(fromDateInputValue('2026-02-30')).toBeNull();
  });
});

describe('formatDue', () => {
  test('formats the date it was given', () => {
    expect(formatDue(due(2026, 9, 1), 'en-GB')).toBe('1 Sept');
  });

  // Midnight UTC on the 1st is the previous evening in any western zone, so a
  // formatter that used the runner's timezone would say 31 Aug. This is the
  // assertion that would catch `timeZone: 'UTC'` going missing.
  test('formats from the UTC parts, not the runner timezone', () => {
    const midnightUtc = new Date('2026-09-01T00:00:00.000Z');
    expect(formatDue(midnightUtc, 'en-GB')).toBe('1 Sept');
  });
});
