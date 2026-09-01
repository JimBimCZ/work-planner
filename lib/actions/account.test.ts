import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
const signOutMock = vi.fn<(options?: unknown) => Promise<void>>(async () => undefined);
vi.mock('@/lib/auth', () => ({ auth: () => authMock(), signOut: (o: unknown) => signOutMock(o) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let shared: { id: string; name: string }[] = [];
const sharedMock = vi.fn(async () => shared);
vi.mock('@/lib/account', () => ({ sharedBoardsOwnedBy: () => sharedMock() }));

let deletedUserId: string | null = null;
const tx = {
  delete: () => ({
    where: async () => {
      deletedUserId = 'called';
    },
  }),
};
vi.mock('@/lib/db', () => ({
  db: { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { deleteAccount } = await import('./account');

const signedIn = { user: { id: 'u1', email: 'me@example.test' } };

beforeEach(() => {
  shared = [];
  deletedUserId = null;
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
    expect(deletedUserId).toBeNull();
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
    expect(deletedUserId).toBeNull();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  test('deletes the user and signs out without redirecting', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({ ok: true });
    expect(deletedUserId).toBe('called');
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
  });
});
