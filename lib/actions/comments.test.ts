import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];

let cardRow: { id: string; boardId: string; columnId: string; rank: string } | undefined;
let commentRow: { authorId: string | null; card: { boardId: string } } | undefined;

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const query = {
  cards: { findFirst: async () => cardRow },
  comments: { findFirst: async () => commentRow },
};

const tx = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return {
        returning: async () => [{ id: 'card-1', ...(values as object) }],
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      };
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        ops.push({ kind: 'update', table: tableName(table), values });
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table: tableName(table) });
    },
  }),
};

vi.mock('@/lib/db', () => ({
  db: { query, transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { addComment, editComment, deleteComment } = await import('./comments');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  cardRow = { id: 'card-1', boardId: 'b1', columnId: 'col-1', rank: 'a0' };
  commentRow = { authorId: 'user-1', card: { boardId: 'b1' } };
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('addComment', () => {
  test('lets a viewer comment', async () => {
    // CLAUDE.md grants viewers read and comment. The floor here is 'viewer',
    // not 'member', and that is the whole difference from the card actions.
    await addComment({ cardId: 'card-1', body: 'Looks right' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
    expect(ops).toContainEqual({
      kind: 'insert',
      table: 'comments',
      values: { cardId: 'card-1', authorId: 'user-1', body: 'Looks right' },
    });
  });

  test('refuses a non-member', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    await expect(addComment({ cardId: 'card-1', body: 'Hello' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('trims the body and refuses an empty one', async () => {
    await expect(addComment({ cardId: 'card-1', body: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a body past the cap', async () => {
    await expect(addComment({ cardId: 'card-1', body: 'x'.repeat(4_001) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });
});

describe('editComment', () => {
  test('checks membership before authorship', async () => {
    // Order matters: answering authorship first would tell someone with no
    // membership that the comment exists.
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('refuses everyone on a comment whose author was deleted', async () => {
    commentRow = { authorId: null, card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author edit', async () => {
    commentRow = { authorId: 'user-1', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'update', table: 'comments', values: { body: 'Edited' } });
  });
});

describe('deleteComment', () => {
  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('refuses everyone on a comment whose author was deleted', async () => {
    commentRow = { authorId: null, card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author delete', async () => {
    commentRow = { authorId: 'user-1', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1' })).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'delete', table: 'comments' });
  });
});
