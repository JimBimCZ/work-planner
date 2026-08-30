import { beforeEach, describe, expect, test, vi } from 'vitest';

const execute = vi.fn();
vi.mock('@/lib/db', () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

describe('GET /api/health', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  test('returns 200 when the query succeeds', async () => {
    execute.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test('returns 503 when the query fails', async () => {
    execute.mockRejectedValue(new Error('connection refused'));
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
