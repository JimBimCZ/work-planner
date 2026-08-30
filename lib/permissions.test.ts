import { beforeEach, describe, expect, test, vi } from 'vitest';

const findFirst = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: { boardMembers: { findFirst: (...args: unknown[]) => findFirst(...args) } } },
}));

const { BoardAccessError, assertBoardAccess, atLeast, boardAccessResult } = await import(
  './permissions'
);

beforeEach(() => {
  findFirst.mockReset();
});

describe('atLeast', () => {
  test('ranks owner above member above viewer', () => {
    expect(atLeast('owner', 'member')).toBe(true);
    expect(atLeast('member', 'member')).toBe(true);
    expect(atLeast('viewer', 'member')).toBe(false);
    expect(atLeast('viewer', 'viewer')).toBe(true);
    expect(atLeast('member', 'owner')).toBe(false);
  });
});

describe('assertBoardAccess', () => {
  test('returns the caller role when it clears the bar', async () => {
    findFirst.mockResolvedValue({ role: 'owner' });

    await expect(assertBoardAccess('u1', 'b1', 'member')).resolves.toBe('owner');
  });

  test('throws NOT_FOUND when the caller is not a member', async () => {
    findFirst.mockResolvedValue(undefined);

    await expect(assertBoardAccess('u1', 'b1', 'viewer')).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
  });

  test('throws FORBIDDEN when the caller is a member of too low a role', async () => {
    findFirst.mockResolvedValue({ role: 'viewer' });

    await expect(assertBoardAccess('u1', 'b1', 'member')).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
  });

  test('never asks whether the board exists', async () => {
    findFirst.mockResolvedValue(undefined);

    await expect(assertBoardAccess('u1', 'b1', 'viewer')).rejects.toBeInstanceOf(BoardAccessError);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('boardAccessResult', () => {
  test('converts a board access error into the action result shape', () => {
    expect(boardAccessResult(new BoardAccessError('FORBIDDEN'))).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('rethrows anything else, so a real failure is never swallowed', () => {
    expect(() => boardAccessResult(new Error('connection refused'))).toThrow('connection refused');
  });
});
