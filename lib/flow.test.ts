import { describe, expect, test } from 'vitest';
import { flowHue } from './flow';

describe('flowHue', () => {
  test('a single column sits at the start of the spectrum', () => {
    expect(flowHue(0, 1)).toBe(225);
  });

  test('the first and last columns anchor the ends', () => {
    expect(flowHue(0, 5)).toBe(225);
    expect(flowHue(4, 5)).toBe(145);
  });

  test('the midpoint of five columns is the accent hue region', () => {
    expect(flowHue(2, 5)).toBe(185);
  });

  test('adding a column re-interpolates every position', () => {
    expect(flowHue(1, 3)).toBe(185);
    expect(flowHue(1, 5)).toBe(205);
  });

  test('hue decreases monotonically across any column count', () => {
    for (const total of [2, 3, 5, 8, 13]) {
      const hues = Array.from({ length: total }, (_, i) => flowHue(i, total));
      const sorted = [...hues].sort((a, b) => b - a);
      expect(hues).toEqual(sorted);
    }
  });
});
