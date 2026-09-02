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

type Op = { kind: 'insert' | 'update' | 'delete' | 'query' | 'transaction'; table: string; values?: unknown };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

let labelRow: { id: string; boardId: string; name: string } | undefined;
let labelCount = 0;
let insertRejects: Error | undefined;
let updateRejects: Error | undefined;
let cardRow: { boardId: string } | undefined;
let submittedLabels: { id: string; boardId: string }[] = [];
// Rows the cap query's `where` callback actually has to filter, so a test can
// tell "no board has fifty" from "this board has fifty" — labelCount alone
// cannot, since it never varies by board.
let capLabelRows: { boardId: string }[] | undefined;

type CapQueryArgs = {
  where?: (
    row: Record<string, unknown>,
    helpers: { eq: (a: unknown, b: unknown) => boolean },
  ) => unknown;
};

const query = {
  labels: {
    findFirst: async () => labelRow,
    findMany: async (args?: CapQueryArgs) => {
      if (submittedLabels.length > 0) {
        // Marks where in the op sequence setCardLabels's ownership read
        // actually runs, so a test can assert it happens after the
        // transaction has begun rather than before it.
        ops.push({ kind: 'query', table: 'labels' });
        return submittedLabels;
      }
      if (capLabelRows) {
        const eq = (a: unknown, b: unknown) => a === b;
        return args?.where ? capLabelRows.filter((row) => args.where!(row, { eq })) : capLabelRows;
      }
      return Array.from({ length: labelCount }, (_, i) => ({ id: `l${i}` }));
    },
  },
  cards: {
    findFirst: async () => cardRow,
  },
};

const writer = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      if (insertRejects) throw insertRejects;
      ops.push({ kind: 'insert', table: tableName(table), values });
      return { returning: async () => [{ id: 'label-new' }], onConflictDoNothing: async () => undefined };
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        if (updateRejects) throw updateRejects;
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
  db: {
    ...writer,
    transaction: (fn: (t: typeof writer) => Promise<unknown>) => {
      ops.push({ kind: 'transaction', table: 'begin' });
      return fn(writer);
    },
  },
}));

const { createLabel, deleteLabel, renameLabel, setCardLabels } = await import('./labels');

const signedIn = { user: { id: 'user-1', email: 'dev@example.test' } };
const MUTATION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  ops.length = 0;
  labelRow = undefined;
  labelCount = 0;
  insertRejects = undefined;
  updateRejects = undefined;
  cardRow = undefined;
  submittedLabels = [];
  capLabelRows = undefined;
  authMock.mockReset();
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  publish.mockReset();
});

describe('createLabel', () => {
  const input = { boardId: 'board-1', name: 'bug', mutationId: MUTATION_ID };

  test('refuses a request with no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(ops).toEqual([]);
  });

  test('refuses a name past the cap before it writes anything', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: 'x'.repeat(33) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(ops).toEqual([]);
  });

  test('refuses a blank name, including one that is only spaces', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // Every call site mints this with crypto.randomUUID(). Bounding it to a UUID
  // keeps a client from posting an oversized value that pushes card.labelled
  // (the one new event carrying a variable-length array) over PAYLOAD_CEILING,
  // silently dropping it for every other viewer.
  test('refuses a mutationId that is not a UUID', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, mutationId: 'x'.repeat(9_000) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(ops).toEqual([]);
  });

  // Checks the args a rejected call receives, and that a rejection actually
  // blocks the insert — a mock recorded with the right args proves nothing
  // about ordering on its own.
  test('demands member on the board before it writes anything', async () => {
    authMock.mockResolvedValue(signedIn);
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'board-1', 'member');
    expect(ops).toEqual([]);
  });

  test('refuses the fifty-first label', async () => {
    authMock.mockResolvedValue(signedIn);
    labelCount = 50;
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'LIMIT_REACHED' });
    expect(ops).toEqual([]);
  });

  // The cap has to scope to this board. Another board sitting at the limit
  // must never block this one — only a where clause on boardId prevents that.
  test('counts only this board toward the cap, not every board', async () => {
    authMock.mockResolvedValue(signedIn);
    capLabelRows = [
      ...Array.from({ length: 50 }, () => ({ boardId: 'board-9' })),
      ...Array.from({ length: 2 }, () => ({ boardId: 'board-1' })),
    ];
    await expect(createLabel(input)).resolves.toEqual({ ok: true, data: { id: 'label-new' } });
  });

  // The database owns this, not a pre-read: two simultaneous creates would
  // both pass a check-then-insert.
  test('turns the unique violation into DUPLICATE', async () => {
    authMock.mockResolvedValue(signedIn);
    insertRejects = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'DUPLICATE' });
  });

  test('stores the name trimmed, and announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: '  bug  ' })).resolves.toEqual({
      ok: true,
      data: { id: 'label-new' },
    });
    expect(ops).toEqual([
      { kind: 'insert', table: 'labels', values: { boardId: 'board-1', name: 'bug' } },
    ]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'label.created',
      id: 'label-new',
      name: 'bug',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });
});

describe('renameLabel', () => {
  test('answers NOT_FOUND for a label that is not there, without checking access', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(
      renameLabel({ labelId: 'nope', name: 'chore', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  // The client says which label, never which board: the row is what decides
  // whose permission is checked.
  test('checks the board named by the row, not by the caller', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-9', name: 'bug' };
    await renameLabel({ labelId: 'label-1', name: 'chore', mutationId: MUTATION_ID });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'board-9', 'member');
    expect(ops).toEqual([{ kind: 'update', table: 'labels', values: { name: 'chore' } }]);
    expect(publish).toHaveBeenCalledWith('board-9', {
      type: 'label.updated',
      id: 'label-1',
      name: 'chore',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  test('turns the unique violation into DUPLICATE', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    updateRejects = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(
      renameLabel({ labelId: 'label-1', name: 'Bug', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'DUPLICATE' });
  });

  test('refuses a viewer', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      renameLabel({ labelId: 'label-1', name: 'chore', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(ops).toEqual([]);
  });
});

describe('deleteLabel', () => {
  test('deletes the row and announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    await expect(deleteLabel({ labelId: 'label-1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(ops).toEqual([{ kind: 'delete', table: 'labels' }]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'label.deleted',
      id: 'label-1',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  test('refuses a viewer', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteLabel({ labelId: 'label-1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(ops).toEqual([]);
  });
});

describe('setCardLabels', () => {
  const input = { cardId: 'card-1', labelIds: ['l1', 'l2'], mutationId: MUTATION_ID };

  test('answers NOT_FOUND for a card that is not there', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  // The only one of the four a viewer can plausibly reach: the picker is on a
  // card they are allowed to open and read.
  test('refuses a viewer', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'board-1', 'member');
    expect(ops).toEqual([]);
  });

  // The whole reason this action re-reads the labels it was handed. Without
  // it, a member of board A staples board B's label onto a card by id. The
  // read now runs inside the transaction (see the ordering test below), so a
  // rejection here leaves only the transaction-start and the read behind —
  // never a card_labels or boards write.
  test('refuses a label belonging to another board', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [
      { id: 'l1', boardId: 'board-1' },
      { id: 'l2', boardId: 'board-2' },
    ];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'INVALID' });
    expect(ops).toEqual([
      { kind: 'transaction', table: 'begin' },
      { kind: 'query', table: 'labels' },
    ]);
  });

  test('refuses an id that names no label at all', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [{ id: 'l1', boardId: 'board-1' }];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'INVALID' });
    expect(ops).toEqual([
      { kind: 'transaction', table: 'begin' },
      { kind: 'query', table: 'labels' },
    ]);
  });

  // Finding 5: the ownership read used to run before db.transaction was ever
  // called, so a label deleted between the read and the write raised an
  // unhandled foreign key violation instead of returning INVALID. Reading it
  // through tx closes that window; this asserts the read happens after the
  // transaction starts, not before.
  test('reads label ownership inside the transaction, not before it', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [
      { id: 'l1', boardId: 'board-1' },
      { id: 'l2', boardId: 'board-1' },
    ];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: true });
    expect(ops[0]).toEqual({ kind: 'transaction', table: 'begin' });
    expect(ops[1]).toEqual({ kind: 'query', table: 'labels' });
  });

  test('replaces the whole set in one transaction, then announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [
      { id: 'l1', boardId: 'board-1' },
      { id: 'l2', boardId: 'board-1' },
    ];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: true });
    expect(ops).toEqual([
      { kind: 'transaction', table: 'begin' },
      { kind: 'query', table: 'labels' },
      { kind: 'delete', table: 'card_labels' },
      {
        kind: 'insert',
        table: 'card_labels',
        values: [
          { cardId: 'card-1', labelId: 'l1' },
          { cardId: 'card-1', labelId: 'l2' },
        ],
      },
      { kind: 'update', table: 'boards', values: { updatedAt: expect.any(Date) } },
    ]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'card.labelled',
      id: 'card-1',
      labelIds: ['l1', 'l2'],
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  // Clearing every label is a legal instruction, not an empty request.
  test('accepts an empty set and writes only the delete', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [];
    await expect(
      setCardLabels({ cardId: 'card-1', labelIds: [], mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: true });
    expect(ops.filter((op) => op.table === 'card_labels')).toEqual([
      { kind: 'delete', table: 'card_labels' },
    ]);
    expect(publish).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({ type: 'card.labelled', labelIds: [] }),
    );
  });

  // submittedLabels legitimately belongs to board-1 so the ownership guard
  // would pass; only the cap is left to reject, and only safeParse runs
  // before assertBoardAccess, so a call there would mean the cap did not.
  test('refuses more labels than a board can hold', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = Array.from({ length: 51 }, (_, i) => ({ id: `l${i}`, boardId: 'board-1' }));
    await expect(
      setCardLabels({
        cardId: 'card-1',
        labelIds: Array.from({ length: 51 }, (_, i) => `l${i}`),
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
    expect(ops).toEqual([]);
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });
});
