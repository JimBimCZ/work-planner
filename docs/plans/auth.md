# Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in application — Google and GitHub OAuth over database sessions, the first migration in this repository, protection on `/boards/*`, a sign-in screen, and a top bar with an account menu.

**Architecture:** Auth.js v5 with the Drizzle adapter and `session.strategy = 'database'`. `proxy.ts` (Next 16's replacement for `middleware.ts`) checks only that a session cookie exists and redirects to `/signin`; the real check is `auth()` in `app/(app)/layout.tsx`. Every pure decision — which provider owns an address, whether a `callbackUrl` is safe, what colour an avatar is — is extracted into `lib/` and unit-tested away from the framework.

**Tech Stack:** `next-auth@5.0.0-beta.32`, `@auth/drizzle-adapter@1.11.3`, Drizzle ORM, node-postgres, Vitest, Playwright.

**Spec:** `docs/specs/auth.md`

## Global Constraints

- Model policy: implementation and per-task review on Sonnet; the final whole-branch review on Opus. Always pass the model explicitly when dispatching.
- One section, one branch, one PR. Never commit to `main`. Run `pnpm typecheck && pnpm lint && pnpm test` before every push.
- TDD: the failing test is written and *observed failing* before the implementation. Never write implementation first and backfill.
- No `any`, no non-null assertions to silence the compiler, no `@ts-expect-error` without an explanation on the line above.
- Comment only non-obvious decisions. Never narrate what the code says.
- Copy is fixed by `CLAUDE.md`: "Continue with Google", "Continue with GitHub". Sentence case, active voice, no apologies in error text.
- Colour: avatars hash onto 180°–300° only. Nothing else becomes teal; teal is the accent alone.
- The adapter naming contract: tables are `user`, `account`, `session`, and columns are spelled as `@auth/drizzle-adapter` spells them. A rename produces no type error and breaks every adapter query at runtime.

## File Structure

| File | Responsibility |
|---|---|
| `lib/db/schema.ts` | The three adapter tables. Modified from its empty placeholder |
| `lib/db/schema.test.ts` | Pins the table and column names against the adapter's defaults |
| `lib/db/migrations/0000_*.sql` | Generated, never hand-edited |
| `lib/safe-redirect.ts` | `safeCallbackUrl` — rejects anything that is not a relative path |
| `lib/account-conflict.ts` | `conflictingProvider` — which provider already owns an address |
| `lib/avatar.ts` | `avatarHue`, `initials` — the fallback avatar |
| `lib/auth.ts` | Auth.js config; exports `auth`, `handlers`, `signIn`, `signOut` |
| `app/api/auth/[...nextauth]/route.ts` | Re-exports the handlers |
| `proxy.ts` | Cookie-presence redirect on `/boards/:path*`. Imports nothing from `lib/` |
| `app/(auth)/signin/page.tsx` | The two-button sign-in screen and its error states |
| `app/(app)/layout.tsx` | `auth()` gate plus the shell |
| `components/app/top-bar.tsx` | Server component: product name and the menu slot |
| `components/app/account-menu.tsx` | Client component: dropdown, theme control, privacy, sign out |
| `e2e/support/session.ts` | Seeds a user and session row, sets the cookie |
| `e2e/auth.spec.ts` | Redirects, seeded session, sign out, the refusal copy |

---

## Section A — Schema and the first migration

Branch: `feat/auth-schema`

### Task 1: The adapter tables

**Files:**
- Modify: `lib/db/schema.ts` (currently `export {}`)
- Create: `lib/db/schema.test.ts`
- Create: `lib/db/migrations/` (generated)
- Modify: `package.json`

**Interfaces:**
- Consumes: `db` from `lib/db/index.ts`.
- Produces: `users`, `accounts`, `sessions` Drizzle tables. `users.id` is `text`, not `uuid` — sub-project 3's `boards.ownerId` and `board_members.userId` must match that type.

- [x] **Step 1: Install the dependencies, pinned exactly**

```bash
pnpm add next-auth@5.0.0-beta.32 @auth/drizzle-adapter@1.11.3
```

Exact versions, no `^`. `next-auth` has no stable v5 — `latest` is 4.24.15 and v5 ships only on the `beta` tag, so a caret range would drift onto a new beta without warning.

- [x] **Step 2: Write the failing test**

```ts
// lib/db/schema.test.ts
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { accounts, sessions, users } from './schema';

// DrizzleAdapter is called with no schema argument, so it queries its own
// default table definitions. These names are a contract with the adapter, and
// renaming one produces no type error — only a runtime failure at sign-in.
describe('the adapter tables', () => {
  test('are named as the adapter names them', () => {
    expect(getTableConfig(users).name).toBe('user');
    expect(getTableConfig(accounts).name).toBe('account');
    expect(getTableConfig(sessions).name).toBe('session');
  });

  test('the user table carries every column the adapter reads', () => {
    const columns = getTableConfig(users).columns.map((column) => column.name);
    expect(columns.sort()).toEqual(['email', 'emailVerified', 'id', 'image', 'name']);
  });

  test('the session table is keyed on sessionToken', () => {
    const [primary] = getTableConfig(sessions).columns.filter((column) => column.primary);
    expect(primary.name).toBe('sessionToken');
  });

  test('an account is identified by provider and providerAccountId', () => {
    const [compositePk] = getTableConfig(accounts).primaryKeys;
    expect(compositePk.columns.map((column) => column.name)).toEqual([
      'provider',
      'providerAccountId',
    ]);
  });
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run lib/db/schema.test.ts`
Expected: FAIL — `schema.ts` exports nothing, so `users`, `accounts` and `sessions` do not resolve.

- [x] **Step 4: Write the minimal implementation**

```ts
// lib/db/schema.ts
import type { AdapterAccountType } from '@auth/core/adapters';
import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// Names mirror @auth/drizzle-adapter's own defaults exactly. DrizzleAdapter is
// called without a schema argument, so it builds its queries from those
// defaults rather than from these definitions — they have to agree.
export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    index('account_userId_idx').on(account.userId),
  ],
);

export const sessions = pgTable(
  'session',
  {
    sessionToken: text('sessionToken').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (session) => [index('session_userId_idx').on(session.userId)],
);
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm vitest run lib/db/schema.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 6: Generate the migration and read it**

```bash
pnpm db:generate
cat lib/db/migrations/0000_*.sql
```

Expected: `CREATE TABLE "user"`, `"account"`, `"session"`, two foreign keys with `ON DELETE cascade`, the composite primary key on `account`, and both indexes. No `verificationToken`, no `authenticator`. Do not hand-edit the file — if it is wrong, fix `schema.ts` and regenerate.

- [x] **Step 7: Apply it and confirm the tables exist**

```bash
pnpm db:migrate
psql "$DATABASE_URL_UNPOOLED" -c '\dt'
```

Expected: `user`, `account`, `session`, and drizzle's own `__drizzle_migrations`. `.env.local` points at the Neon `dev` branch, which is the correct target for local work; production is migrated by hand at Section D.

- [x] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml lib/db/schema.ts lib/db/schema.test.ts lib/db/migrations
git commit -m "feat: add the Auth.js adapter tables and the first migration"
```

### Task 2: CI migrates before it tests

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the migration from Task 1.
- Produces: a CI job where the database has a schema, which every end-to-end test from Section B onward depends on.

- [x] **Step 1: Add the migrate step and the auth environment**

In `.github/workflows/ci.yml`, extend the existing `env:` block:

```yaml
    env:
      DATABASE_URL: postgres://kanban:kanban@localhost:5432/kanban
      DATABASE_URL_UNPOOLED: postgres://kanban:kanban@localhost:5432/kanban
      NEXT_PUBLIC_SITE_URL: http://localhost:3000
      AUTH_SECRET: ci-not-a-real-secret
      AUTH_TRUST_HOST: 'true'
      AUTH_GOOGLE_ID: ci
      AUTH_GOOGLE_SECRET: ci
      AUTH_GITHUB_ID: ci
      AUTH_GITHUB_SECRET: ci
```

The provider credentials are placeholders. No test completes a real OAuth flow — but Auth.js constructs its providers when `lib/auth.ts` is imported, which the build does, and it will not construct one without an id and secret.

Then add the migrate step immediately after `pnpm install --frozen-lockfile`:

```yaml
      - run: pnpm db:migrate
```

- [x] **Step 2: Correct CLAUDE.md's migration claim**

In the Commands section, replace:

> `db:migrate` uses `DATABASE_URL_UNPOOLED` and is run from CI or by hand — never at application startup.

with:

> `db:migrate` uses `DATABASE_URL_UNPOOLED` and never runs at application startup. CI runs it against its own throwaway Postgres on every pull request, which proves the migration applies to an empty database. **Production is migrated by hand.** Vercel deploys straight from a push to `main`, so CI can race that promotion but cannot gate it; rather than describe a gate that does not exist, run `pnpm db:migrate` against production yourself when a migration lands. The window in which the deployed app expects tables that are not there yet is minutes, and costs nothing until the service has users.

Make the same correction in the Deployment section, which repeats the claim.

- [x] **Step 3: Verify on the pull request, watched rather than assumed**

Push the branch, open the PR, and watch the run:

```bash
gh pr checks --watch
```

Expected: `verify` passes, and its log shows `pnpm db:migrate` applying `0000_*.sql` before the test steps.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "ci: migrate before testing, and correct the production migration claim"
```

### Section A gate

- [x] `pnpm typecheck && pnpm lint && pnpm test` pass, output observed.
- [x] The generated migration creates three tables and no others.
- [x] The CI run on the PR passed, watched rather than assumed.
- [x] Open the PR. Stop. Start Section B in a fresh session.

---

## Section B — Sign-in

Branch: `feat/auth-signin`

### Task 3: The callback-url guard

**Files:**
- Create: `lib/safe-redirect.ts`
- Create: `lib/safe-redirect.test.ts`

**Interfaces:**
- Produces: `safeCallbackUrl(raw: string | null | undefined, fallback?: string): string`. Used by the proxy's redirect target and by the sign-in screen.

- [x] **Step 1: Write the failing test**

```ts
// lib/safe-redirect.test.ts
import { describe, expect, test } from 'vitest';
import { safeCallbackUrl } from './safe-redirect';

describe('safeCallbackUrl', () => {
  test('keeps a relative path', () => {
    expect(safeCallbackUrl('/boards/abc')).toBe('/boards/abc');
  });

  test('keeps a relative path with a query string', () => {
    expect(safeCallbackUrl('/boards?filter=mine')).toBe('/boards?filter=mine');
  });

  test('falls back when there is nothing to redirect to', () => {
    expect(safeCallbackUrl(null)).toBe('/boards');
    expect(safeCallbackUrl(undefined)).toBe('/boards');
    expect(safeCallbackUrl('')).toBe('/boards');
  });

  test('refuses an absolute URL', () => {
    expect(safeCallbackUrl('https://evil.example/boards')).toBe('/boards');
  });

  test('refuses a protocol-relative URL', () => {
    expect(safeCallbackUrl('//evil.example/boards')).toBe('/boards');
  });

  test('refuses a backslash-prefixed path, which browsers treat as protocol-relative', () => {
    expect(safeCallbackUrl('/\\evil.example')).toBe('/boards');
  });

  test('honours an explicit fallback', () => {
    expect(safeCallbackUrl(null, '/')).toBe('/');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run lib/safe-redirect.test.ts`
Expected: FAIL — `Failed to resolve import './safe-redirect'`.

- [x] **Step 3: Write the minimal implementation**

```ts
// lib/safe-redirect.ts
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback = '/boards',
): string {
  if (!raw) return fallback;
  // `//host` and `/\host` are both read as protocol-relative by browsers, so a
  // leading slash alone does not prove the target is our own origin.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  return raw;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run lib/safe-redirect.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add lib/safe-redirect.ts lib/safe-redirect.test.ts
git commit -m "feat: reject callback URLs that leave our origin"
```

### Task 4: The provider-conflict rule

**Files:**
- Create: `lib/account-conflict.ts`
- Create: `lib/account-conflict.test.ts`

**Interfaces:**
- Produces: `conflictingProvider(existing: string[], incoming: string): string | null`. Consumed by the `signIn` callback in Task 5.

- [x] **Step 1: Write the failing test**

```ts
// lib/account-conflict.test.ts
import { describe, expect, test } from 'vitest';
import { conflictingProvider } from './account-conflict';

describe('conflictingProvider', () => {
  test('a brand new address has no conflict', () => {
    expect(conflictingProvider([], 'google')).toBeNull();
  });

  test('signing in again with the same provider is not a conflict', () => {
    expect(conflictingProvider(['google'], 'google')).toBeNull();
  });

  test('a second provider on a known address names the first', () => {
    expect(conflictingProvider(['google'], 'github')).toBe('google');
  });

  test('an address that somehow holds both is not a conflict for either', () => {
    expect(conflictingProvider(['google', 'github'], 'github')).toBeNull();
    expect(conflictingProvider(['github', 'google'], 'google')).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run lib/account-conflict.test.ts`
Expected: FAIL — `Failed to resolve import './account-conflict'`.

- [x] **Step 3: Write the minimal implementation**

```ts
// lib/account-conflict.ts
export function conflictingProvider(existing: string[], incoming: string): string | null {
  if (existing.includes(incoming)) return null;
  return existing[0] ?? null;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run lib/account-conflict.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add lib/account-conflict.ts lib/account-conflict.test.ts
git commit -m "feat: name the provider that already owns an address"
```

### Task 5: Auth.js configuration, the handlers and the proxy

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `proxy.ts`
- Modify: `e2e/routing.spec.ts`

**Interfaces:**
- Consumes: `db`, `users`, `accounts` from `lib/db`, `conflictingProvider` from Task 4.
- Produces: `auth`, `handlers`, `signIn`, `signOut` from `lib/auth.ts`. Section C's layout and the sign-in screen both import from here.

- [x] **Step 1: Write the failing test**

`/boards` is currently public, and `e2e/routing.spec.ts` has two tests that
assume it — "the root redirects to the board list" and "the empty board list
invites rather than apologises". Protecting the route makes both wrong, so they
change in the task that breaks them. Replace **both** with the two below; the
third test in that file, the health-route check, is untouched.

```ts
// e2e/routing.spec.ts — replaces "the empty board list invites rather than apologises"
test('signed out, the board list sends you to sign in', async ({ page }) => {
  await page.goto('/boards');
  await expect(page).toHaveURL('/signin?callbackUrl=%2Fboards');
});

test('signed out, the root lands on sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
});
```

The "Nothing here yet" assertion is not deleted — it returns in Section C, behind a seeded session, which is the only state in which a signed-in board list can be asserted at all.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test:e2e`
Expected: FAIL — `/boards` still renders, so the URL never becomes `/signin`.

- [x] **Step 3: Write the Auth.js configuration**

```ts
// lib/auth.ts
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { conflictingProvider } from '@/lib/account-conflict';
import { db } from '@/lib/db';
import { accounts, users } from '@/lib/db/schema';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // No schema argument: the adapter then builds every table it needs from its
  // own defaults, so verificationToken and authenticator never have to exist.
  adapter: DrizzleAdapter(db),
  session: { strategy: 'database' },
  providers: [Google, GitHub],
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return true;

      // Auth.js's own OAuthAccountNotLinked redirect carries neither the email
      // nor the provider, so the lookup that lets us name one has to be ours.
      const held = await db
        .select({ provider: accounts.provider })
        .from(users)
        .innerJoin(accounts, eq(accounts.userId, users.id))
        .where(eq(users.email, user.email));

      const owner = conflictingProvider(
        held.map((row) => row.provider),
        account.provider,
      );

      return owner ? `/signin?error=account-exists&provider=${owner}` : true;
    },
  },
});
```

`Google` and `GitHub` are passed bare: Auth.js v5 reads `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` from the environment by convention, and `.env.example` already uses exactly those names.

- [x] **Step 4: Write the route handler**

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

- [x] **Step 5: Write the proxy**

```ts
// proxy.ts
import { NextResponse, type NextRequest } from 'next/server';

// Auth.js adds the __Secure- prefix whenever the site URL is HTTPS, so local
// development and every deployment use different names for the same cookie.
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

// Routing, not authorisation. This only saves a wasted render — a stale or
// forged cookie passes here and is rejected by auth() in the (app) layout.
// It imports nothing from lib/ on purpose: Next's proxy docs warn against
// relying on shared modules, and lib/db holds a connection pool.
export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }

  const signin = new URL('/signin', request.url);
  signin.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signin);
}

export const config = { matcher: '/boards/:path*' };
```

- [x] **Step 6: Run the tests and watch them pass**

Run: `pnpm test:e2e`
Expected: PASS. `/boards` now redirects to `/signin?callbackUrl=%2Fboards`, and `/signin` renders Next's 404 for the moment — the redirect is what is under test, and Task 6 builds the screen.

- [x] **Step 7: Commit**

```bash
git add lib/auth.ts app/api/auth proxy.ts e2e/routing.spec.ts
git commit -m "feat: protect the board routes with a session-cookie proxy"
```

### Task 6: The sign-in screen

**Files:**
- Create: `app/(auth)/signin/page.tsx`
- Create: `e2e/signin.spec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `signIn` from `lib/auth.ts`, `safeCallbackUrl` from Task 3.
- Produces: the `/signin` route, including the `?error=account-exists&provider=` state.

- [x] **Step 1: Write the failing test**

```ts
// e2e/signin.spec.ts
import { expect, test } from '@playwright/test';

test('sign-in offers both providers and nothing else', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
});

test('the refusal names the provider that owns the address', async ({ page }) => {
  await page.goto('/signin?error=account-exists&provider=google');
  await expect(
    page.getByText('That email already signs in with Google. Continue with Google instead.'),
  ).toBeVisible();
});

test('any other error explains itself without apologising', async ({ page }) => {
  await page.goto('/signin?error=Configuration');
  await expect(page.getByText('Something went wrong signing you in. Try again.')).toBeVisible();
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/signin.spec.ts`
Expected: FAIL — `/signin` is a 404, so no button is found.

- [x] **Step 3: Write the minimal implementation**

```tsx
// app/(auth)/signin/page.tsx
import { signIn } from '@/lib/auth';
import { safeCallbackUrl } from '@/lib/safe-redirect';

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', github: 'GitHub' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; provider?: string; callbackUrl?: string }>;
}) {
  const { error, provider, callbackUrl } = await searchParams;
  const target = safeCallbackUrl(callbackUrl);
  const owner = provider ? PROVIDER_NAMES[provider] : undefined;

  const message =
    error === 'account-exists' && owner
      ? `That email already signs in with ${owner}. Continue with ${owner} instead.`
      : error
        ? 'Something went wrong signing you in. Try again.'
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-8">
      <h1 className="text-[22px] font-medium tracking-[-0.01em]">Work Planner</h1>

      {message ? (
        <p role="status" className="text-[15px]/6 text-muted">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: target });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2.5 text-[15px] font-medium"
          >
            Continue with Google
          </button>
        </form>

        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: target });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2.5 text-[15px] font-medium"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test:e2e`
Expected: PASS, every spec.

- [x] **Step 5: Correct CLAUDE.md's middleware wording**

Next 16 deprecated `middleware.ts` and renamed it to `proxy.ts`. In the "Auth and permissions" section, replace:

> Middleware protects `/boards/*` and redirects unauthenticated users to `/signin`.

with:

> `proxy.ts` protects `/boards/*` and redirects unauthenticated users to `/signin`. Next 16 renamed the `middleware` convention to `proxy`; it defaults to the Node.js runtime and its `runtime` option cannot be set. It checks only that a session cookie is present and imports nothing from `lib/`, because Next's own documentation warns that this file may be deployed away from the app runtime and must not rely on shared modules — `lib/db` holds a connection pool.

Update the following line — "**Every server action and route handler independently re-checks permission.** Middleware is routing, not authorisation." — to say "The proxy is routing, not authorisation." Add `(auth)/signin/`, `proxy.ts` and `lib/auth.ts` to the Layout tree.

- [x] **Step 6: Commit**

```bash
git add "app/(auth)" e2e/signin.spec.ts CLAUDE.md
git commit -m "feat: add the sign-in screen and its refusal copy"
```

### Section B gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [x] `/boards` redirects to `/signin` with a `callbackUrl`, and `/signin` renders both buttons.
- [x] A real sign-in is **not** verifiable yet — the OAuth clients do not exist until Section D. Do not claim it works.
- [x] Open the PR. Stop. Start Section C in a fresh session.

---

## Section C — The shell and the account menu

Branch: `feat/auth-shell`

### Task 7: The fallback avatar

**Files:**
- Create: `lib/avatar.ts`
- Create: `lib/avatar.test.ts`

**Interfaces:**
- Produces: `avatarHue(userId: string): number` and `initials(name: string | null, email: string): string`. Consumed by the account menu in Task 9.

- [x] **Step 1: Write the failing test**

```ts
// lib/avatar.test.ts
import { describe, expect, test } from 'vitest';
import { avatarHue, initials } from './avatar';

describe('avatarHue', () => {
  test('is stable for the same id', () => {
    expect(avatarHue('abc')).toBe(avatarHue('abc'));
  });

  test('never leaves the cool half of the wheel', () => {
    for (let i = 0; i < 500; i += 1) {
      const hue = avatarHue(`user-${i}`);
      expect(hue).toBeGreaterThanOrEqual(180);
      expect(hue).toBeLessThanOrEqual(300);
    }
  });

  test('spreads ids across the range rather than clustering on one hue', () => {
    const hues = new Set(Array.from({ length: 50 }, (_, i) => avatarHue(`user-${i}`)));
    expect(hues.size).toBeGreaterThan(10);
  });
});

describe('initials', () => {
  test('uses both parts of a full name', () => {
    expect(initials('Vit Busek', 'v@example.test')).toBe('VB');
  });

  test('uses one letter for a single name', () => {
    expect(initials('Vit', 'v@example.test')).toBe('V');
  });

  test('falls back to the email when there is no name', () => {
    expect(initials(null, 'vit@example.test')).toBe('V');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run lib/avatar.test.ts`
Expected: FAIL — `Failed to resolve import './avatar'`.

- [x] **Step 3: Write the minimal implementation**

```ts
// lib/avatar.ts
const HUE_START = 180;
const HUE_END = 300;

// Cool half only. A warm avatar would compete with the due-date signal, which is
// the one warm thing in the interface, and the range starts above the accent
// teal so an avatar never impersonates an active state.
export function avatarHue(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 100_000;
  }
  return HUE_START + (hash % (HUE_END - HUE_START + 1));
}

export function initials(name: string | null, email: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return email.slice(0, 1).toUpperCase();
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run lib/avatar.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add lib/avatar.ts lib/avatar.test.ts
git commit -m "feat: derive a cool-half avatar colour from the user id"
```

### Task 8: The `(app)` layout and the seeded-session harness

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `components/app/top-bar.tsx`
- Create: `e2e/support/session.ts`
- Create: `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `auth` from `lib/auth.ts`.
- Produces: `seedSession(context)` and `removeSeededUser(userId)` for every later sub-project's end-to-end tests. `TopBar` takes `{ name, email, image, userId }`.

- [x] **Step 1: Write the seeded-session helper**

Not a test itself — the harness the tests need. Real OAuth cannot run in CI, and a database session is a row plus a cookie, so a signed-in browser can be constructed directly.

```ts
// e2e/support/session.ts
import type { BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type SeededSession = { userId: string; email: string };

export async function seedSession(context: BrowserContext): Promise<SeededSession> {
  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const email = `${userId}@example.test`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // "user" is a reserved word, and the adapter's columns are camelCase, so
  // every identifier here has to be quoted.
  await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
    userId,
    'Test User',
    email,
  ]);
  await pool.query(
    'insert into "session" ("sessionToken", "userId", expires) values ($1, $2, $3)',
    [sessionToken, userId, expires],
  );

  // Playwright's baseURL is HTTP, so the cookie carries no __Secure- prefix.
  await context.addCookies([
    { name: 'authjs.session-token', value: sessionToken, url: 'http://localhost:3000' },
  ]);

  return { userId, email };
}

export async function removeSeededUser(userId: string): Promise<void> {
  // The session row goes with it: both foreign keys cascade.
  await pool.query('delete from "user" where id = $1', [userId]);
}

export async function closeSeedPool(): Promise<void> {
  await pool.end();
}
```

- [x] **Step 2: Write the failing test**

```ts
// e2e/shell.spec.ts
import { expect, test } from '@playwright/test';
import { closeSeedPool, removeSeededUser, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a signed-in session sees the board list and the top bar', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/boards');
    await expect(page.getByText('Nothing here yet')).toBeVisible();
    await expect(page.getByRole('banner').getByText('Work Planner')).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});
```

This restores the "Nothing here yet" assertion that Section B moved out of `routing.spec.ts`, now in the only state where a signed-in board list can be asserted.

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/shell.spec.ts`
Expected: FAIL — there is no `banner` landmark, because no layout renders one.

- [x] **Step 4: Write the layout and the top bar**

```tsx
// app/(app)/layout.tsx
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/app/top-bar';
import { auth } from '@/lib/auth';

// The real authorisation boundary. proxy.ts only spares us a wasted render.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        userId={session.user.id ?? ''}
        name={session.user.name ?? null}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

```tsx
// components/app/top-bar.tsx
import { AccountMenu } from '@/components/app/account-menu';

// Deliberately thin: sub-project 4 adds the board title and "New card" here
// rather than introducing a second header.
export function TopBar({
  userId,
  name,
  email,
  image,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
      <span className="text-[15px] font-medium">Work Planner</span>
      <AccountMenu userId={userId} name={name} email={email} image={image} />
    </header>
  );
}
```

`AccountMenu` does not exist until Task 9. Create it as a temporary stub so this task compiles and its test passes on its own:

```tsx
// components/app/account-menu.tsx — replaced entirely in Task 9
export function AccountMenu({ email }: { userId: string; name: string | null; email: string; image: string | null }) {
  return <span className="text-xs text-muted">{email}</span>;
}
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test:e2e`
Expected: PASS, every spec. The seeded-session test needs a migrated database — locally that is the Neon `dev` branch from Section A Step 7.

- [x] **Step 6: Commit**

```bash
git add "app/(app)/layout.tsx" components/app e2e/support e2e/shell.spec.ts
git commit -m "feat: gate the app routes behind a session and add the top bar"
```

### Task 9: The account menu

**Files:**
- Modify: `components/app/account-menu.tsx` (replaces the Task 8 stub)
- Create: `components/ui/dropdown-menu.tsx` (generated by the shadcn CLI)
- Create: `lib/actions/session.ts`
- Modify: `e2e/shell.spec.ts`
- Modify: `next.config.ts`, `docker-compose.yml`, `Dockerfile`
- Modify: `CLAUDE.md`, `docs/specs/foundation.md`

**Interfaces:**
- Consumes: `avatarHue`, `initials` from Task 7; `signOut` from `lib/auth.ts`.
- Produces: `signOutAction()` in `lib/actions/session.ts`, the first module in the `lib/actions/` directory the layout section of `CLAUDE.md` describes.

- [x] **Step 1: Add the dropdown primitive**

```bash
pnpm dlx shadcn@latest add dropdown-menu
```

This writes `components/ui/dropdown-menu.tsx`. Re-tokenise it in the same pass, per the standing rule that untouched shadcn is recognisable: the content surface uses `bg-surface`, `border-line` and `rounded-[var(--radius-control)]`, and the focus ring uses the accent.

- [x] **Step 2: Write the failing test**

Add to `e2e/shell.spec.ts`:

```ts
test('the account menu carries the email, the privacy link and sign out', async ({
  page,
  context,
}) => {
  const { userId, email } = await seedSession(context);
  try {
    await page.goto('/boards');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('signing out returns you to sign in', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/boards');
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin/);
  } finally {
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/shell.spec.ts`
Expected: FAIL — there is no button named "Account"; the stub renders plain text.

- [x] **Step 4: Write the sign-out action**

```ts
// lib/actions/session.ts
'use server';

import { signOut } from '@/lib/auth';

export async function signOutAction() {
  await signOut({ redirectTo: '/signin' });
}
```

- [x] **Step 5: Write the account menu**

```tsx
// components/app/account-menu.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/actions/session';
import { avatarHue, initials } from '@/lib/avatar';

type Preference = 'system' | 'light' | 'dark';

// The pre-paint script owns data-theme and reads localStorage, so the stored
// preference is the source of truth here — data-theme cannot distinguish "the
// user chose light" from "the system is light".
let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners = [...listeners, onChange];
  return () => {
    listeners = listeners.filter((listener) => listener !== onChange);
  };
}

function getSnapshot(): Preference {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function getServerSnapshot(): Preference {
  return 'system';
}

function applyPreference(next: Preference) {
  if (next === 'system') {
    // Clearing the key is what makes the pre-paint script's matchMedia fallback
    // reachable again; a stored value would pin the choice forever.
    localStorage.removeItem('theme');
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)')
      .matches
      ? 'dark'
      : 'light';
  } else {
    localStorage.setItem('theme', next);
    document.documentElement.dataset.theme = next;
  }
  listeners.forEach((listener) => listener());
}

export function AccountMenu({
  userId,
  name,
  email,
  image,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex size-7 items-center justify-center overflow-hidden rounded-full text-xs font-medium"
        style={image ? undefined : { backgroundColor: `hsl(${avatarHue(userId)} 45% 32%)` }}
      >
        {image ? (
          <Image src={image} alt="" width={28} height={28} />
        ) : (
          <span className="text-white">{initials(name, email)}</span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <p className="px-2 py-1.5 text-xs text-muted">{email}</p>
        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => applyPreference(value as Preference)}
        >
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/privacy">Privacy</Link>
        </DropdownMenuItem>
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Choosing "System" resolves the theme once, at the moment of the click. Changing the operating system's theme while the page is open takes effect on the next load, which is exactly how the pre-paint script already behaves — one behaviour, not two.

- [x] **Step 6: Allow the two avatar hosts**

```ts
// next.config.ts — inside the existing config object
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
```

Next 16 removed `images.domains`; `remotePatterns` is the supported form. A plain `img` would trip `@next/next/no-img-element` in a lint run that has to stay clean.

- [x] **Step 7: Keep the container building and running**

`next build` must never depend on secrets, and Auth.js constructs its providers when `lib/auth.ts` is imported. Add to the **build stage only** of the `Dockerfile`, beside the existing `DOCKER_BUILD=1`:

```dockerfile
ENV AUTH_SECRET=build-only \
    AUTH_GOOGLE_ID=build-only \
    AUTH_GOOGLE_SECRET=build-only \
    AUTH_GITHUB_ID=build-only \
    AUTH_GITHUB_SECRET=build-only
```

And to the `app` service's `environment:` in `docker-compose.yml`:

```yaml
      AUTH_SECRET: local-development-only
      AUTH_TRUST_HOST: 'true'
```

Signing in against the container needs real OAuth credentials with a `localhost:3000` callback; without them the container still builds, still serves, and still reports healthy, which is what the healthcheck asserts.

- [x] **Step 8: Run the tests and watch them pass**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
docker compose up --build -d
docker inspect -f '{{.State.Health.Status}}' work-planner-app-1
docker compose down
```

Expected: all suites pass; the container reports `healthy`; the stack is then shut down, per the rule that anything opened gets closed.

- [x] **Step 9: Record the resolved decision**

In `CLAUDE.md`'s "Open decisions", remove the theme-toggle entry and note in the Design section that the account menu offers System / Light / Dark, with "System" clearing the stored preference. Make the same correction to the "Open decisions carried forward" list in `docs/specs/foundation.md`, which named sub-project 2 as where this falls due.

- [x] **Step 10: Commit**

```bash
git add components lib/actions next.config.ts docker-compose.yml Dockerfile e2e/shell.spec.ts CLAUDE.md docs/specs/foundation.md
git commit -m "feat: add the account menu with a System/Light/Dark control"
```

### Section C gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [x] `docker compose up --build` reaches `healthy`, and the stack is shut down afterwards.
- [x] Screenshots of the top bar and the open account menu, in both themes, attached to the PR. Section C of the Foundation plan shipped without its screenshots and the gate has stayed unticked ever since — do not repeat it.
- [x] Open the PR. Stop. Start Section D in a fresh session.

---

## Section D — OAuth clients and the first real sign-in

Branch: none. This section is a handoff, and the only part of this plan that cannot be verified without the author.

### Task 10: Credentials, migration, and proof

**Files:** none.

**Interfaces:**
- Consumes: everything merged from Sections A through C.
- Produces: a working sign-in, and the `users`/`accounts`/`sessions` tables in production.

- [x] **Step 1: Create the OAuth clients (author)** — **done 2026-08-30.**

Google Cloud Console and GitHub Developer Settings. Authorised redirect URIs for each:

```
http://localhost:3000/api/auth/callback/google
https://work-planner-seven.vercel.app/api/auth/callback/google
https://<stable-preview-alias>/api/auth/callback/google
```

and the same three with `/github`. Preview deployments get a fresh URL per commit, so sign-in only works on previews through a stable alias — `CLAUDE.md` already records this.

- [x] **Step 2: Set the environment variables** — **done 2026-08-30, with one gap recorded below.**

`AUTH_SECRET` (generate with `openssl rand -base64 32`), `AUTH_TRUST_HOST=true`, and the four provider variables, in all three Vercel environments. Then `pnpm env:pull development` to refresh `.env.local`.

Observed by `vercel env ls`, names only: Production and Preview each hold all six
of `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. **Development holds only four** —
`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are absent, so "all three
environments" is not yet true.

Nothing is broken by this today: both GitHub values are in the author's local
`.env`, which Next falls back to when `.env.local` lacks them. It is a trap
rather than a fault — `pnpm env:pull development` overwrites `.env.local` from
Vercel, after which Development's Google credentials would outrank `.env`'s
while GitHub silently fell through to the older file. Two values that disagree
and no error is the same failure shape as the drift #23 fixed.

**Left as it is, by the author's decision, 2026-08-30.** Local GitHub sign-in
works from `.env`, so this buys nothing today. Recorded so the gap reads as a
known choice rather than an oversight — and so that whoever runs
`pnpm env:pull development` and then cannot sign in with GitHub locally has
this note to find.

- [x] **Step 3: Migrate production, by hand** — **done 2026-08-30.**

```bash
DATABASE_URL_UNPOOLED="$(npx neonctl@4 connection-string main --project-id <id>)" pnpm db:migrate
```

Expected: `user`, `account`, `session`. Do this **before** announcing the deploy is usable — until it runs, every sign-in on production fails on a missing table.

Observed, by catalog query rather than `psql`, which is not installed on the author's machine:

```
drizzle.__drizzle_migrations
public.account
public.session
public.user
```

Three tables and no others, which is the gate's third item. Note the command needs the shell-precedence fix from PR #23 — before it, the same line migrated the `.env.local` database and still printed `migrations applied successfully!`. The `neon_auth` schema is excluded from the query deliberately; it is the inert leftover recorded in `CLAUDE.md`.

- [x] **Step 4: Sign in for real, both providers** — **done 2026-08-30, except the row counts.**

In a browser against the deployed site: sign in with Google, confirm the landing on `/boards` and the account menu showing the right email; sign out; sign in with GitHub using a *different* address; then attempt GitHub with the *Google* address and confirm the refusal names Google.

```sql
select id, email from "user";
select "userId", provider from "account";
```

Expected: one row per person, one account row per provider, and no second user created by the refused attempt.

Observed by the author against production, 2026-08-30. I observed none of it
myself: production database access is blocked in this session, and the OAuth
round-trip needs a browser and real credentials. This records their report.

- Google and GitHub sign-ins each reach `/boards`, on two different addresses.
- The cross-provider refusal renders the wording in
  `app/(auth)/signin/page.tsx:17` — "That email already signs in with Google.
  Continue with Google instead." — naming the provider that owns the address.
  This is the first time the database lookup in `lib/auth.ts:24-34` has run
  against a real OAuth callback; `signin.spec.ts:9` reaches the same screen by
  loading the error URL directly, which exercises the page and not the decision.
- Signed out, `/boards` redirects to `/signin`; the account menu carries the
  right email and signs out cleanly. These three are also covered by
  `routing.spec.ts` and `shell.spec.ts`, against a seeded session.

**Not verified: the two queries above.** The author deferred them to the
database logs. So the refusal is known to *render*, but that it wrote nothing —
no second `user` row from the refused attempt, one `account` row per provider —
is still unchecked. That is the assertion this step's SQL exists to make, and it
remains open.

- [x] **Step 5: Record the outcome** — **done 2026-08-30.**

Tick this plan's boxes and the spec's verification list, and report what was observed rather than what was expected.

### Section D gate

- [x] A real Google sign-in and a real GitHub sign-in both reach `/boards`, observed in a browser.
- [x] The cross-provider refusal names the other provider, observed rather than inferred.
- [x] Production holds the three tables and no others.

---

## Definition of done

Auth is complete when every checkbox above is ticked and:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass on `main`.
- `docker compose up --build` reaches a healthy app container.
- Both providers sign in on the deployed site, and the refusal names the provider that owns the address.

Observed 2026-08-30, on `docs/auth-section-d-close` at parity with `main`:

```
$ pnpm typecheck   next typegen && tsc --noEmit      exit 0
$ pnpm lint        eslint                            exit 0
$ pnpm test        Test Files 8 passed (8)  Tests 44 passed (44)
$ pnpm test:e2e    13 passed (18.1s)                 exit 0
$ docker compose up --build
  work-planner-app-1        Up (healthy)     GET /api/health -> 200
  work-planner-postgres-1   Up (healthy)
```

The third bullet is the author's observation, not mine — see Step 4.

Re-observed 2026-08-30 on `main` at `f8750ea`, after the account-switch fix
landed (#26, #27):

```
$ pnpm typecheck   next typegen && tsc --noEmit      exit 0
$ pnpm lint        eslint                            exit 0
$ pnpm test        Test Files 8 passed (8)  Tests 46 passed (46)
$ pnpm test:e2e    16 passed (17.7s)                 exit 0
```

Docker was not re-run for this pass; the healthy-container line above stands
from the run that produced it.

**Every section is merged, and the dead end is closed in code.** Section D's
verification had turned one up in the refusal itself: a person refused on one
provider had no way to retry with a different account, because the provider had
already auto-authenticated the remembered session. Rather than carry it, #26
fixed it — the refusal redirect carries the attempted provider, and the retry
re-runs that provider with `prompt=select_account`, which both Google and GitHub
document. The spec's open decision is marked resolved.

**One check remains, and it is the author's.** That the account picker actually
appears has not been observed: showing it needs a browser already signed in to
the provider and real credentials, so #26 could only prove the parameter reaches
both providers' authorize endpoints. Confirm it on the deployed site, then this
plan is done.

Carried forward to sub-project 3, and not to be decided while executing this plan: whether `assigneeId` and `wipLimit` are real requirements, and how `board_members` keys off `users.id` — which is `text`, not `uuid`.
