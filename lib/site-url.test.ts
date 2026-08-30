import { afterEach, describe, expect, test, vi } from 'vitest';
import { siteUrl } from './site-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteUrl', () => {
  test('uses the configured canonical URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://work-planner-seven.vercel.app');
    expect(siteUrl().href).toBe('https://work-planner-seven.vercel.app/');
  });

  test('falls back to localhost so a checkout with no env still builds', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteUrl().href).toBe('http://localhost:3000/');
  });

  test('falls back rather than throwing on a value that is not a URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'work-planner-seven.vercel.app');
    expect(siteUrl().href).toBe('http://localhost:3000/');
  });
});
