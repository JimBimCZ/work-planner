import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const publish = vi.fn();
// publishComment is mocked separately rather than left to run for real: it
// calls this module's own `publish`, not the mocked export, so the real one
// would reach past the mock and assert nothing.
const publishComment = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    publish: (...args: unknown[]) => publish(...args),
    publishComment: (...args: unknown[]) => publishComment(...args),
  };
});

const MUTATION_ID = '11111111-1111-4111-8111-111111111111';

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];
// Proof of ordering, not just of the call: touchBoard is the last write in
// every transaction here, so a publish that can already see the boards update
// ran after the transaction body rather than inside it.
const opsWhenPublished: Op[] = [];
const publishedAfterTransaction = () =>
  opsWhenPublished.some((op) => op.kind === 'update' && op.table === 'boards');


const thread = [
  {
    id: 'comment-1',
    body: 'First thought',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    author: { id: 'user-1', name: 'Ada', image: null },
  },
];
let cardRow:
  | {
      id: string;
      boardId: string;
      columnId: string;
      rank: string;
      comments: typeof thread;
      cardLabels: { labelId: string }[];
    }
  | undefined;
let commentRow:
  | { authorId: string | null; cardId: string; card: { boardId: string } }
  | undefined;

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
        returning: async () => [
          {
            id: 'comment-1',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            ...(values as object),
          },
        ],
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

const { addComment, editComment, deleteComment, readComments } = await import('./comments');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  cardRow = {
    id: 'card-1',
    boardId: 'b1',
    columnId: 'col-1',
    rank: 'a0',
    comments: thread,
    cardLabels: [],
  };
  commentRow = { authorId: 'user-1', cardId: 'card-1', card: { boardId: 'b1' } };
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1', name: 'Ada', image: null } });
  publish.mockReset();
  publishComment.mockReset();
  opsWhenPublished.length = 0;
  const record = async () => {
    opsWhenPublished.push(...ops);
  };
  publish.mockImplementation(record);
  publishComment.mockImplementation(record);
});

describe('addComment', () => {
  test('lets a viewer comment', async () => {
    // CLAUDE.md grants viewers read and comment. The floor here is 'viewer',
    // not 'member', and that is the whole difference from the card actions.
    await addComment({ cardId: 'card-1', body: 'Looks right', mutationId: MUTATION_ID });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
    expect(ops).toContainEqual({
      kind: 'insert',
      table: 'comments',
      values: { cardId: 'card-1', authorId: 'user-1', body: 'Looks right' },
    });
  });

  test('refuses a non-member', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    await expect(
      addComment({ cardId: 'card-1', body: 'Hello', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('trims the body and refuses an empty one', async () => {
    await expect(
      addComment({ cardId: 'card-1', body: '   ', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a body past the cap', async () => {
    await expect(
      addComment({ cardId: 'card-1', body: 'x'.repeat(4_001), mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('requires a mutationId', async () => {
    await expect(addComment({ cardId: 'card-1', body: 'Looks right' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // Through publishComment, not publish: an oversized body has to be able to
  // degrade to a pointer, and only that publisher knows how.
  test('publishes comment.created with the body and the author', async () => {
    await addComment({ cardId: 'card-1', body: 'Looks right', mutationId: MUTATION_ID });
    expect(publishComment).toHaveBeenCalledWith('b1', {
      type: 'comment.created',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: expect.any(String),
      cardId: 'card-1',
      body: 'Looks right',
      createdAt: expect.any(String),
      author: { id: 'user-1', name: 'Ada', image: null },
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  test('publishes nothing when the write is refused', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    await addComment({ cardId: 'card-1', body: 'Looks right', mutationId: MUTATION_ID });
    expect(publishComment).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('editComment', () => {
  test('checks membership before authorship', async () => {
    // Order matters: answering authorship first would tell someone with no
    // membership that the comment exists.
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    commentRow = { authorId: 'someone-else', cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(
      editComment({ commentId: 'm1', body: 'Edited', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(
      editComment({ commentId: 'm1', body: 'Edited', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('refuses everyone on a comment whose author was deleted', async () => {
    commentRow = { authorId: null, cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(
      editComment({ commentId: 'm1', body: 'Edited', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author edit', async () => {
    commentRow = { authorId: 'user-1', cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(
      editComment({ commentId: 'm1', body: 'Edited', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'update', table: 'comments', values: { body: 'Edited' } });
  });

  test('requires a mutationId', async () => {
    await expect(editComment({ commentId: 'comment-1', body: 'Rewritten' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('publishes comment.updated', async () => {
    await editComment({ commentId: 'comment-1', body: 'Rewritten', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'comment.updated',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'comment-1',
      cardId: 'card-1',
      body: 'Rewritten',
      updatedAt: expect.any(String),
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  // Authorship, not access: a member who is not the author is refused, and a
  // refused write announces nothing.
  test('publishes nothing when the caller is not the author', async () => {
    authMock.mockResolvedValue({ user: { id: 'someone-else' } });
    await expect(
      editComment({ commentId: 'comment-1', body: 'Mine now', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('deleteComment', () => {
  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('refuses everyone on a comment whose author was deleted', async () => {
    commentRow = { authorId: null, cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author delete', async () => {
    commentRow = { authorId: 'user-1', cardId: 'card-1', card: { boardId: 'b1' } };
    await expect(
      deleteComment({ commentId: 'm1', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'delete', table: 'comments' });
  });

  test('requires a mutationId', async () => {
    await expect(deleteComment({ commentId: 'comment-1' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('publishes comment.deleted', async () => {
    await deleteComment({ commentId: 'comment-1', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'comment.deleted',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'comment-1',
      cardId: 'card-1',
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  test('publishes nothing when the caller is not the author', async () => {
    authMock.mockResolvedValue({ user: { id: 'someone-else' } });
    await deleteComment({ commentId: 'comment-1', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('readComments', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('returns the thread in the order the component needs', async () => {
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: true,
      data: thread,
    });
  });

  test('refuses a card that does not exist', async () => {
    cardRow = undefined;
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('asks for viewer, since reading is all it does', async () => {
    await readComments({ cardId: 'card-1' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a board the caller is not a member of', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('publishes nothing — it is a read', async () => {
    await readComments({ cardId: 'card-1' });
    expect(publish).not.toHaveBeenCalled();
    expect(publishComment).not.toHaveBeenCalled();
  });
});
