import { beforeEach, describe, expect, test, vi } from 'vitest';

let cardRow: unknown;
const findFirst = vi.fn(async (config: unknown) => {
  void config;
  return cardRow;
});

vi.mock('@/lib/db', () => ({
  db: { query: { cards: { findFirst: (config: unknown) => findFirst(config) } } },
}));

// next-auth's own import of `next/server` doesn't resolve under Vitest, so
// anything that imports `@/lib/auth` at module scope needs it mocked before
// that import runs — this file needs the mock even though these tests never
// call `auth()` themselves.
const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const { getCardForView } = await import('./cards');

type CommentsConfig = {
  orderBy: (
    comment: Record<string, unknown>,
    helpers: { asc: (column: unknown) => unknown },
  ) => unknown[];
};
type FindFirstConfig = { with: { comments: CommentsConfig } };

beforeEach(() => {
  cardRow = undefined;
  findFirst.mockClear();
});

describe('getCardForView', () => {
  test('returns null for a card that is not there', async () => {
    await expect(getCardForView('missing')).resolves.toBeNull();
  });

  test('reads the thread oldest first, which is how it is rendered', async () => {
    cardRow = { id: 'k1', boardId: 'b1', columnId: 'c1', title: 'Ship it', comments: [] };
    await getCardForView('k1');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;
    const asc = vi.fn();
    config.with.comments.orderBy({ createdAt: 'created_at', id: 'id' }, { asc });
    expect(asc).toHaveBeenNthCalledWith(1, 'created_at');
    // The tie-break, so two comments in the same millisecond keep a stable order.
    expect(asc).toHaveBeenNthCalledWith(2, 'id');
  });

  test('carries an authorless comment through rather than dropping it', async () => {
    cardRow = {
      id: 'k1',
      boardId: 'b1',
      columnId: 'c1',
      title: 'Ship it',
      description: null,
      dueDate: null,
      comments: [{ id: 'm1', body: 'Still here', createdAt: new Date(0), author: null }],
    };

    const card = await getCardForView('k1');
    expect(card?.comments[0].author).toBeNull();
    expect(card?.comments[0].body).toBe('Still here');
  });
});
