import { describe, expect, test } from 'vitest';

import { attempt } from './attempt';

describe('attempt', () => {
  test('passes a success through untouched', async () => {
    const result = await attempt(async () => ({ ok: true, data: { id: 'card-1' } }) as const);
    expect(result).toEqual({ ok: true, data: { id: 'card-1' } });
  });

  test('passes a refusal through untouched', async () => {
    const result = await attempt(async () => ({ ok: false, error: 'INVALID' }) as const);
    expect(result).toEqual({ ok: false, error: 'INVALID' });
  });

  test('turns a rejected call into a refusal rather than letting it throw', async () => {
    const result = await attempt(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result).toEqual({ ok: false, error: 'UNREACHABLE' });
  });

  test('turns a synchronous throw into a refusal too', async () => {
    const result = await attempt(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(result).toEqual({ ok: false, error: 'UNREACHABLE' });
  });
});
