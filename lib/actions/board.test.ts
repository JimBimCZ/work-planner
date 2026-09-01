import { beforeEach, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

// The pool is never opened: every read this module makes is mocked below, and
// lib/permissions imports lib/db at module scope.
vi.mock('@/lib/db', () => ({ db: {} }));

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

const getBoardWithColumns = vi.fn();
vi.mock('@/lib/boards', () => ({
  getBoardWithColumns: (boardId: string) => getBoardWithColumns(boardId),
}));

import { BoardAccessError } from '@/lib/permissions';

import { readBoard } from './board';

const BOARD = {
  id: 'b1',
  name: 'Roadmap',
  labels: [{ id: 'l1', name: 'bug' }],
  columns: [
    {
      id: 'col-1',
      name: 'Ready to Work',
      rank: 'a0',
      cards: [
        {
          id: 'card-1',
          columnId: 'col-1',
          title: 'Ship it',
          rank: 'b0',
          createdAt: new Date('2026-08-31T10:00:00.000Z'),
          dueDate: new Date('2026-09-10T00:00:00.000Z'),
          cardLabels: [{ labelId: 'l1' }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockResolvedValue('member');
  getBoardWithColumns.mockResolvedValue(BOARD);
});

test('refuses without a session', async () => {
  authMock.mockResolvedValue(null);
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({
    ok: false,
    error: 'UNAUTHENTICATED',
  });
});

test('refuses a malformed input', async () => {
  await expect(readBoard({})).resolves.toEqual({ ok: false, error: 'INVALID' });
});

// A reconnect is not a reason to trust a boardId from a client. The proxy is
// routing, not authorisation.
test('refuses a board the caller is not a member of', async () => {
  assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
});

test('asks for viewer, since reading is all it does', async () => {
  await readBoard({ boardId: 'b1' });
  expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
});

test('publishes nothing — it is a read', async () => {
  await readBoard({ boardId: 'b1' });
  expect(publish).not.toHaveBeenCalled();
});

test('reports a board that is not there', async () => {
  getBoardWithColumns.mockResolvedValue(null);
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
});

// The same shape the canvas seeds from, built by the same function, so a
// reconnect cannot disagree with the initial render about dates or ordering.
test('returns the board in the shape the reducer holds', async () => {
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({
    ok: true,
    data: {
      labels: [{ id: 'l1', name: 'bug' }],
      columns: [{ id: 'col-1', name: 'Ready to Work', rank: 'a0' }],
      cards: [
        {
          id: 'card-1',
          columnId: 'col-1',
          title: 'Ship it',
          rank: 'b0',
          createdAt: '2026-08-31T10:00:00.000Z',
          dueDate: '2026-09-10',
          labelIds: ['l1'],
        },
      ],
    },
  });
});
