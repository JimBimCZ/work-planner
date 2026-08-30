import { describe, expect, test } from 'vitest';
import { avatarHue, initials } from './avatar';

describe('avatarHue', () => {
  test('is stable for the same id', () => {
    expect(avatarHue('abc')).toBe(avatarHue('abc'));
  });

  test('never leaves the cool half of the wheel', () => {
    for (let i = 0; i < 500; i += 1) {
      const hue = avatarHue(`user-${i}`);
      expect(hue).toBeGreaterThanOrEqual(180);
      expect(hue).toBeLessThanOrEqual(300);
    }
  });

  test('spreads ids across the range rather than clustering on one hue', () => {
    const hues = new Set(Array.from({ length: 50 }, (_, i) => avatarHue(`user-${i}`)));
    expect(hues.size).toBeGreaterThan(10);
  });
});

describe('initials', () => {
  test('uses both parts of a full name', () => {
    expect(initials('Vit Busek', 'v@example.test')).toBe('VB');
  });

  test('uses one letter for a single name', () => {
    expect(initials('Vit', 'v@example.test')).toBe('V');
  });

  test('falls back to the email when there is no name', () => {
    expect(initials(null, 'vit@example.test')).toBe('V');
  });
});
