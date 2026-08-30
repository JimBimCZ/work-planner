import { describe, expect, test } from 'vitest';
import { safeCallbackUrl } from './safe-redirect';

describe('safeCallbackUrl', () => {
  test('keeps a relative path', () => {
    expect(safeCallbackUrl('/boards/abc')).toBe('/boards/abc');
  });

  test('keeps a relative path with a query string', () => {
    expect(safeCallbackUrl('/boards?filter=mine')).toBe('/boards?filter=mine');
  });

  test('falls back when there is nothing to redirect to', () => {
    expect(safeCallbackUrl(null)).toBe('/boards');
    expect(safeCallbackUrl(undefined)).toBe('/boards');
    expect(safeCallbackUrl('')).toBe('/boards');
  });

  test('refuses an absolute URL', () => {
    expect(safeCallbackUrl('https://evil.example/boards')).toBe('/boards');
  });

  test('refuses a protocol-relative URL', () => {
    expect(safeCallbackUrl('//evil.example/boards')).toBe('/boards');
  });

  test('refuses a backslash-prefixed path, which browsers treat as protocol-relative', () => {
    expect(safeCallbackUrl('/\\evil.example')).toBe('/boards');
  });

  test('honours an explicit fallback', () => {
    expect(safeCallbackUrl(null, '/')).toBe('/');
  });
});
