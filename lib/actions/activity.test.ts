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

const { openActivity } = await import('./activity');

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  lines = [];
  boardActivity.mockClear();
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
      data: { lines },
    });
  });
});
