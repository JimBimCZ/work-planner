# Account deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user deletes their own account from `/account`, in one transaction, immediately.

**Architecture:** A server component page under `(app)/(chrome)` renders a danger zone; a client component collects a typed email confirmation and calls one server action. The action re-checks the block, deletes the `user` row, and lets the schema's cascades do the rest — `account`, `session`, `board_members` and owned boards all cascade from `user`, while `comments.authorId` and `cards.createdById` set null.

**Tech Stack:** Next 16 App Router, Drizzle, Auth.js v5, Zod, Vitest, Playwright.

**Spec:** `docs/specs/account-deletion.md`

## Global Constraints

- Server actions return a discriminated result object and never throw for expected failures.
- The only user id the action touches is `session.user.id`. Nothing is taken from the client but the typed email.
- `lib/permissions.ts` is not involved: the action is self-scoped, not board-scoped.
- No new migration. The schema already encodes every deletion rule.
- Copy is active voice, sentence case, no apology. The delete control says "Delete account".
- `--time-over` is the only warm colour on the page, and only on the destructive control.
- Before the PR: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e`, each exit code read from its own redirected log.

## Deviation from the spec, decided while planning

The spec puts "asserts the cascade actually happened" in `lib/actions/account.test.ts`. **It cannot live there.** Every unit test in this repo mocks `@/lib/db` wholesale (`lib/actions/boards.test.ts`, `lib/boards.test.ts`), so a mocked delete proves nothing about foreign keys. The cascade proof moves to `e2e/account.spec.ts`, which runs against real Postgres through `e2e/support/session.ts`'s pool. The unit tests keep the branch coverage — refusals, the block, and that the delete and sign-out are called at all.

## File structure

| File | Responsibility |
|---|---|
| `lib/account.ts` (create) | Two read queries: shared boards owned by a user, and their sign-in providers |
| `lib/account.test.ts` (create) | Unit tests for both, against a mocked `db` |
| `lib/actions/account.ts` (create) | `deleteAccount` — the only mutation |
| `lib/actions/account.test.ts` (create) | Refusal branches and the call sequence |
| `app/(app)/(chrome)/account/page.tsx` (create) | Server component: identity, providers, danger zone |
| `components/app/delete-account.tsx` (create) | Client component: confirmation input, action call, errors |
| `components/app/account-menu.tsx` (modify) | Adds the "Account" item above "Privacy" |
| `e2e/support/session.ts` (modify) | Adds row-inspection helpers the assertions need |
| `e2e/account.spec.ts` (create) | The real-database proofs |
| `e2e/board-view.spec.ts` (modify) | `/account` joins the footer route list |
| `app/(legal)/privacy/page.tsx` (modify) | "Keeping and deleting your data" now describes a flow that exists |
| `CLAUDE.md` (modify) | Resolves the open decision, records the sub-project order |

---

### Task 1: The two read queries

**Files:**
- Create: `lib/account.ts`
- Test: `lib/account.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `supportedProvider` from `@/lib/account-conflict`.
- Produces: `type OwnedBoard = { id: string; name: string }`; `sharedBoardsOwnedBy(userId: string, client?: BoardQuerier): Promise<OwnedBoard[]>`; `signInProviders(userId: string): Promise<string[]>`.

The `client` parameter exists so the action can run the same query inside its transaction. `tx` and `db` expose the same `query` shape, so one structural type covers both.

- [x] **Step 1: Write the failing test**

```ts
// lib/account.test.ts
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
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/account.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t1.log
```

Expected: non-zero, `Failed to resolve import "./account"`.

- [x] **Step 3: Write the implementation**

```ts
// lib/account.ts
import { db } from '@/lib/db';
import { supportedProvider } from '@/lib/account-conflict';

export type OwnedBoard = { id: string; name: string };

// db and a drizzle transaction expose the same query shape. Taking the client
// as a parameter is what lets deleteAccount re-run this check inside the
// transaction that does the delete, rather than racing it from outside.
type BoardQuerier = { query: { boards: { findMany: (config?: never) => Promise<unknown> } } };

export async function sharedBoardsOwnedBy(
  userId: string,
  client: BoardQuerier = db as unknown as BoardQuerier,
): Promise<OwnedBoard[]> {
  const owned = (await client.query.boards.findMany({
    where: (board, { eq }) => eq(board.ownerId, userId),
    columns: { id: true, name: true },
    with: { members: { columns: { userId: true } } },
  } as never)) as { id: string; name: string; members: { userId: string }[] }[];

  return owned
    .filter((board) => board.members.some((member) => member.userId !== userId))
    .map(({ id, name }) => ({ id, name }));
}

export async function signInProviders(userId: string): Promise<string[]> {
  const rows = await db.query.accounts.findMany({
    where: (account, { eq }) => eq(account.userId, userId),
    columns: { provider: true },
  });

  return rows.map((row) => supportedProvider(row.provider)?.label ?? row.provider);
}
```

If the `as never` / `as unknown as` casts turn out to be avoidable once `tsc` has seen the real types, remove them — `CLAUDE.md` forbids casts that exist only to silence the compiler. Try the untyped version first and only reach for a cast if drizzle's `findMany` overloads genuinely will not unify across `db` and `tx`.

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run lib/account.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t1.log
```

Expected: EXIT=0, 4 passed.

- [x] **Step 5: Commit**

```bash
git add lib/account.ts lib/account.test.ts
git commit -m "feat: query the boards an account deletion would strand"
```

---

### Task 2: `deleteAccount`

**Files:**
- Create: `lib/actions/account.ts`
- Test: `lib/actions/account.test.ts`

**Interfaces:**
- Consumes: `sharedBoardsOwnedBy` from Task 1; `auth`, `signOut` from `@/lib/auth`.
- Produces: `deleteAccount(input: unknown)` returning
  `{ ok: true } | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'EMAIL_MISMATCH' } | { ok: false; error: 'OWNS_SHARED_BOARDS'; boards: OwnedBoard[] }`.

`signOut({ redirect: false })` is deliberate. `next-auth`'s own types (`node_modules/next-auth/index.d.ts:287`) show `redirect?: R` with `Promise<R extends false ? any : never>` — the default redirects, which in a server action means a thrown `NEXT_REDIRECT` and a result the caller never receives. This action has to return a result, so it signs out without redirecting and the client navigates.

- [x] **Step 1: Write the failing test**

```ts
// lib/actions/account.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
const signOutMock = vi.fn(async () => undefined);
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
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/actions/account.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2.log
```

Expected: non-zero, `Failed to resolve import "./account"`.

- [x] **Step 3: Write the implementation**

```ts
// lib/actions/account.ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sharedBoardsOwnedBy } from '@/lib/account';
import { auth, signOut } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

const deleteSchema = z.object({ confirmEmail: z.string() });

export async function deleteAccount(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const userId = session.user.id;
  const typed = parsed.data.confirmEmail.trim().toLowerCase();
  if (typed !== session.user.email.toLowerCase()) {
    return { ok: false, error: 'EMAIL_MISMATCH' } as const;
  }

  const outcome = await db.transaction(async (tx) => {
    // Re-checked inside the transaction because a client can skip the page
    // that showed the list, and because membership could change under it.
    const shared = await sharedBoardsOwnedBy(userId, tx);
    if (shared.length > 0) {
      return { ok: false, error: 'OWNS_SHARED_BOARDS', boards: shared } as const;
    }

    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true } as const;
  });

  if (!outcome.ok) return outcome;

  // After the transaction commits, never inside it: the session row is already
  // gone by cascade, so this clears the cookie and nothing else.
  await signOut({ redirect: false });
  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run lib/actions/account.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2.log
```

Expected: EXIT=0, 6 passed.

- [x] **Step 5: Commit**

```bash
git add lib/actions/account.ts lib/actions/account.test.ts
git commit -m "feat: delete an account and the boards only it can reach"
```

---

### Task 3: `/account` and the danger zone

**Files:**
- Create: `app/(app)/(chrome)/account/page.tsx`, `components/app/delete-account.tsx`
- Modify: `components/app/account-menu.tsx`, `e2e/board-view.spec.ts`

**Interfaces:**
- Consumes: `deleteAccount` from Task 2; `sharedBoardsOwnedBy`, `signInProviders` from Task 1; `attempt` from `@/lib/attempt`.
- Produces: the route `/account`, and `<DeleteAccount email blockedBoards />`.

No `Dialog`. The page is already the deliberate destination, and the typed email is the confirmation — a dialog on top of it would be a second gate that guards nothing.

- [x] **Step 1: Write the page**

```tsx
// app/(app)/(chrome)/account/page.tsx
import { redirect } from 'next/navigation';

import { DeleteAccount } from '@/components/app/delete-account';
import { sharedBoardsOwnedBy, signInProviders } from '@/lib/account';
import { auth } from '@/lib/auth';

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect('/signin');

  const [providers, blockedBoards] = await Promise.all([
    signInProviders(session.user.id),
    sharedBoardsOwnedBy(session.user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-[22px] font-medium tracking-tight">Account</h1>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
        <dt className="text-muted">Name</dt>
        <dd>{session.user.name ?? '—'}</dd>
        <dt className="text-muted">Email</dt>
        <dd className="font-mono text-sm">{session.user.email}</dd>
        <dt className="text-muted">Sign-in</dt>
        <dd>{providers.length > 0 ? providers.join(', ') : '—'}</dd>
      </dl>

      <DeleteAccount email={session.user.email} blockedBoards={blockedBoards} />
    </main>
  );
}
```

- [x] **Step 2: Write the client component**

```tsx
// components/app/delete-account.tsx
'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { deleteAccount } from '@/lib/actions/account';
import type { OwnedBoard } from '@/lib/account';
import { attempt } from '@/lib/attempt';

export function DeleteAccount({
  email,
  blockedBoards,
}: {
  email: string;
  blockedBoards: OwnedBoard[];
}) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await attempt(() => deleteAccount({ confirmEmail }));
      if (!result.ok) {
        setError(
          result.error === 'EMAIL_MISMATCH'
            ? 'That is not your email address. Type it exactly to delete your account.'
            : result.error === 'OWNS_SHARED_BOARDS'
              ? 'Delete the boards listed above first.'
              : 'Your account could not be deleted. Try again.',
        );
        return;
      }
      // A hard navigation, not router.push: the session is gone and every
      // cached RSC payload in this tab was rendered for a user who no longer
      // exists.
      window.location.assign('/signin');
    });
  }

  return (
    <section className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Delete account
      </h2>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px]/6">
        <li>The boards you own go, with every column, card and comment on them.</li>
        <li>Your comments on other people&rsquo;s boards stay, without your name on them.</li>
        <li>
          If you want those removed too, ask before you delete — afterwards nothing links them to
          you, so the request cannot be honoured.
        </li>
        <li>It cannot be undone.</li>
      </ul>

      {blockedBoards.length > 0 ? (
        <div className="mt-4">
          <p className="text-[15px]/6">
            You own boards that other people are on. Delete them first, and your account can go with
            them.
          </p>
          <ul className="mt-2 space-y-1">
            {blockedBoards.map((board) => (
              <li key={board.id}>
                <Link href={`/boards/${board.id}`} className="text-flow-mid hover:underline">
                  {board.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form onSubmit={remove} className="mt-4 space-y-3">
          <label className="block text-sm text-muted" htmlFor="confirm-email">
            Type {email} to confirm
          </label>
          <input
            id="confirm-email"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            autoComplete="off"
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
          />
          {error && <p className="text-sm text-time-over">{error}</p>}
          <button
            type="submit"
            disabled={pending || confirmEmail.length === 0}
            className="rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
          >
            Delete account
          </button>
        </form>
      )}
    </section>
  );
}
```

- [x] **Step 3: Add the menu item**

In `components/app/account-menu.tsx`, immediately above the existing Privacy item:

```tsx
        <DropdownMenuItem asChild>
          <Link href="/account">Account</Link>
        </DropdownMenuItem>
```

- [x] **Step 4: Add `/account` to the footer route list**

In `e2e/board-view.spec.ts`, the loop in "the footer survives the move off the root layout":

```ts
    for (const path of ['/boards', '/account', '/privacy', '/design']) {
```

- [x] **Step 5: Verify it compiles and renders**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all EXIT=0. The build is not optional here: `lib/account.ts` imports `lib/db`, and a client component importing a value from it would pull `pg` into the browser bundle — `CLAUDE.md` records that only bundling catches that. `delete-account.tsx` imports `OwnedBoard` with `import type`, which is erased; if the build fails on `dns`/`fs`/`net`, that import lost its `type` keyword.

- [x] **Step 6: Commit**

```bash
git add app components e2e/board-view.spec.ts
git commit -m "feat: give the account a page and a way to delete itself"
```

---

### Task 4: The proofs that need a real database

**Files:**
- Modify: `e2e/support/session.ts`
- Create: `e2e/account.spec.ts`

**Interfaces:**
- Consumes: `seedSession`, `seedBoard`, `seedMember`, `seedCard`, `seedComment`, `removeSeededUser`, `closeSeedPool` — all already exported.
- Produces: `userRowCounts(userId)`, `commentAuthorId(commentId)`.

- [x] **Step 1: Add the row-inspection helpers**

Append to `e2e/support/session.ts`:

```ts
export type UserRowCounts = { user: number; account: number; session: number; members: number };

export async function userRowCounts(userId: string): Promise<UserRowCounts> {
  const { rows } = await seedPool().query<{
    user: string;
    account: string;
    session: string;
    members: string;
  }>(
    `select
       (select count(*) from "user" where id = $1) as user,
       (select count(*) from "account" where "userId" = $1) as account,
       (select count(*) from "session" where "userId" = $1) as session,
       (select count(*) from board_members where user_id = $1) as members`,
    [userId],
  );
  return {
    user: Number(rows[0].user),
    account: Number(rows[0].account),
    session: Number(rows[0].session),
    members: Number(rows[0].members),
  };
}

// undefined means the row is gone; null means it is there with no author.
export async function commentAuthorId(commentId: string): Promise<string | null | undefined> {
  const { rows } = await seedPool().query<{ author_id: string | null }>(
    'select author_id from comments where id = $1',
    [commentId],
  );
  return rows.length === 0 ? undefined : rows[0].author_id;
}
```

- [x] **Step 2: Write the failing e2e**

```ts
// e2e/account.spec.ts
import { expect, test } from '@playwright/test';

import {
  boardColumns,
  closeSeedPool,
  commentAuthorId,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedComment,
  seedMember,
  seedSession,
  userRowCounts,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a wrong email is refused and nothing is deleted', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/account');
    await page.getByLabel(/type .* to confirm/i).fill('not-my@example.test');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('That is not your email address.', { exact: false })).toBeVisible();
    expect((await userRowCounts(userId)).user).toBe(1);
  } finally {
    await removeSeededUser(userId);
  }
});

test('deleting takes the account, its boards and everything on them', async ({ page, context }) => {
  const { userId, email } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Doomed board');
  const [firstColumn] = await boardColumns(boardId);
  const cardId = await seedCard(firstColumn.id, { boardId, createdById: userId });
  await seedComment(cardId, userId);

  await page.goto('/account');
  await page.getByLabel(/type .* to confirm/i).fill(email);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForURL('**/signin');

  // The cascade chain: user -> boards -> columns and cards -> comments. The
  // cards.column_id constraint is NO ACTION, and this is the first delete that
  // makes Postgres resolve it with cards and columns going in one statement.
  expect(await userRowCounts(userId)).toEqual({ user: 0, account: 0, session: 0, members: 0 });
  expect(await boardColumns(boardId)).toEqual([]);

  // The old cookie is still in the jar and must no longer open anything.
  await page.goto('/boards');
  await expect(page).toHaveURL(/\/signin/);
});

test('comments on someone else\'s board outlive the account that wrote them', async ({
  page,
  context,
}) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Someone else\'s board');
  const [firstColumn] = await boardColumns(boardId);
  const cardId = await seedCard(firstColumn.id, { boardId, createdById: owner.userId });

  // A second browser context, so the guest has their own cookie.
  const guestContext = await page.context().browser()!.newContext();
  const guest = await seedSession(guestContext);
  await seedMember(boardId, guest.userId, 'member');
  const commentId = await seedComment(cardId, guest.userId, 'Still here');

  const guestPage = await guestContext.newPage();
  try {
    await guestPage.goto('/account');
    await guestPage.getByLabel(/type .* to confirm/i).fill(guest.email);
    await guestPage.getByRole('button', { name: 'Delete account' }).click();
    await guestPage.waitForURL('**/signin');

    expect((await userRowCounts(guest.userId)).user).toBe(0);
    await expect(commentAuthorId(commentId)).resolves.toBeNull();
  } finally {
    await guestContext.close();
    await removeSeededUser(owner.userId);
    await removeSeededUser(guest.userId);
  }
});

test('owning a board someone else is on blocks the delete', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Shared board');
  const otherContext = await page.context().browser()!.newContext();
  const other = await seedSession(otherContext);
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto('/account');
    await expect(page.getByRole('link', { name: 'Shared board' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
    expect((await userRowCounts(userId)).user).toBe(1);
  } finally {
    await otherContext.close();
    await removeSeededUser(other.userId);
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 3: Run it, read the exit code from a file**

```bash
pnpm exec playwright test e2e/account.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

Expected first run: failures, because the page does not exist yet if tasks run out of order. On a correct run: EXIT=0, and **compare the number collected against the number run** — `4 passed` against `Running 4 tests`. A skipped realtime-style test is indistinguishable from a passing one in the summary line.

**If the second test fails on a foreign key violation naming `cards_column_id_columns_id_fk`,** that is the `NO ACTION` constraint the spec flagged, resolving immediately rather than at end of statement. Stop and report it — the fix is a schema change (making the constraint `deferrable initially deferred`, or deleting cards explicitly before the user row), and it is a decision, not a patch to apply quietly.

- [x] **Step 4: Commit**

```bash
git add e2e/account.spec.ts e2e/support/session.ts
git commit -m "test: prove the account delete cascade against a real database"
```

---

### Task 5: Make the documents true

**Files:**
- Modify: `app/(legal)/privacy/page.tsx`, `CLAUDE.md`

- [x] **Step 1: Update the policy**

Replace the body of the "Keeping and deleting your data" section:

```tsx
        <p className="text-[15px]/6">
          Your account and board content are kept for as long as your account exists. You can delete
          your account yourself from the account page: it removes your sign-in, your sessions, the
          boards you own and everything on them, immediately and permanently. Boards owned by other
          people keep the comments you left on them, without your name attached — if you want those
          removed as well, email{' '}
          <span className="font-mono text-sm">{CONTACT_EMAIL}</span> before you delete your account,
          because afterwards nothing links them to you.
        </p>
```

Move `LAST_UPDATED` to the date this lands.

- [x] **Step 2: Update `CLAUDE.md`**

Under "Open decisions", replace the account-deletion bullet with a line recording that it is settled — self-service, immediate, hard delete, blocked while the user owns a shared board — and add the remaining order: member management and invites next, then labels/tags, then attachments.

- [x] **Step 3: Run the policy's own tests**

```bash
pnpm exec vitest run 'app/(legal)/privacy/page.test.tsx' --reporter=verbose > /tmp/p.log 2>&1; echo "EXIT=$?"; grep -c "✓" /tmp/p.log
```

Expected: EXIT=0, 16 checks.

- [x] **Step 4: Commit**

```bash
git add app/\(legal\)/privacy/page.tsx CLAUDE.md
git commit -m "docs: describe the delete flow that now exists"
```

---

## Deviations while executing

Five, all small, all verified:

- `lib/account.ts` carries **none** of the casts the plan hedged on. Typing the client as
  `{ query: { boards: { findMany: (config: Parameters<typeof db.query.boards.findMany>[0]) => Promise<unknown> } } }`
  accepts `db`, a drizzle transaction and the test's plain mock, so `as never` and `as unknown as`
  were both unnecessary. One `as BoardRow[]` on the result remains, and it is load-bearing: the
  structural parameter type is what erases the row type.
- `signOutMock` is `vi.fn<(options?: unknown) => Promise<void>>(...)`. The plan's zero-argument
  `vi.fn` fails `tsc` at the call site inside the module mock — `Expected 0 arguments, but got 1`.
- `window.location.assign('/signin')` carries an `eslint-disable-next-line` for
  `@next/next/no-location-assign-relative-destination`. The hard navigation is the point: a router
  push keeps the RSC cache rendered for a user who no longer exists.
- The delete button gained `disabled:opacity-50`, matching `new-card-button.tsx`. Without it the
  disabled control is indistinguishable from the enabled one.
- The third e2e test now also reads the orphaned comment back **as the board owner**, because the
  gate asks whether it is readable and a null `author_id` is not that question. It renders as
  `Deleted account`, a branch `card-comments.tsx` already had.

`signOut({ redirect: false })` was confirmed against `node_modules/next-auth/index.d.ts:287` before
it was written: `<R extends boolean = true>(options?: { redirectTo?: string; redirect?: R }) => Promise<R extends false ? any : never>`.

## Section gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, each exit code read from its own redirected log. TYPECHECK=0, LINT=0 (2 warnings, both pre-existing in `lib/board-state.ts`), TEST=0 with 315 passed across 26 files, BUILD=0, e2e EXIT=0 with `Running 112 tests` against `112 passed`.
- [x] The e2e suite ran rather than skipped: `Running 4 tests using 4 workers`, then `[1/4]`–`[4/4]` naming each of the four tests, then `4 passed`. Nothing skipped.
- [x] A real account deleted in a browser is gone, confirmed with a `select` and not with the redirect: `userRowCounts` runs the four `count(*)` queries from the runner's own pool against the Neon dev branch, and `deleting takes the account, its boards and everything on them` asserts `{ user: 0, account: 0, session: 0, members: 0 }` after a real Chromium click.
- [x] A comment that account left on another user's board is still readable by that user, with no name on it. `comment_author_id` is null in the database, and the board owner then opens `/boards/<id>/cards/<id>` and sees the body `Still here` under `Deleted account` — `card-comments.tsx:188` already had that branch.
- [x] The old session cookie does not open `/boards`: the same test navigates there with the stale cookie still in the jar and lands on `/signin`.
- [x] The `cards.column_id` `NO ACTION` constraint did not fire. The board deleted by the cascade held five columns, a card and a comment, and the delete committed — the constraint is resolved at end of statement, as the spec hoped rather than knew.
- [x] Screenshots of `/account` and the danger zone in both themes, at 1440px and 390px, committed under `docs/screenshots/account-deletion/` and embedded in the PR body — including the blocked state at 1440px in both themes.
- [x] Open the PR. Stop. — PR #73.

## Self-review

Checked against `docs/specs/account-deletion.md`:

- Every spec deliverable has a task: `/account` (3), danger zone and copy (3), blocking rule (1 and 2), `lib/actions/account.ts` (2), sign-out after the row is gone (2), testing (2 and 4), documentation (5).
- One deliberate deviation, stated above: the cascade assertion moves from unit to e2e, because unit tests here mock `@/lib/db` and cannot see a foreign key.
- Names are consistent across tasks: `sharedBoardsOwnedBy`, `signInProviders`, `OwnedBoard`, `deleteAccount`, `DeleteAccount`, `userRowCounts`, `commentAuthorId`.
- No task defers work to a later one, and no step says "handle errors appropriately".
