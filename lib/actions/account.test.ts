import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
const signOutMock = vi.fn<(options?: unknown) => Promise<void>>(async () => undefined);
vi.mock('@/lib/auth', () => ({ auth: () => authMock(), signOut: (o: unknown) => signOutMock(o) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let shared: { id: string; name: string }[] = [];
const sharedMock = vi.fn(async () => shared);
vi.mock('@/lib/account', () => ({ sharedBoardsOwnedBy: () => sharedMock() }));

const deleted: string[] = [];
const ops: string[] = [];
let attachmentKeys: string[] = [];

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
  delete: (table: unknown) => ({
    where: async () => {
      ops.push(`delete:${tableName(table)}`);
      deleted.push(tableName(table));
    },
  }),
};
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        innerJoin: () => ({
          where: async () => {
            ops.push(`query:${tableName(table)}`);
            return attachmentKeys.map((key) => ({ key }));
          },
        }),
      }),
    }),
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

const { deleteAccount } = await import('./account');

const signedIn = { user: { id: 'u1', email: 'me@example.test' } };

beforeEach(() => {
  shared = [];
  deleted.length = 0;
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
  authMock.mockReset();
  signOutMock.mockClear();
});

describe('deleteAccount', () => {
  test('refuses a request with no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('refuses input that is not the expected shape', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({})).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses an email that is not the signed-in one', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({ confirmEmail: 'someone@example.test' })).resolves.toEqual({
      ok: false,
      error: 'EMAIL_MISMATCH',
    });
    expect(deleted).toEqual([]);
  });

  test('accepts the email whatever its case and surrounding space', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({ confirmEmail: '  ME@Example.test ' })).resolves.toEqual({
      ok: true,
    });
  });

  test('refuses while the user owns a board someone else is on, and deletes nothing', async () => {
    authMock.mockResolvedValue(signedIn);
    shared = [{ id: 'b1', name: 'Roadmap' }];
    await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({
      ok: false,
      error: 'OWNS_SHARED_BOARDS',
      boards: [{ id: 'b1', name: 'Roadmap' }],
    });
    expect(deleted).toEqual([]);
    expect(signOutMock).not.toHaveBeenCalled();
  });

  test('deletes the user and signs out without redirecting', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({ ok: true });
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
  });

  // board_invites keys on an email address and has no foreign key to cascade
  // through, so nothing else removes an invite addressed to a departing user.
  // /privacy promises the deletion is complete.
  test('takes pending invites addressed to the departing user with it', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({ ok: true });
    expect(deleted).toEqual(['board_invites', 'user']);
  });

  test('takes the objects on boards the user owns out of the bucket', async () => {
    authMock.mockResolvedValue(signedIn);
    attachmentKeys = ['boards/b-mine/a1'];
    await deleteAccount({ confirmEmail: 'me@example.test' });
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b-mine/a1']);
  });

  test('the keys are read before the rows are deleted', async () => {
    // After the cascade there is nothing left to read them from.
    authMock.mockResolvedValue(signedIn);
    attachmentKeys = ['boards/b-mine/a1'];
    await deleteAccount({ confirmEmail: 'me@example.test' });
    expect(ops.indexOf('query:attachments')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('query:attachments')).toBeLessThan(ops.indexOf('delete:user'));
  });

  test('files on other people’s boards are left alone', async () => {
    // The uploader goes null and the file stays. Deleting them would break a
    // colleague's board and contradict the retention section of /privacy.
    // The join is on boards.ownerId, so a board the user merely uploaded to
    // never reaches this list in the first place.
    authMock.mockResolvedValue(signedIn);
    attachmentKeys = ['boards/b-mine/a1'];
    await deleteAccount({ confirmEmail: 'me@example.test' });
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b-mine/a1']);
    expect(forgetObjects).not.toHaveBeenCalledWith(
      expect.arrayContaining(['boards/b-theirs/a9']),
    );
  });

  test('a refused delete touches neither the rows nor the bucket', async () => {
    authMock.mockResolvedValue(signedIn);
    shared = [{ id: 'b1', name: 'Roadmap' }];
    attachmentKeys = ['boards/b-mine/a1'];
    await deleteAccount({ confirmEmail: 'me@example.test' });
    expect(forgetObjects).not.toHaveBeenCalled();
  });
});
