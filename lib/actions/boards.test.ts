import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Insert = { table: string; values: unknown };
const inserts: Insert[] = [];

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
  db: { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { createBoard } = await import('./boards');
const { DEFAULT_COLUMN_NAMES } = await import('@/lib/board-defaults');

beforeEach(() => {
  inserts.length = 0;
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
