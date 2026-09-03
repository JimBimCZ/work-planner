import { describe, expect, test } from 'vitest';

import { DESCRIPTION_PREVIEW_MAX, previewOf } from './cards-limits';

describe('previewOf', () => {
  test('passes a short description through unchanged', () => {
    expect(previewOf('Ranks collate by code point.')).toBe('Ranks collate by code point.');
  });

  test('cuts a long one at the cap', () => {
    const preview = previewOf('x'.repeat(DESCRIPTION_PREVIEW_MAX + 50));
    expect(preview).toHaveLength(DESCRIPTION_PREVIEW_MAX);
  });

  // No description and an emptied one are the same absence on the card face.
  test('an absent or empty description previews as nothing', () => {
    expect(previewOf(null)).toBeNull();
    expect(previewOf('')).toBeNull();
    expect(previewOf('   \n  ')).toBeNull();
  });

  // The cap is what keeps this inside the payload rule — see CLAUDE.md's
  // Realtime section. A preview that could grow would put the description
  // back on the wire, which is the thing the rule forbids.
  test('the cap leaves the payload ceiling untouched', () => {
    expect(DESCRIPTION_PREVIEW_MAX).toBeLessThan(500);
  });
});
