import { describe, expect, it } from 'vitest';

import { maskEndpoint, plainEndpoint, verdict } from './verify-r2-jurisdiction.mjs';

const EU = 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com';
const PLAIN = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';

describe('plainEndpoint', () => {
  it('drops the jurisdiction label and keeps everything else', () => {
    expect(plainEndpoint(EU)).toBe(PLAIN);
  });

  it('refuses an endpoint that is already the plain host', () => {
    expect(() => plainEndpoint(PLAIN)).toThrow(/jurisdiction/i);
  });

  it('refuses a host that is not R2 at all', () => {
    expect(() => plainEndpoint('http://minio:9000')).toThrow(/r2/i);
  });
});

describe('maskEndpoint', () => {
  it('hides the account id, which this repository never writes down', () => {
    expect(maskEndpoint(EU)).toBe('https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com');
  });
});

describe('verdict', () => {
  const reachable = { ok: true, status: 200 } as const;

  it('passes only when the plain host cannot find the bucket', () => {
    const v = verdict(reachable, { ok: false, name: 'NotFound', status: 404 });
    expect(v.result).toBe('PASS');
    expect(v.exitCode).toBe(0);
  });

  it('accepts NoSuchBucket by name as the same answer', () => {
    expect(verdict(reachable, { ok: false, name: 'NoSuchBucket' }).result).toBe('PASS');
  });

  it('fails loudly when the plain host can see the bucket', () => {
    const v = verdict(reachable, reachable);
    expect(v.result).toBe('FAIL');
    expect(v.exitCode).toBe(1);
  });

  it('stays inconclusive on AccessDenied — the state the CORS preflight left', () => {
    const v = verdict(reachable, { ok: false, name: 'AccessDenied', status: 403 });
    expect(v.result).toBe('INCONCLUSIVE');
    expect(v.exitCode).toBe(2);
  });

  it('concludes nothing when the bucket is unreachable on its own endpoint', () => {
    const v = verdict({ ok: false, name: 'InvalidAccessKeyId', status: 403 }, reachable);
    expect(v.result).toBe('INCONCLUSIVE');
    expect(v.exitCode).toBe(2);
  });
});
