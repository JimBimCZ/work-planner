import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import {
  ATTACHMENTS_PER_CARD,
  ATTACHMENT_SIZE_MAX,
  FILENAME_MAX,
  PENDING_TTL_MINUTES,
  STORAGE_PER_ACCOUNT,
  STORAGE_PER_BOARD,
  rendersInline,
} from '@/lib/attachments-limits';

// Verified 2026-09-02 from Cloudflare's pricing page: R2's free tier is
// 10 GB-month of storage, and Standard storage is $0.015 per GB-month beyond it.
const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024;

describe('the storage caps are derived, not picked', () => {
  test('ten boards filled to the board cap is exactly the free tier', () => {
    expect(STORAGE_PER_BOARD * 10).toBe(R2_FREE_TIER_BYTES);
  });

  test('an account can hold twice what one board can', () => {
    expect(STORAGE_PER_ACCOUNT).toBe(STORAGE_PER_BOARD * 2);
  });

  test('a single maximal card cannot fill a board on its own', () => {
    expect(ATTACHMENT_SIZE_MAX * ATTACHMENTS_PER_CARD).toBeLessThan(STORAGE_PER_BOARD);
  });

  test('one file is small enough that a single PUT is always enough', () => {
    // The spec's "no multipart upload" rests on this. Raising it reopens that.
    expect(ATTACHMENT_SIZE_MAX).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  test('an abandoned upload is believed in flight for longer than one can take', () => {
    expect(PENDING_TTL_MINUTES).toBeGreaterThanOrEqual(15);
  });

  test('a filename cap exists and is not absurd', () => {
    expect(FILENAME_MAX).toBe(200);
  });

  test('the account cap is larger than a 32-bit integer', () => {
    // Load-bearing for lib/attachments.ts: sum(size) must be cast to bigint,
    // not int. int4 tops out at 2,147,483,647 and STORAGE_PER_ACCOUNT is
    // 2,147,483,648 — one byte over. An int cast would overflow at exactly the
    // boundary the cap is meant to enforce.
    expect(STORAGE_PER_ACCOUNT).toBeGreaterThan(2 ** 31 - 1);
  });
});

describe('the inline allowlist', () => {
  test('renders common raster images inline', () => {
    expect(rendersInline('image/png')).toBe(true);
    expect(rendersInline('image/jpeg')).toBe(true);
  });

  test('never renders SVG inline', () => {
    // An SVG can carry script. This assertion is the whole reason the
    // allowlist is a list rather than a `startsWith('image/')` check.
    expect(rendersInline('image/svg+xml')).toBe(false);
  });

  test('never renders anything that is not an image', () => {
    expect(rendersInline('text/html')).toBe(false);
    expect(rendersInline('application/pdf')).toBe(false);
  });
});

test('the module imports nothing, so a client component can read the caps', () => {
  // lib/permissions.ts and lib/db build a pg pool at module scope. Anything
  // this module imported would travel with it into the browser bundle, and
  // only `pnpm build` would catch it.
  const source = readFileSync(new URL('./attachments-limits.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/^\s*import\s/m);
});
