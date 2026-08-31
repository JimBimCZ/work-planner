import { describe, expect, test } from 'vitest';

import { reinsertOrdered } from './comment-order';

const row = (id: string, createdAt: string) => ({ id, createdAt: new Date(createdAt) });

describe('reinsertOrdered', () => {
  test('restores a rejected delete to its thread position, not a stale index', () => {
    const a = row('a', '2026-01-01T00:00:00Z');
    const c = row('c', '2026-01-01T00:02:00Z');
    const d = row('d', '2026-01-01T00:03:00Z');

    // Thread on screen when c's delete was clicked: [a, b, c, d]. Before c's
    // rejection lands, b's own delete resolves for real, shrinking the
    // thread to [a, d] — an index captured against the original four-row
    // array would now be too large for this two-row one.
    const afterBWasRemoved = [a, d];

    expect(reinsertOrdered(afterBWasRemoved, c)).toEqual([a, c, d]);
  });

  test('appends when the row sorts after everything left in the thread', () => {
    const a = row('a', '2026-01-01T00:00:00Z');
    const b = row('b', '2026-01-01T00:01:00Z');

    expect(reinsertOrdered([a], b)).toEqual([a, b]);
  });

  test('breaks a createdAt tie on id, matching getCardForView', () => {
    const a = row('a', '2026-01-01T00:00:00Z');
    const c = row('c', '2026-01-01T00:00:00Z');
    const b = row('b', '2026-01-01T00:00:00Z');

    expect(reinsertOrdered([a, c], b)).toEqual([a, b, c]);
  });
});
