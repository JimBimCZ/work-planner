import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const findPendingInvite = vi.fn();
vi.mock('@/lib/members', () => ({ findPendingInvite: (id: string) => findPendingInvite(id) }));

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

let userRow: { id: string } | undefined;
let membershipRow: { role: string } | undefined;
let boardRow: { name: string } | undefined;
let inviteRow: { id: string; boardId: string } | undefined;

const query = {
  users: { findFirst: async () => userRow },
  boardMembers: { findFirst: async () => membershipRow },
  boards: { findFirst: async () => boardRow },
  boardInvites: { findFirst: async () => inviteRow },
};

const writer = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return {
        onConflictDoUpdate: async () => undefined,
        onConflictDoNothing: async () => undefined,
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
  db: { ...writer, transaction: (fn: (t: typeof writer) => Promise<unknown>) => fn(writer) },
}));

const { acceptInvite, changeRole, declineInvite, inviteMember, leaveBoard, removeMember, revokeInvite } =
  await import('./members');

const signedIn = { user: { id: 'owner-1', email: 'owner@example.test' } };
const invite = { boardId: 'board-1', email: 'new@example.test', role: 'member' as const };

beforeEach(() => {
  ops.length = 0;
  userRow = undefined;
  membershipRow = undefined;
  boardRow = undefined;
  inviteRow = undefined;
  authMock.mockReset();
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('owner');
  findPendingInvite.mockReset();
});

describe('inviteMember', () => {
  test('refuses a request with no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(inviteMember(invite)).resolves.toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  test('refuses an address that is not an address', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(inviteMember({ ...invite, email: 'not-an-address' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses to hand out owner', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(inviteMember({ ...invite, role: 'owner' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(ops).toEqual([]);
  });

  test('demands owner on the board before it writes anything', async () => {
    authMock.mockResolvedValue(signedIn);
    await inviteMember(invite);
    expect(assertBoardAccess).toHaveBeenCalledWith('owner-1', 'board-1', 'owner');
  });

  test('refuses an address that is already on the board', async () => {
    authMock.mockResolvedValue(signedIn);
    userRow = { id: 'user-2' };
    membershipRow = { role: 'member' };
    await expect(inviteMember(invite)).resolves.toEqual({ ok: false, error: 'ALREADY_MEMBER' });
    expect(ops).toEqual([]);
  });

  test('stores the address folded to lower case', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(inviteMember({ ...invite, email: '  NEW@Example.test ' })).resolves.toEqual({
      ok: true,
    });
    expect(ops).toEqual([
      {
        kind: 'insert',
        table: 'board_invites',
        values: {
          boardId: 'board-1',
          email: 'new@example.test',
          role: 'member',
          invitedById: 'owner-1',
        },
      },
    ]);
  });
});

describe('revokeInvite', () => {
  test('answers NOT_FOUND for an invite that is not there', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(revokeInvite({ inviteId: 'nope' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  test('deletes the invite once the caller owns its board', async () => {
    authMock.mockResolvedValue(signedIn);
    inviteRow = { id: 'invite-1', boardId: 'board-1' };
    await expect(revokeInvite({ inviteId: 'invite-1' })).resolves.toEqual({ ok: true });
    expect(assertBoardAccess).toHaveBeenCalledWith('owner-1', 'board-1', 'owner');
    expect(ops).toEqual([{ kind: 'delete', table: 'board_invites' }]);
  });
});

describe('acceptInvite', () => {
  const invitee = { user: { id: 'user-2', email: 'New@Example.test' } };

  test('answers NOT_FOUND when the invite has expired or never existed', async () => {
    authMock.mockResolvedValue(invitee);
    findPendingInvite.mockResolvedValue(null);
    await expect(acceptInvite({ inviteId: 'invite-1' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(ops).toEqual([]);
  });

  // The same answer as an expired invite, deliberately: a guessed id must not
  // learn that it named a real invite addressed to someone else.
  test('answers NOT_FOUND for an invite addressed to somebody else', async () => {
    authMock.mockResolvedValue(invitee);
    findPendingInvite.mockResolvedValue({
      id: 'invite-1',
      boardId: 'board-1',
      email: 'someone@example.test',
      role: 'member',
    });
    await expect(acceptInvite({ inviteId: 'invite-1' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(ops).toEqual([]);
  });

  test('adds the membership and consumes the invite, matching case-insensitively', async () => {
    authMock.mockResolvedValue(invitee);
    findPendingInvite.mockResolvedValue({
      id: 'invite-1',
      boardId: 'board-1',
      email: 'new@example.test',
      role: 'viewer',
    });
    await expect(acceptInvite({ inviteId: 'invite-1' })).resolves.toEqual({
      ok: true,
      data: { boardId: 'board-1' },
    });
    expect(ops).toEqual([
      {
        kind: 'insert',
        table: 'board_members',
        values: { boardId: 'board-1', userId: 'user-2', role: 'viewer' },
      },
      { kind: 'delete', table: 'board_invites' },
    ]);
  });

  test('never calls assertBoardAccess, because the invitee is not on the board yet', async () => {
    authMock.mockResolvedValue(invitee);
    findPendingInvite.mockResolvedValue({
      id: 'invite-1',
      boardId: 'board-1',
      email: 'new@example.test',
      role: 'member',
    });
    await acceptInvite({ inviteId: 'invite-1' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });
});

describe('declineInvite', () => {
  test('deletes the invite it was addressed to', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2', email: 'new@example.test' } });
    findPendingInvite.mockResolvedValue({
      id: 'invite-1',
      boardId: 'board-1',
      email: 'new@example.test',
      role: 'member',
    });
    await expect(declineInvite({ inviteId: 'invite-1' })).resolves.toEqual({ ok: true });
    expect(ops).toEqual([{ kind: 'delete', table: 'board_invites' }]);
  });
});

describe('changeRole and removeMember', () => {
  test('refuse a target who is not on the board', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = undefined;
    await expect(
      changeRole({ boardId: 'board-1', userId: 'ghost', role: 'viewer' }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    await expect(removeMember({ boardId: 'board-1', userId: 'ghost' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(ops).toEqual([]);
  });

  // There is one owner row, so this is also the guard against an owner
  // demoting or removing themselves.
  test('refuse to touch the owner', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = { role: 'owner' };
    await expect(
      changeRole({ boardId: 'board-1', userId: 'owner-1', role: 'viewer' }),
    ).resolves.toEqual({ ok: false, error: 'TARGET_IS_OWNER' });
    await expect(removeMember({ boardId: 'board-1', userId: 'owner-1' })).resolves.toEqual({
      ok: false,
      error: 'TARGET_IS_OWNER',
    });
    expect(ops).toEqual([]);
  });

  test('demote a member to viewer', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = { role: 'member' };
    await expect(
      changeRole({ boardId: 'board-1', userId: 'user-2', role: 'viewer' }),
    ).resolves.toEqual({ ok: true });
    expect(ops).toEqual([{ kind: 'update', table: 'board_members', values: { role: 'viewer' } }]);
  });

  test('remove a member', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = { role: 'member' };
    await expect(removeMember({ boardId: 'board-1', userId: 'user-2' })).resolves.toEqual({
      ok: true,
    });
    expect(ops).toEqual([{ kind: 'delete', table: 'board_members' }]);
  });
});

describe('leaveBoard', () => {
  test('refuses the owner, who has to hand the board over first', async () => {
    authMock.mockResolvedValue(signedIn);
    assertBoardAccess.mockResolvedValue('owner');
    await expect(leaveBoard({ boardId: 'board-1' })).resolves.toEqual({
      ok: false,
      error: 'OWNER_CANNOT_LEAVE',
    });
    expect(ops).toEqual([]);
  });

  test('lets a viewer take themselves off', async () => {
    authMock.mockResolvedValue(signedIn);
    assertBoardAccess.mockResolvedValue('viewer');
    await expect(leaveBoard({ boardId: 'board-1' })).resolves.toEqual({ ok: true });
    expect(ops).toEqual([{ kind: 'delete', table: 'board_members' }]);
  });
});
