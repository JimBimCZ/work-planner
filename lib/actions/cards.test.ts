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
let columnRow: { id: string; boardId: string } | undefined;
let cardsInColumn: { id: string; rank: string }[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const query = {
  cards: {
    findFirst: async () => cardRow,
    findMany: async () => cardsInColumn,
  },
  columns: { findFirst: async () => columnRow },
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

const { createCard, deleteCard, renameCard } = await import('./cards');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  cardRow = { id: 'card-1', boardId: 'b1', columnId: 'col-1', rank: 'a0' };
  columnRow = { id: 'col-1', boardId: 'b1' };
  cardsInColumn = [];
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('createCard', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(createCard({ columnId: 'col-1', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('refuses an empty title', async () => {
    await expect(createCard({ columnId: 'col-1', title: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a title over two hundred characters', async () => {
    await expect(createCard({ columnId: 'col-1', title: 'x'.repeat(201) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a column that is not there', async () => {
    columnRow = undefined;
    await expect(createCard({ columnId: 'gone', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  // The board is never taken from the caller. It is resolved from the column,
  // and that resolved value is what assertBoardAccess is asked about.
  test('authorises the board the column belongs to, at member', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(createCard({ columnId: 'col-1', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test("trims the title and appends below the column's last card", async () => {
    cardsInColumn = [{ id: 'card-0', rank: 'a0' }];

    const result = await createCard({ columnId: 'col-1', title: '  Ship it  ' });

    expect(result.ok).toBe(true);
    const insert = ops.find((op) => op.kind === 'insert');
    expect(insert?.table).toBe('cards');
    expect(insert?.values).toMatchObject({ title: 'Ship it', columnId: 'col-1', boardId: 'b1' });
    expect((insert?.values as { rank: string }).rank > 'a0').toBe(true);
  });

  test('returns the id and the rank, so the client can settle its temp card', async () => {
    const result = await createCard({ columnId: 'col-1', title: 'Ship it' });

    expect(result).toMatchObject({ ok: true, data: { id: 'card-1' } });
    expect(typeof (result as { data: { rank: string } }).data.rank).toBe('string');
  });

  test('bumps the board in the same transaction', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it' });
    expect(ops).toContainEqual(
      expect.objectContaining({ kind: 'update', table: 'boards' }),
    );
  });
});

describe('renameCard', () => {
  test('refuses an empty title', async () => {
    await expect(renameCard({ cardId: 'card-1', title: '  ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(renameCard({ cardId: 'gone', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test("authorises the card's own board", async () => {
    await renameCard({ cardId: 'card-1', title: 'Ship it' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('writes the trimmed title and bumps the board', async () => {
    await renameCard({ cardId: 'card-1', title: '  Ship it  ' });

    expect(ops.filter((op) => op.table === 'cards')).toEqual([
      { kind: 'update', table: 'cards', values: { title: 'Ship it' } },
    ]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('deleteCard', () => {
  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(deleteCard({ cardId: 'gone' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteCard({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('deletes exactly one card and bumps the board', async () => {
    await expect(deleteCard({ cardId: 'card-1' })).resolves.toEqual({ ok: true });

    expect(ops.filter((op) => op.table === 'cards')).toEqual([{ kind: 'delete', table: 'cards' }]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});
