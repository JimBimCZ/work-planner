import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

type Insert = { table: string; values: unknown };
const inserts: Insert[] = [];

let boardRow: { name: string } | undefined;
let updated: { id: string; name: string } | null = null;
let deleted: string | null = null;
let attachmentKeys: string[] = [];
const ops: string[] = [];

const forgetObjects = vi.fn();
const deleteObjects = vi.fn();
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    forgetObjects: (...a: unknown[]) => forgetObjects(...a),
    deleteObjects: (...a: unknown[]) => deleteObjects(...a),
  };
});

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const tx = {
  insert: (table: unknown) => ({
    values: (values: unknown) => ({
      returning: async () => {
        inserts.push({ table: tableName(table), values });
        return [{ id: 'board-1', name: (values as { name: string }).name }];
      },
      then: (resolve: (v: unknown) => unknown) => {
        inserts.push({ table: tableName(table), values });
        return Promise.resolve(resolve(undefined));
      },
    }),
  }),
};

vi.mock('@/lib/db', () => ({
  db: {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    query: { boards: { findFirst: async () => boardRow } },
    update: () => ({
      set: (values: { name: string }) => ({
        where: async () => {
          updated = { id: 'b1', name: values.name };
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          ops.push(`query:${tableName(table)}`);
          return attachmentKeys.map((key) => ({ key }));
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        ops.push(`delete:${tableName(table)}`);
        deleted = 'b1';
      },
    }),
  },
}));

const { createBoard, deleteBoard, renameBoard } = await import('./boards');
const { DEFAULT_COLUMN_NAMES } = await import('@/lib/board-defaults');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  inserts.length = 0;
  ops.length = 0;
  attachmentKeys = [];
  forgetObjects.mockReset();
  // Mirrors the real wrapper in lib/storage.ts: delegate, and swallow failure.
  forgetObjects.mockImplementation(async (keys: unknown) => {
    try {
      await deleteObjects(keys);
    } catch {
      /* best effort, exactly as lib/storage.ts does */
    }
  });
  deleteObjects.mockReset();
  deleteObjects.mockResolvedValue(undefined);
  boardRow = undefined;
  updated = null;
  deleted = null;
  assertBoardAccess.mockReset();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('createBoard', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);

    await expect(createBoard({ name: 'Roadmap' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('refuses an empty name', async () => {
    await expect(createBoard({ name: '   ' })).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a name over eighty characters', async () => {
    await expect(createBoard({ name: 'x'.repeat(81) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('writes the board, one owner row, and the five seeded columns', async () => {
    const result = await createBoard({ name: '  Roadmap  ' });

    expect(result).toEqual({ ok: true, data: { id: 'board-1' } });

    const board = inserts.find((i) => i.table === 'boards');
    expect(board?.values).toMatchObject({ name: 'Roadmap', ownerId: 'user-1' });

    const members = inserts.find((i) => i.table === 'board_members');
    expect(members?.values).toEqual({ boardId: 'board-1', userId: 'user-1', role: 'owner' });

    const seeded = inserts.find((i) => i.table === 'columns')?.values as {
      name: string;
      rank: string;
    }[];
    expect(seeded.map((c) => c.name)).toEqual(DEFAULT_COLUMN_NAMES);
    expect(seeded.map((c) => c.rank)).toEqual([...seeded.map((c) => c.rank)].sort());
  });

  test('seeds the columns CLAUDE.md names, in order', () => {
    expect(DEFAULT_COLUMN_NAMES).toEqual([
      'Ready to Work',
      'In Progress',
      'In Testing',
      'In Review',
      'Done',
    ]);
  });
});

describe('renameBoard', () => {
  test('requires member, not viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));

    await expect(renameBoard({ boardId: 'b1', name: 'New name' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('trims and writes the new name', async () => {
    assertBoardAccess.mockResolvedValue('member');

    await expect(renameBoard({ boardId: 'b1', name: '  Renamed  ' })).resolves.toEqual({ ok: true });
    expect(updated).toEqual({ id: 'b1', name: 'Renamed' });
  });
});

describe('deleteBoard', () => {
  test('requires owner', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'owner');
  });

  test('refuses when the typed name does not match, so the dialog is not the only guard', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'roadmap' })).resolves.toEqual({
      ok: false,
      error: 'NAME_MISMATCH',
    });
    expect(deleted).toBeNull();
  });

  test('deletes when the typed name matches exactly', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' })).resolves.toEqual({
      ok: true,
    });
    expect(deleted).toBe('b1');
  });

  test('deleting a board takes its objects out of the bucket', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };
    attachmentKeys = ['boards/b1/a1', 'boards/b1/a2'];

    await deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' });
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/a1', 'boards/b1/a2']);
  });

  test('the keys are read before the row is deleted', async () => {
    // After the cascade there is nothing left to read them from.
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };
    attachmentKeys = ['boards/b1/a1'];

    await deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' });
    expect(ops.indexOf('query:attachments')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('query:attachments')).toBeLessThan(ops.indexOf('delete:boards'));
  });

  test('a name mismatch touches neither the rows nor the bucket', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };
    attachmentKeys = ['boards/b1/a1'];

    await deleteBoard({ boardId: 'b1', confirmName: 'roadmap' });
    expect(forgetObjects).not.toHaveBeenCalled();
  });
});
