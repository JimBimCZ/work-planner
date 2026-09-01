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

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

let labelRow: { id: string; boardId: string; name: string } | undefined;
let labelCount = 0;
let insertRejects: Error | undefined;
let updateRejects: Error | undefined;

const query = {
  labels: {
    findFirst: async () => labelRow,
    findMany: async () => Array.from({ length: labelCount }, (_, i) => ({ id: `l${i}` })),
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
  db: { ...writer, transaction: (fn: (t: typeof writer) => Promise<unknown>) => fn(writer) },
}));

const { createLabel, deleteLabel, renameLabel } = await import('./labels');

const signedIn = { user: { id: 'user-1', email: 'dev@example.test' } };
const MUTATION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  ops.length = 0;
  labelRow = undefined;
  labelCount = 0;
  insertRejects = undefined;
  updateRejects = undefined;
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
