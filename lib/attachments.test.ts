import { describe, expect, test } from 'vitest';

import { PENDING_TTL_MINUTES } from '@/lib/attachments-limits';
import { pendingCutoff } from '@/lib/attachments';

describe('pendingCutoff', () => {
  test('is PENDING_TTL_MINUTES before the given moment', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    expect(pendingCutoff(now).toISOString()).toBe('2026-09-02T11:45:00.000Z');
    expect(PENDING_TTL_MINUTES).toBe(15);
  });

  test('defaults to now', () => {
    const before = Date.now();
    const cutoff = pendingCutoff().getTime();
    expect(cutoff).toBeLessThanOrEqual(before - PENDING_TTL_MINUTES * 60 * 1000 + 5);
  });
});
