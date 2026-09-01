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

const { createCard, deleteCard, moveCard, renameCard, setCardDescription, setCardDueDate } =
  await import('./cards');
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
  publish.mockReset();
  publish.mockResolvedValue(undefined);
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
    // Two siblings, so "last" is a different row from "first" and the
    // assertion fails if the rank is taken from the head of the column.
    cardsInColumn = [
      { id: 'card-0', rank: 'a0' },
      { id: 'card-1', rank: 'a1' },
    ];

    const result = await createCard({ columnId: 'col-1', title: '  Ship it  ' });

    expect(result.ok).toBe(true);
    const insert = ops.find((op) => op.kind === 'insert');
    expect(insert?.table).toBe('cards');
    expect(insert?.values).toMatchObject({ title: 'Ship it', columnId: 'col-1', boardId: 'b1' });
    expect((insert?.values as { rank: string }).rank > 'a1').toBe(true);
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

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(renameCard({ cardId: 'card-1', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
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

describe('setCardDescription', () => {
  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(setCardDescription({ cardId: 'card-1', description: 'Why' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('authorises the board resolved from the card, at member', async () => {
    await setCardDescription({ cardId: 'card-1', description: 'Why' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('writes the description and bumps the board', async () => {
    await setCardDescription({ cardId: 'card-1', description: '  Why  ' });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { description: 'Why' } });
    expect(ops.some((op) => op.table === 'boards')).toBe(true);
  });

  test('an empty description clears it rather than failing', async () => {
    const result = await setCardDescription({ cardId: 'card-1', description: '' });
    expect(result).toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { description: null } });
  });

  test('refuses a description past the cap', async () => {
    await expect(
      setCardDescription({ cardId: 'card-1', description: 'x'.repeat(10_001) }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });
});

describe('setCardDueDate', () => {
  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(setCardDueDate({ cardId: 'card-1', dueDate: '2026-09-01' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('stores midnight UTC of the chosen day', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: '2026-09-01' });
    const write = ops.find((op) => op.kind === 'update' && op.table === 'cards');
    expect((write?.values as { dueDate: Date }).dueDate.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  test('null clears the date', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: null });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { dueDate: null } });
  });

  test('refuses anything that is not a plain calendar date', async () => {
    await expect(setCardDueDate({ cardId: 'card-1', dueDate: '01/09/2026' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });
});

const MUTATION_ID = '11111111-1111-4111-8111-111111111111';

describe('moveCard', () => {
  beforeEach(() => {
    columnRow = { id: 'col-2', boardId: 'b1' };
    cardsInColumn = [
      { id: 'card-a', rank: 'a0' },
      { id: 'card-b', rank: 'a1' },
    ];
  });

  test('requires a mutationId', async () => {
    await expect(
      moveCard({ cardId: 'card-1', toColumnId: 'col-1', beforeCardId: null, afterCardId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  // Both call sites mint this with crypto.randomUUID(). Bounding it to a UUID
  // keeps a client from posting an oversized value that pushes the published
  // event over PAYLOAD_CEILING, silently dropping it for every other viewer.
  test('refuses a mutationId that is not a UUID', async () => {
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-1',
        beforeCardId: null,
        afterCardId: null,
        mutationId: 'x'.repeat(9_000),
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('publishes card.moved on the board, carrying the server rank', async () => {
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-1',
      beforeCardId: null,
      afterCardId: null,
      mutationId: MUTATION_ID,
    });

    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.moved',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
      id: 'card-1',
      columnId: 'col-1',
      rank: 'a0',
    });
  });

  // The event announces a write that happened. Announcing a rejected one puts
  // every other client into a state the database disagrees with.
  test('publishes nothing when the move is refused', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-1',
      beforeCardId: null,
      afterCardId: null,
      mutationId: MUTATION_ID,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(
      moveCard({
        cardId: 'gone',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  test('refuses a target column on another board', async () => {
    columnRow = { id: 'col-2', boardId: 'other-board' };
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a neighbour that is not in the target column', async () => {
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: 'card-from-elsewhere',
        afterCardId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses neighbours in the wrong order', async () => {
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: 'card-b',
        afterCardId: 'card-a',
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  // Access is decided before the cross-board question is asked. Answering that
  // first would tell a non-member whether two ids sit on the same board.
  test('refuses a non-member before it says whether the target is on their board', async () => {
    columnRow = { id: 'col-2', boardId: 'other-board' };
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));

    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: null,
        afterCardId: null,
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  test('ranks between the two neighbours it was given', async () => {
    const result = await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: 'card-a',
      afterCardId: 'card-b',
      mutationId: MUTATION_ID,
    });

    expect(result.ok).toBe(true);
    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
  });

  test('ranks before everything when dropped at the top', async () => {
    const result = await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: null,
      afterCardId: 'card-a',
      mutationId: MUTATION_ID,
    });

    expect((result as { data: { rank: string } }).data.rank < 'a0').toBe(true);
  });

  // This is the property fractional ranks exist to protect. A move must never
  // renumber siblings — one card row, plus the board's timestamp.
  test('writes exactly one card row, and bumps the board', async () => {
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: 'card-a',
      afterCardId: 'card-b',
      mutationId: MUTATION_ID,
    });

    expect(ops.filter((op) => op.table === 'cards')).toHaveLength(1);
    expect(ops.filter((op) => op.table === 'cards')[0]).toMatchObject({
      kind: 'update',
      values: expect.objectContaining({ columnId: 'col-2' }),
    });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});
