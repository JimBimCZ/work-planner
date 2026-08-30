import { describe, expect, test } from 'vitest';
import { conflictingProvider } from './account-conflict';

describe('conflictingProvider', () => {
  test('a brand new address has no conflict', () => {
    expect(conflictingProvider([], 'google')).toBeNull();
  });

  test('signing in again with the same provider is not a conflict', () => {
    expect(conflictingProvider(['google'], 'google')).toBeNull();
  });

  test('a second provider on a known address names the first', () => {
    expect(conflictingProvider(['google'], 'github')).toBe('google');
  });

  test('an address that somehow holds both is not a conflict for either', () => {
    expect(conflictingProvider(['google', 'github'], 'github')).toBeNull();
    expect(conflictingProvider(['github', 'google'], 'google')).toBeNull();
  });
});
