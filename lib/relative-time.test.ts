import { describe, expect, test } from 'vitest';

import { formatAbsolute, formatRelative } from '@/lib/relative-time';

const now = new Date('2026-09-03T12:00:00.000Z');
const ago = (milliseconds: number) => new Date(now.getTime() - milliseconds);

describe('formatRelative', () => {
  test('falls to the largest unit that fits', () => {
    expect(formatRelative(ago(3 * 86_400_000), now, 'en-US')).toBe('3 days ago');
    expect(formatRelative(ago(5 * 3_600_000), now, 'en-US')).toBe('5 hours ago');
    expect(formatRelative(ago(7 * 60_000), now, 'en-US')).toBe('7 minutes ago');
  });

  test('spells the near past rather than counting it', () => {
    expect(formatRelative(ago(86_400_000), now, 'en-US')).toBe('yesterday');
  });

  // The comment you just posted, and the board row touched a second ago. Under
  // a minute there is no unit left to fall to, so it must not read "0 minutes".
  test('anything under a minute reads as now', () => {
    expect(formatRelative(ago(0), now, 'en-US')).toBe('this minute');
    expect(formatRelative(ago(30_000), now, 'en-US')).toBe('this minute');
  });

  test('a future instant reads forward', () => {
    expect(formatRelative(new Date(now.getTime() + 2 * 86_400_000), now, 'en-US')).toBe(
      'in 2 days',
    );
  });
});

describe('formatAbsolute', () => {
  // What the relative label hides, and the only place the exact instant is
  // readable: the tooltip and the title attribute.
  test('carries both the date and the time', () => {
    expect(formatAbsolute(new Date('2026-09-02T10:05:00.000Z'), 'en-US', 'UTC')).toBe(
      'Sep 2, 2026, 10:05 AM',
    );
  });
});
