import { describe, expect, test, vi } from 'vitest';

let ownedBoards: unknown[] = [];
let accountRows: { provider: string }[] = [];

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      boards: { findMany: async () => ownedBoards },
      accounts: { findMany: async () => accountRows },
    },
  },
}));

const { sharedBoardsOwnedBy, signInProviders } = await import('./account');

describe('sharedBoardsOwnedBy', () => {
  test('ignores a board whose only member is the owner', async () => {
    ownedBoards = [{ id: 'b1', name: 'Solo', members: [{ userId: 'u1' }] }];
    await expect(sharedBoardsOwnedBy('u1')).resolves.toEqual([]);
  });

  test('returns a board that someone else is a member of', async () => {
    ownedBoards = [{ id: 'b1', name: 'Roadmap', members: [{ userId: 'u1' }, { userId: 'u2' }] }];
    await expect(sharedBoardsOwnedBy('u1')).resolves.toEqual([{ id: 'b1', name: 'Roadmap' }]);
  });

  test('reads through the client it is given, so it can run inside a transaction', async () => {
    const findMany = vi.fn(async () => [
      { id: 'b2', name: 'Shared', members: [{ userId: 'u1' }, { userId: 'u3' }] },
    ]);
    const tx = { query: { boards: { findMany } } };
    await expect(sharedBoardsOwnedBy('u1', tx)).resolves.toEqual([{ id: 'b2', name: 'Shared' }]);
    expect(findMany).toHaveBeenCalled();
  });
});

describe('signInProviders', () => {
  test('labels a known provider and passes an unknown one through', async () => {
    accountRows = [{ provider: 'github' }, { provider: 'saml' }];
    await expect(signInProviders('u1')).resolves.toEqual(['GitHub', 'saml']);
  });
});
