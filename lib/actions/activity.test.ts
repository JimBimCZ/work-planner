import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

let lines: unknown[] = [];
const boardActivity = vi.fn(async (boardId: string) => {
  void boardId;
  return lines;
});
vi.mock('@/lib/activity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/activity')>('@/lib/activity');
  return { ...actual, boardActivity: (boardId: string) => boardActivity(boardId) };
});

const findFirst = vi.fn();
const upserted: unknown[] = [];
const upsertSpy = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    query: { activityReads: { findFirst: (...args: unknown[]) => findFirst(...args) } },
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async () => {
          upsertSpy(values);
          upserted.push(values);
        },
      }),
    }),
  },
}));

const { openActivity } = await import('./activity');

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  lines = [];
  boardActivity.mockClear();
  findFirst.mockReset();
  findFirst.mockResolvedValue(undefined);
  upserted.length = 0;
  upsertSpy.mockClear();
});

describe('openActivity', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(openActivity({ boardId: 'b1' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  // Seeing the board is seeing what happened on it — the same argument
  // attachments make for reading one.
  test('a viewer may read the feed', async () => {
    await openActivity({ boardId: 'b1' });

    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a board the caller cannot reach', async () => {
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));

    await expect(openActivity({ boardId: 'b1' })).resolves.toMatchObject({ ok: false });
    expect(boardActivity).not.toHaveBeenCalled();
  });

  test('threads the feed straight through on success', async () => {
    lines = [
      {
        id: 'a1',
        sentence: 'created this board',
        actorId: 'user-1',
        actorName: 'Vit',
        actorImage: null,
        createdAt: '2026-09-03T10:00:00.000Z',
      },
    ];

    await expect(openActivity({ boardId: 'b1' })).resolves.toEqual({
      ok: true,
      data: { lines, seenAt: null },
    });
  });
});

describe('openActivity marks the board as seen', () => {
  test('returns the marker from before this visit, then moves it', async () => {
    const previous = new Date('2026-09-02T10:00:00.000Z');
    findFirst.mockResolvedValue({ lastSeenAt: previous });

    const result = await openActivity({ boardId: 'b1' });

    expect(result).toMatchObject({ ok: true, data: { seenAt: previous.toISOString() } });
    expect(upserted).toHaveLength(1);
    // The order is the whole feature: read, answer, then move the marker.
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      upsertSpy.mock.invocationCallOrder[0],
    );
  });

  test('a first visit has no marker and still records one', async () => {
    findFirst.mockResolvedValue(undefined);

    await expect(openActivity({ boardId: 'b1' })).resolves.toMatchObject({
      ok: true,
      data: { seenAt: null },
    });
    expect(upserted).toHaveLength(1);
  });

  test('records nothing for a board the caller cannot reach', async () => {
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));

    await openActivity({ boardId: 'b1' });

    expect(upserted).toHaveLength(0);
  });
});
