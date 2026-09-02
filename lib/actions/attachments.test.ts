import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const publish = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
});

// storageConfigured is read through a variable rather than reassigned on the
// module namespace: an ESM namespace object is read-only, so a test that
// assigns to it throws instead of changing the answer.
let storageOn = true;
const presignPut = vi.fn();
const forgetObjects = vi.fn();
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    storageConfigured: () => storageOn,
    presignPut: (...a: unknown[]) => presignPut(...a),
    forgetObjects: (...a: unknown[]) => forgetObjects(...a),
  };
});

let boardTotal = 0;
let accountTotal = 0;
vi.mock('@/lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  return {
    ...actual,
    boardUsage: async () => boardTotal,
    uploaderUsage: async () => accountTotal,
  };
});

type Op = { kind: 'insert' | 'update' | 'delete' | 'select'; table: string; values?: unknown };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

let cardRow: { boardId: string } | undefined;
let cardCount = 0;
let staleRows: { id: string; key: string }[] = [];

const query = {
  cards: { findFirst: async () => cardRow },
  attachments: {
    findMany: async () => Array.from({ length: cardCount }, (_, i) => ({ id: `att-${i}` })),
  },
};

const writer = {
  query,
  select: () => ({
    from: (table: unknown) => ({
      where: async () => {
        ops.push({ kind: 'select', table: tableName(table) });
        return staleRows;
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
    },
  }),
  delete: (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table: tableName(table) });
    },
  }),
};

vi.mock('@/lib/db', () => ({
  db: {
    ...writer,
    transaction: (fn: (t: typeof writer) => Promise<unknown>) => fn(writer),
  },
}));

const { requestUpload } = await import('./attachments');

const valid = {
  cardId: 'c1',
  filename: 'screenshot.png',
  contentType: 'image/png',
  size: 1024,
  mutationId: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  ops.length = 0;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  publish.mockReset();
  presignPut.mockReset();
  presignPut.mockResolvedValue('https://bucket.example/put');
  forgetObjects.mockReset();
  forgetObjects.mockResolvedValue(undefined);
  storageOn = true;
  boardTotal = 0;
  accountTotal = 0;
  cardCount = 0;
  staleRows = [];
  cardRow = { boardId: 'b1' };
});

describe('requestUpload', () => {
  test('refuses a signed-out caller before it looks at anything else', async () => {
    authMock.mockResolvedValue(null);
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  test('requires member, not viewer', async () => {
    // A viewer can comment but cannot write billable bytes.
    await requestUpload(valid);
    expect(assertBoardAccess).toHaveBeenCalledWith('u1', 'b1', 'member');
  });

  test('refuses a filename over the cap', async () => {
    const result = await requestUpload({ ...valid, filename: 'a'.repeat(201) });
    expect(result).toEqual({ ok: false, error: 'INVALID' });
  });

  test('answers NOT_FOUND for a card that does not exist', async () => {
    cardRow = undefined;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  test('refuses when the board is already full', async () => {
    boardTotal = 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'BOARD_FULL' });
    expect(presignPut).not.toHaveBeenCalled();
  });

  test('refuses when the declared size would push the board over', async () => {
    boardTotal = 1024 * 1024 * 1024 - 512;
    expect(await requestUpload({ ...valid, size: 1024 })).toEqual({
      ok: false,
      error: 'BOARD_FULL',
    });
  });

  test('refuses when the uploader is at their own cap', async () => {
    accountTotal = 2 * 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'ACCOUNT_FULL' });
  });

  test('refuses an eleventh attachment on one card', async () => {
    cardCount = 10;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'TOO_MANY' });
  });

  test('reports UNAVAILABLE rather than crashing when no bucket is configured', async () => {
    // A self-hoster with no S3_* variables must get a clean refusal, because
    // the UI is hidden and only a stale page could still call this.
    storageOn = false;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAVAILABLE' });
  });

  test('sweeps this card’s abandoned uploads and forgets their objects', async () => {
    staleRows = [{ id: 'old', key: 'boards/b1/old' }];
    await requestUpload(valid);
    expect(ops.some((op) => op.kind === 'delete' && op.table === 'attachments')).toBe(true);
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/old']);
  });

  test('writes a pending row keyed boards/<boardId>/<attachmentId>', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    const insert = ops.find((op) => op.kind === 'insert');
    const values = insert?.values as { id: string; key: string; status: string; size: number };
    expect(values.status).toBe('pending');
    expect(values.size).toBe(1024);
    expect(values.key).toBe(`boards/b1/${values.id}`);
  });

  test('returns a presigned URL and an id on success', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe('https://bucket.example/put');
      expect(result.data.attachmentId).toEqual(expect.any(String));
    }
  });

  test('publishes nothing — a pending row is not news', async () => {
    // The board only learns about an attachment once confirmUpload has
    // verified it. Publishing here would show every other client a file that
    // may never finish uploading.
    await requestUpload(valid);
    expect(publish).not.toHaveBeenCalled();
  });
});
