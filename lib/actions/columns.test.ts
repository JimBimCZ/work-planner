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
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
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


let columnRow: { id: string; boardId: string; name: string } | undefined;
let boardColumnRows: { id: string; rank: string; name: string }[] = [];
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
  columnRow = { id: 'col-2', boardId: 'b1', name: 'In Progress' };
  boardColumnRows = [
    { id: 'col-1', rank: 'a0', name: 'In Progress' },
    { id: 'col-2', rank: 'a1', name: 'Backlog' },
    { id: 'col-3', rank: 'a2', name: 'Done' },
  ];
  cardsInColumns = [];
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  publish.mockReset();
  opsWhenPublished.length = 0;
  publish.mockImplementation(async () => {
    opsWhenPublished.push(...ops);
  });
});

describe('addColumn', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(
      addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null, mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  test('refuses an empty name', async () => {
    await expect(
      addColumn({ boardId: 'b1', name: '  ', afterColumnId: null, mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // The one action that takes a boardId, because there is no row to resolve one
  // from. It is checked directly rather than believed.
  test('checks the board it was given, at member', async () => {
    await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: null,
      mutationId: MUTATION_ID,
    });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null, mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  test('appends at the end when no column is named', async () => {
    const result = await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: null,
      mutationId: MUTATION_ID,
    });

    expect((result as { data: { rank: string } }).data.rank > 'a2').toBe(true);
  });

  test('inserts between the named column and the one after it', async () => {
    const result = await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: 'col-1',
      mutationId: MUTATION_ID,
    });

    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
  });

  test('refuses a named column that is not on the board', async () => {
    await expect(
      addColumn({
        boardId: 'b1',
        name: 'Blocked',
        afterColumnId: 'elsewhere',
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('bumps the board', async () => {
    await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: null,
      mutationId: MUTATION_ID,
    });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });

  test('requires a mutationId', async () => {
    await expect(
      addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('publishes column.created', async () => {
    await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: null,
      mutationId: MUTATION_ID,
    });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.created',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: expect.any(String),
      name: 'Blocked',
      rank: expect.any(String),
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  test('publishes nothing when the write is refused', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await addColumn({
      boardId: 'b1',
      name: 'Blocked',
      afterColumnId: null,
      mutationId: MUTATION_ID,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('renameColumn', () => {
  test('refuses a column that is not there', async () => {
    columnRow = undefined;
    await expect(
      renameColumn({ columnId: 'gone', name: 'Blocked', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      renameColumn({ columnId: 'col-2', name: 'Blocked', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('writes the trimmed name and bumps the board', async () => {
    await renameColumn({ columnId: 'col-2', name: '  Blocked  ', mutationId: MUTATION_ID });

    expect(ops.filter((op) => op.table === 'columns')).toEqual([
      { kind: 'update', table: 'columns', values: { name: 'Blocked' } },
    ]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });

  test('requires a mutationId', async () => {
    await expect(renameColumn({ columnId: 'col-2', name: 'Doing' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('publishes column.updated', async () => {
    await renameColumn({ columnId: 'col-2', name: 'Doing', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.updated',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'col-2',
      name: 'Doing',
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  test('publishes nothing when the write is refused', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await renameColumn({ columnId: 'col-2', name: 'Doing', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('moveColumn', () => {
  test('refuses a neighbour that is not on the board', async () => {
    await expect(
      moveColumn({
        columnId: 'col-3',
        beforeColumnId: 'elsewhere',
        afterColumnId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses neighbours in the wrong order', async () => {
    await expect(
      moveColumn({
        columnId: 'col-1',
        beforeColumnId: 'col-3',
        afterColumnId: 'col-2',
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('ranks between the two neighbours, writing one row', async () => {
    const result = await moveColumn({
      columnId: 'col-3',
      beforeColumnId: 'col-1',
      afterColumnId: 'col-2',
    mutationId: MUTATION_ID,
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
    mutationId: MUTATION_ID,
    });

    expect((result as { data: { rank: string } }).data.rank < 'a0').toBe(true);
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      moveColumn({
        columnId: 'col-3',
        beforeColumnId: 'col-1',
        afterColumnId: 'col-2',
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  test('bumps the board', async () => {
    await moveColumn({
      columnId: 'col-3',
      beforeColumnId: 'col-1',
      afterColumnId: 'col-2',
      mutationId: MUTATION_ID,
    });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });

  test('requires a mutationId', async () => {
    await expect(
      moveColumn({ columnId: 'col-3', beforeColumnId: 'col-1', afterColumnId: 'col-2' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('publishes column.moved with the server rank', async () => {
    await moveColumn({
      columnId: 'col-3',
      beforeColumnId: 'col-1',
      afterColumnId: 'col-2',
      mutationId: MUTATION_ID,
    });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.moved',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'col-3',
      rank: expect.any(String),
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  // A refused move announces nothing: the rank the client guessed is not the
  // rank anyone else should be told about.
  test('publishes nothing when the move is refused', async () => {
    await moveColumn({
      columnId: 'col-1',
      beforeColumnId: 'col-3',
      afterColumnId: 'col-2',
      mutationId: MUTATION_ID,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('deleteColumn', () => {
  test('refuses a target on another board', async () => {
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'elsewhere', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses moving cards into the column being deleted', async () => {
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test("refuses to delete a board's last column", async () => {
    boardColumnRows = [{ id: 'col-2', rank: 'a0' }];
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: false,
      error: 'LAST_COLUMN',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
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

    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
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

    // The column goes after its cards have left, the board is touched, and the
    // entry with its trim is the last write in the transaction.
    expect(ops.map((op) => `${op.kind} ${op.table}`).slice(-4)).toEqual([
      'delete columns',
      'update boards',
      'insert activity',
      'delete activity',
    ]);
  });

  test('keeps the arriving cards in the order they had', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
    ];

    await deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID });

    const ranks = ops
      .filter((op) => op.table === 'cards')
      .map((op) => (op.values as { rank: string }).rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  test('deletes an empty column without writing a card row', async () => {
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(ops.filter((op) => op.table === 'cards')).toHaveLength(0);
  });

  test('requires a mutationId', async () => {
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // The cards do not disappear; they move. The event carries where they went,
  // because the transaction computed exactly that and the client cannot.
  test('publishes column.deleted carrying every card it moved', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
    ];

    await deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID });

    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.deleted',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'col-2',
      targetColumnId: 'col-1',
      cards: [
        { id: 'card-x', columnId: 'col-1', rank: expect.any(String) },
        { id: 'card-y', columnId: 'col-1', rank: expect.any(String) },
      ],
    });
    expect(publishedAfterTransaction()).toBe(true);
  });

  test('publishes nothing when the column is the last one', async () => {
    boardColumnRows = [{ id: 'col-2', rank: 'a0' }];
    await deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });
});

const activityOps = () => ops.filter((op) => op.kind === 'insert' && op.table === 'activity');

describe('activity', () => {
  test('addColumn records the name', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null, mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'column.created', subject: 'Blocked' });
  });

  test('renameColumn records both names', async () => {
    await renameColumn({ columnId: 'col-1', name: 'Doing', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'column.renamed',
      subject: 'Doing',
      detail: 'In Progress',
    });
  });

  test('deleteColumn records where the cards went, and one entry only', async () => {
    await deleteColumn({ columnId: 'col-1', targetColumnId: 'col-2', mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({ type: 'column.deleted', detail: 'Backlog' });
  });

  // A reorder is not news, and moveColumn can only ever be a reorder.
  test('moveColumn records nothing', async () => {
    await moveColumn({
      columnId: 'col-1',
      beforeColumnId: null,
      afterColumnId: 'col-2',
      mutationId: MUTATION_ID,
    });

    expect(activityOps()).toHaveLength(0);
  });
});
