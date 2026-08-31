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

let columnRow: { id: string; boardId: string } | undefined;
let boardColumnRows: { id: string; rank: string }[] = [];
let cardsInColumns: { id: string; columnId: string; rank: string }[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const query = {
  columns: { findFirst: async () => columnRow, findMany: async () => boardColumnRows },
  cards: { findMany: async () => cardsInColumns },
};

const tx = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return {
        returning: async () => [{ id: 'col-new', ...(values as object) }],
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

const { addColumn, deleteColumn, moveColumn, renameColumn } = await import('./columns');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  columnRow = { id: 'col-2', boardId: 'b1' };
  boardColumnRows = [
    { id: 'col-1', rank: 'a0' },
    { id: 'col-2', rank: 'a1' },
    { id: 'col-3', rank: 'a2' },
  ];
  cardsInColumns = [];
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('addColumn', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null })).resolves.toEqual(
      { ok: false, error: 'UNAUTHENTICATED' },
    );
  });

  test('refuses an empty name', async () => {
    await expect(addColumn({ boardId: 'b1', name: '  ', afterColumnId: null })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // The one action that takes a boardId, because there is no row to resolve one
  // from. It is checked directly rather than believed.
  test('checks the board it was given, at member', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null })).resolves.toEqual(
      { ok: false, error: 'FORBIDDEN' },
    );
  });

  test('appends at the end when no column is named', async () => {
    const result = await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });

    expect((result as { data: { rank: string } }).data.rank > 'a2').toBe(true);
  });

  test('inserts between the named column and the one after it', async () => {
    const result = await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: 'col-1' });

    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
  });

  test('refuses a named column that is not on the board', async () => {
    await expect(
      addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: 'elsewhere' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('bumps the board', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('renameColumn', () => {
  test('refuses a column that is not there', async () => {
    columnRow = undefined;
    await expect(renameColumn({ columnId: 'gone', name: 'Blocked' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('writes the trimmed name and bumps the board', async () => {
    await renameColumn({ columnId: 'col-2', name: '  Blocked  ' });

    expect(ops.filter((op) => op.table === 'columns')).toEqual([
      { kind: 'update', table: 'columns', values: { name: 'Blocked' } },
    ]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('moveColumn', () => {
  test('refuses a neighbour that is not on the board', async () => {
    await expect(
      moveColumn({ columnId: 'col-3', beforeColumnId: 'elsewhere', afterColumnId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses neighbours in the wrong order', async () => {
    await expect(
      moveColumn({ columnId: 'col-1', beforeColumnId: 'col-3', afterColumnId: 'col-2' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('ranks between the two neighbours, writing one row', async () => {
    const result = await moveColumn({
      columnId: 'col-3',
      beforeColumnId: 'col-1',
      afterColumnId: 'col-2',
    });

    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
    expect(ops.filter((op) => op.table === 'columns')).toHaveLength(1);
  });

  test('moves to the far left when nothing is before it', async () => {
    const result = await moveColumn({
      columnId: 'col-3',
      beforeColumnId: null,
      afterColumnId: 'col-1',
    });

    expect((result as { data: { rank: string } }).data.rank < 'a0').toBe(true);
  });
});

describe('deleteColumn', () => {
  test('refuses a target on another board', async () => {
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'elsewhere' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses moving cards into the column being deleted', async () => {
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test("refuses to delete a board's last column", async () => {
    boardColumnRows = [{ id: 'col-2', rank: 'a0' }];
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2' })).resolves.toEqual({
      ok: false,
      error: 'LAST_COLUMN',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  // CLAUDE.md: never cascade-delete cards with the column. Every card moves
  // first, and the column is only dropped afterwards, in the same transaction.
  test('moves every card to the target before dropping the column', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
      { id: 'card-t', columnId: 'col-1', rank: 'b00' },
    ];

    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: true,
    });

    const cardWrites = ops.filter((op) => op.table === 'cards');
    expect(cardWrites).toHaveLength(2);
    expect(cardWrites.every((op) => op.kind === 'update')).toBe(true);
    for (const write of cardWrites) {
      expect(write.values).toMatchObject({ columnId: 'col-1' });
      expect(write.values).not.toHaveProperty('boardId');
      expect((write.values as { rank: string }).rank > 'b00').toBe(true);
    }

    expect(ops.at(-2)).toMatchObject({ kind: 'delete', table: 'columns' });
    expect(ops.at(-1)).toMatchObject({ kind: 'update', table: 'boards' });
  });

  test('keeps the arriving cards in the order they had', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
    ];

    await deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' });

    const ranks = ops
      .filter((op) => op.table === 'cards')
      .map((op) => (op.values as { rank: string }).rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  test('deletes an empty column without writing a card row', async () => {
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: true,
    });
    expect(ops.filter((op) => op.table === 'cards')).toHaveLength(0);
  });
});
