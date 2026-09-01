# Member management and invites — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A board owner invites people by email, the invitee accepts from `/boards`, and roles, removal, leaving and ownership transfer all work — which also unblocks `/account`'s delete.

**Architecture:** A `board_invites` table keyed on `(boardId, email)` holds an invite only while it is pending; accept, decline, revoke and a 30-day expiry all end with the row gone. `lib/actions/members.ts` holds every write, each following the house action shape. Three new Pusher events keep an open board honest about a membership that changed under it.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript strict, drizzle-orm 0.45.2 + drizzle-kit, Zod 4.5.4, Postgres (Neon `dev` branch locally), Vitest, Playwright, Pusher Channels, Tailwind v4.

**Spec:** `docs/specs/member-management.md` — read it before Task A1 and keep it open; this plan argues from it.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Verified API surfaces.** `check(name, sql)` and table-level `unique(name).on(...)` exist in drizzle-orm 0.45.2 (`node_modules/drizzle-orm/pg-core/`). `onConflictDoUpdate({ target, set })` and `onConflictDoNothing()` exist on the pg insert builder. Zod is 4.5.4, where **`z.email()` is the top-level validator** — `z.string().email()` is deprecated. Do not substitute remembered signatures for these.
- **Action shape, in this order:** `auth()` → `safeParse` → `assertBoardAccess` → transaction → publish after the transaction commits → return a discriminated `{ ok }` object. Never throw for an expected failure.
- **Never trust `boardId` or `userId` from the client for authorisation.** Derive the user from the session, then verify the board.
- **`lib/permissions.ts` and `lib/events.ts` are server-only.** A `'use client'` file importing any *value* from either pulls the pg pool or the Pusher SDK into the browser bundle, and only `pnpm build` catches it — typecheck, lint and test all pass. `import type` is erased and is safe.
- **`INVITE_TTL_DAYS = 30`**, defined once in `lib/members.ts`. Every query that lists or resolves an invite carries the cutoff.
- **An invite can never carry `owner`.** Zod parses `z.enum(['member', 'viewer'])`, and a check constraint refuses it in the database.
- **Copy:** active voice, sentence case, no filler. Errors say what happened and what to do, and never apologise.
- **Colour:** warm (`--time-over`) only on destructive controls inside the dialog. Nothing warm comes to rest on the board.
- **No `any`, no non-null assertions, no `@ts-expect-error` without an explanation on the line above. No unnecessary comments** — comment a non-obvious decision, never what the code plainly says.
- **Before claiming any task done:** `pnpm typecheck && pnpm lint && pnpm test`, each exit code read from its own redirected log. A pipe reports the exit code of `tail`, not of the test run:
  ```bash
  pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
  ```
- **Commit per task**, imperative subject, each commit leaving the app working. Tick this plan's checkboxes in the same PR that does the work.
- **Implementation and per-task review run on Sonnet**; the final whole-branch review runs on Opus.

## File structure

| File | Responsibility |
|---|---|
| `lib/db/schema.ts` | Add `boardInvites`, its relations, and the `user` relation `board_members` is missing |
| `lib/db/migrations/0004_*.sql` | Generated, never hand-edited |
| `lib/members.ts` | Reads: members, pending invites, a user's invites, one invite by id. Owns `INVITE_TTL_DAYS` |
| `lib/members.test.ts` | Proves every read carries the TTL cutoff |
| `lib/actions/members.ts` | All eight writes |
| `lib/actions/members.test.ts` | Guard order, error codes, rows written, publish-after-commit |
| `components/board/members-dialog.tsx` | `'use client'` — the dialog and its controls |
| `components/board/members-button.tsx` | Server component: reads, strips emails for non-owners, renders the dialog |
| `components/boards/invitations.tsx` | `'use client'` — accept and decline on `/boards` |
| `e2e/schema.spec.ts` | The two database invariants |
| `e2e/members.spec.ts` | The flows, grown across sections B, C and D |

---

# Section A — schema and actions

No UI, no events. Branch `feat/members-actions` from `main`.

### Task A1: The `board_invites` table

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0004_*.sql` (generated)
- Test: `e2e/schema.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `boardInvites` table with columns `id`, `boardId`, `email`, `role`, `invitedById`, `createdAt`; `boardInvitesRelations` exposing `board` and `invitedBy`; `boardMembersRelations` gaining `user`.

- [x] **Step 1: Add the table and the relations**

In `lib/db/schema.ts`, extend the existing imports — `check` and `unique` come from `drizzle-orm/pg-core`, `sql` from `drizzle-orm` — then add after `boardMembers`:

```ts
export const boardInvites = pgTable(
  'board_invites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: boardRole('role').notNull(),
    invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('board_invites_board_id_email_key').on(t.boardId, t.email),
    index('board_invites_email_idx').on(t.email),
    // The one-owner invariant, in the database rather than only in Zod:
    // ownership moves through transferOwnership and nowhere else.
    check('board_invites_role_not_owner', sql`${t.role} <> 'owner'`),
  ],
);
```

Then the relations. `boardMembers` has no `user` relation today and `listMembers` needs one:

```ts
export const boardInvitesRelations = relations(boardInvites, ({ one }) => ({
  board: one(boards, { fields: [boardInvites.boardId], references: [boards.id] }),
  invitedBy: one(users, { fields: [boardInvites.invitedById], references: [users.id] }),
}));
```

Add `user: one(users, { fields: [boardMembers.userId], references: [users.id] })` to the existing `boardMembersRelations`, and `invites: many(boardInvites)` to `boardsRelations`.

- [x] **Step 2: Generate and apply the migration**

```bash
pnpm db:generate > /tmp/generate.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/generate.log
pnpm db:migrate  > /tmp/migrate.log  2>&1; echo "EXIT=$?"; tail -5 /tmp/migrate.log
```

Expected: a new `lib/db/migrations/0004_*.sql` creating `board_invites` with the unique constraint, the index and the check. **Read the SQL file** — confirm the check constraint is in it; a missing check is silent until Task A3's test. Never hand-edit it.

`db:migrate` targets the Neon `dev` branch through `.env.local`. Confirm with `\dt`-style proof rather than the success line:

```bash
psql "$DATABASE_URL_UNPOOLED" -c '\d board_invites'
```

- [x] **Step 3: Write the failing invariant tests**

Append to `e2e/schema.spec.ts` (it already imports `Pool`, `seedSession`, `seedBoard`, `removeSeededUser`):

```ts
test('an invite can never carry the owner role', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Guarded');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await expect(
      pool.query('insert into board_invites (id, board_id, email, role) values ($1, $2, $3, $4)', [
        crypto.randomUUID(),
        boardId,
        'someone@example.test',
        'owner',
      ]),
    ).rejects.toThrow(/board_invites_role_not_owner/);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// This rejection is why inviteMember upserts. An expired invite is filtered out
// of every read but still holds the pair, so a plain insert would fail against a
// row nobody can see.
test('a board cannot hold two pending invites for one address', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Once only');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const insert = () =>
    pool.query('insert into board_invites (id, board_id, email, role) values ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      boardId,
      'twice@example.test',
      'member',
    ]);
  try {
    await insert();
    await expect(insert()).rejects.toThrow(/board_invites_board_id_email_key/);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 4: Run them**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

Expected: PASS, and the count that ran equals the count collected. If the check-constraint test fails, the migration in Step 2 did not carry the constraint — fix the schema and regenerate rather than patching SQL.

- [x] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations e2e/schema.spec.ts
git commit -m "feat: add board_invites, with the one-owner rule in the database"
```

### Task A2: Reads, and the thirty-day cutoff

**Files:**
- Create: `lib/members.ts`
- Test: `lib/members.test.ts`

**Interfaces:**
- Consumes: `boardInvites` and the relations from A1.
- Produces:
  ```ts
  export const INVITE_TTL_DAYS = 30;
  export function inviteCutoff(): Date;
  export type BoardMemberRow = { userId: string; name: string | null; email: string; image: string | null; role: BoardRole };
  export function listMembers(boardId: string): Promise<BoardMemberRow[]>;
  export type PendingInvite = { id: string; email: string; role: BoardRole; createdAt: Date };
  export function listPendingInvites(boardId: string): Promise<PendingInvite[]>;
  export type UserInvite = { id: string; boardId: string; boardName: string; role: BoardRole; invitedByName: string | null };
  export function listInvitesForUser(email: string): Promise<UserInvite[]>;
  export type FoundInvite = { id: string; boardId: string; email: string; role: BoardRole };
  export function findPendingInvite(inviteId: string): Promise<FoundInvite | null>;
  ```

- [x] **Step 1: Write the failing test**

Create `lib/members.test.ts`. It mocks `db.query` and inspects the config each read passes, the way `lib/boards.test.ts` does — the point is that no read may quietly drop the cutoff.

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Clause = unknown[];
type Helpers = {
  and: (...parts: Clause[]) => Clause;
  eq: (column: string, value: unknown) => Clause;
  gt: (column: string, value: unknown) => Clause;
};
type Config = {
  where: (table: Record<string, string>, helpers: Helpers) => Clause;
  columns?: Record<string, boolean>;
};

let captured: Config | null = null;
let rows: unknown[] = [];
const findMany = vi.fn(async (config: Config) => {
  captured = config;
  return rows;
});
const findFirst = vi.fn(async (config: Config) => {
  captured = config;
  return rows[0];
});

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      boardMembers: { findMany: (c: Config) => findMany(c) },
      boardInvites: { findMany: (c: Config) => findMany(c), findFirst: (c: Config) => findFirst(c) },
    },
  },
}));

const { INVITE_TTL_DAYS, listInvitesForUser, listPendingInvites, findPendingInvite } =
  await import('./members');

const table = { boardId: 'boardId', email: 'email', createdAt: 'createdAt', id: 'id' };
const helpers: Helpers = {
  and: (...parts) => ['and', ...parts],
  eq: (column, value) => ['eq', column, value],
  gt: (column, value) => ['gt', column, value],
};

// The cutoff is a Date built at call time, so the assertion is on the column and
// on the magnitude, not on an exact instant.
function cutoffFrom(clause: Clause): Date | null {
  const flat = JSON.stringify(clause);
  void flat;
  const found = (clause as unknown[]).find(
    (part) => Array.isArray(part) && part[0] === 'gt' && part[1] === 'createdAt',
  ) as Clause | undefined;
  return found ? (found[2] as Date) : null;
}

beforeEach(() => {
  captured = null;
  rows = [];
  findMany.mockClear();
  findFirst.mockClear();
});

describe('the invite reads', () => {
  test('exports a thirty-day window', () => {
    expect(INVITE_TTL_DAYS).toBe(30);
  });

  test.each([
    ['listPendingInvites', () => listPendingInvites('board-1')],
    ['listInvitesForUser', () => listInvitesForUser('me@example.test')],
    ['findPendingInvite', () => findPendingInvite('invite-1')],
  ])('%s refuses invites older than the window', async (_name, call) => {
    await call();
    expect(captured).not.toBeNull();
    const cutoff = cutoffFrom(captured!.where(table, helpers));
    expect(cutoff).toBeInstanceOf(Date);
    const days = (Date.now() - (cutoff as Date).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
  });

  test('listInvitesForUser matches the address in lower case', async () => {
    await listInvitesForUser('  ME@Example.test ');
    const clause = JSON.stringify(captured!.where(table, helpers));
    expect(clause).toContain('me@example.test');
  });
});
```

The `captured!` non-null assertions are the one place this plan permits them: the line above each is an `expect(...).not.toBeNull()`, and a test that has already failed does not continue.

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: FAIL — `Failed to resolve import "./members"`.

- [x] **Step 3: Write the reads**

Create `lib/members.ts`:

```ts
import { db } from '@/lib/db';
import type { BoardRole } from '@/lib/permissions';

export const INVITE_TTL_DAYS = 30;

// Expiry is filtered at read time, not purged: Deployment forbids a scheduled
// job, and an expired row still holds its (board_id, email) pair — which is
// what makes inviteMember an upsert rather than an insert.
export function inviteCutoff(): Date {
  return new Date(Date.now() - INVITE_TTL_DAYS * 86_400_000);
}

export type BoardMemberRow = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: BoardRole;
};

export async function listMembers(boardId: string): Promise<BoardMemberRow[]> {
  const rows = await db.query.boardMembers.findMany({
    where: (member, { eq }) => eq(member.boardId, boardId),
    columns: { userId: true, role: true },
    with: { user: { columns: { name: true, email: true, image: true } } },
  });

  return rows
    .map((row) => ({
      userId: row.userId,
      role: row.role,
      name: row.user.name,
      email: row.user.email ?? '',
      image: row.user.image,
    }))
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));
}

export type PendingInvite = { id: string; email: string; role: BoardRole; createdAt: Date };

export async function listPendingInvites(boardId: string): Promise<PendingInvite[]> {
  return db.query.boardInvites.findMany({
    where: (invite, { and, eq, gt }) =>
      and(eq(invite.boardId, boardId), gt(invite.createdAt, inviteCutoff())),
    columns: { id: true, email: true, role: true, createdAt: true },
    orderBy: (invite, { asc }) => [asc(invite.createdAt)],
  });
}

export type UserInvite = {
  id: string;
  boardId: string;
  boardName: string;
  role: BoardRole;
  invitedByName: string | null;
};

export async function listInvitesForUser(email: string): Promise<UserInvite[]> {
  const address = email.trim().toLowerCase();
  const rows = await db.query.boardInvites.findMany({
    where: (invite, { and, eq, gt }) =>
      and(eq(invite.email, address), gt(invite.createdAt, inviteCutoff())),
    columns: { id: true, boardId: true, role: true },
    with: { board: { columns: { name: true } }, invitedBy: { columns: { name: true } } },
    orderBy: (invite, { asc }) => [asc(invite.createdAt)],
  });

  return rows.map((row) => ({
    id: row.id,
    boardId: row.boardId,
    boardName: row.board.name,
    role: row.role,
    invitedByName: row.invitedBy?.name ?? null,
  }));
}

export type FoundInvite = { id: string; boardId: string; email: string; role: BoardRole };

export async function findPendingInvite(inviteId: string): Promise<FoundInvite | null> {
  const invite = await db.query.boardInvites.findFirst({
    where: (row, { and, eq, gt }) =>
      and(eq(row.id, inviteId), gt(row.createdAt, inviteCutoff())),
    columns: { id: true, boardId: true, email: true, role: true },
  });
  return invite ?? null;
}
```

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add lib/members.ts lib/members.test.ts
git commit -m "feat: read members and pending invites, expiring at thirty days"
```

### Task A3: Invite and revoke

**Files:**
- Create: `lib/actions/members.ts`
- Test: `lib/actions/members.test.ts`

**Interfaces:**
- Consumes: `findPendingInvite` from A2 (used by A4, not here); `assertBoardAccess`, `boardAccessResult` from `lib/permissions.ts`.
- Produces:
  ```ts
  inviteMember({ boardId: string, email: string, role: 'member' | 'viewer' })
    -> { ok: true } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_MEMBER' }
  revokeInvite({ inviteId: string })
    -> { ok: true } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' }
  ```
  Later tasks add to this same file and this same test file.

- [x] **Step 1: Write the failing test**

Create `lib/actions/members.test.ts`. This preamble is the harness every later task in Section A reuses — write it once, here.

```ts
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

const { inviteMember, revokeInvite } = await import('./members');

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
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: FAIL — `Failed to resolve import "./members"`.

- [x] **Step 3: Write the two actions**

Create `lib/actions/members.ts`:

```ts
'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { boardInvites } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

const id = z.string().min(1);
const assignableRole = z.enum(['member', 'viewer']);

const inviteSchema = z.object({ boardId: id, email: z.email(), role: assignableRole });
const inviteRef = z.object({ inviteId: id });

export async function inviteMember(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, role } = parsed.data;
  const invitedById = session.user.id;

  try {
    await assertBoardAccess(invitedById, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  const email = parsed.data.email.trim().toLowerCase();

  // lower() on both sides: users.email is stored as the provider sent it and its
  // unique index is case-sensitive. ilike would say this in one operator but
  // treats _ and % as wildcards, and both are legal in an address.
  const existing = await db.query.users.findFirst({
    where: (user, { sql }) => sql`lower(${user.email}) = ${email}`,
    columns: { id: true },
  });

  if (existing) {
    const membership = await db.query.boardMembers.findFirst({
      where: (member, { and: both, eq: is }) =>
        both(is(member.boardId, boardId), is(member.userId, existing.id)),
      columns: { userId: true },
    });
    if (membership) return { ok: false, error: 'ALREADY_MEMBER' } as const;
  }

  // Upsert, not insert: an expired invite is filtered out of every read but
  // still holds the (board_id, email) pair, so an insert would collide with a
  // row nobody can see. This also renews the clock and lets the owner correct
  // a pending invite's role.
  await db
    .insert(boardInvites)
    .values({ boardId, email, role, invitedById })
    .onConflictDoUpdate({
      target: [boardInvites.boardId, boardInvites.email],
      set: { role, invitedById, createdAt: new Date() },
    });

  return { ok: true } as const;
}

export async function revokeInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  // No expiry filter here. An expired invite is still a row, and tidying one
  // away is exactly what this action is for.
  const invite = await db.query.boardInvites.findFirst({
    where: (row, { eq: is }) => is(row.id, parsed.data.inviteId),
    columns: { id: true, boardId: true },
  });
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, invite.boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.delete(boardInvites).where(eq(boardInvites.id, invite.id));
  return { ok: true } as const;
}
```

`and` and `eq` are imported now because A5 and A6 use them; if lint complains about an unused import at this step, add the actions in A5 before committing rather than deleting the import.

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add lib/actions/members.ts lib/actions/members.test.ts
git commit -m "feat: invite someone to a board by email, and take it back"
```

### Task A4: Accept and decline

**Files:**
- Modify: `lib/actions/members.ts`
- Test: `lib/actions/members.test.ts`

**Interfaces:**
- Consumes: `findPendingInvite(inviteId): Promise<FoundInvite | null>` from A2.
- Produces:
  ```ts
  acceptInvite({ inviteId: string })
    -> { ok: true, data: { boardId: string } } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' }
  declineInvite({ inviteId: string })
    -> { ok: true } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' }
  ```

- [x] **Step 1: Write the failing test**

Add to `lib/actions/members.test.ts`, and extend the import line to
`const { acceptInvite, declineInvite, inviteMember, revokeInvite } = await import('./members');`

```ts
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
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `acceptInvite is not a function`.

- [x] **Step 3: Write the two actions**

Add to `lib/actions/members.ts`, extending its imports with `revalidatePath` from `next/cache`, `boardMembers` from the schema, and `findPendingInvite` from `@/lib/members`:

```ts
// The only actions in this codebase that touch a board without a membership
// check. The invitee is not on the board yet by definition; they are scoped by
// the session's own email against the invite row, the way deleteAccount is
// scoped by the session's own user id.
async function invitedTo(inviteId: string, sessionEmail: string) {
  const invite = await findPendingInvite(inviteId);
  if (!invite) return null;
  return invite.email === sessionEmail.trim().toLowerCase() ? invite : null;
}

export async function acceptInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const invite = await invitedTo(parsed.data.inviteId, session.user.email);
  // One answer for "no such invite", "expired" and "addressed to someone else".
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  const userId = session.user.id;
  await db.transaction(async (tx) => {
    // Already a member is the end state the user asked for, so it is not an
    // error; the invite is consumed either way.
    await tx
      .insert(boardMembers)
      .values({ boardId: invite.boardId, userId, role: invite.role })
      .onConflictDoNothing();
    await tx.delete(boardInvites).where(eq(boardInvites.id, invite.id));
  });

  revalidatePath('/boards');
  return { ok: true, data: { boardId: invite.boardId } } as const;
}

export async function declineInvite(input: unknown) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'UNAUTHENTICATED' } as const;
  }

  const parsed = inviteRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const invite = await invitedTo(parsed.data.inviteId, session.user.email);
  if (!invite) return { ok: false, error: 'NOT_FOUND' } as const;

  await db.delete(boardInvites).where(eq(boardInvites.id, invite.id));
  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 13 tests.

- [x] **Step 5: Commit**

```bash
git add lib/actions/members.ts lib/actions/members.test.ts
git commit -m "feat: accept or decline an invite you were sent"
```

### Task A5: Role changes, removal, and leaving

**Files:**
- Modify: `lib/actions/members.ts`
- Test: `lib/actions/members.test.ts`

**Interfaces:**
- Produces:
  ```ts
  changeRole({ boardId: string, userId: string, role: 'member' | 'viewer' })
    -> { ok: true } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'TARGET_IS_OWNER' }
  removeMember({ boardId: string, userId: string })
    -> same result union
  leaveBoard({ boardId: string })
    -> { ok: true } | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'OWNER_CANNOT_LEAVE' }
  ```

- [x] **Step 1: Write the failing test**

Add to `lib/actions/members.test.ts`, extending the import line with `changeRole, leaveBoard, removeMember`:

```ts
describe('changeRole and removeMember', () => {
  test('refuse a target who is not on the board', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = undefined;
    await expect(changeRole({ boardId: 'board-1', userId: 'ghost', role: 'viewer' })).resolves.toEqual(
      { ok: false, error: 'NOT_FOUND' },
    );
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
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `changeRole is not a function`.

- [x] **Step 3: Write the three actions**

Add to `lib/actions/members.ts`:

```ts
const memberRef = z.object({ boardId: id, userId: id });
const roleSchema = memberRef.extend({ role: assignableRole });
const boardRef = z.object({ boardId: id });

async function targetMembership(boardId: string, userId: string) {
  return db.query.boardMembers.findFirst({
    where: (member, { and: both, eq: is }) =>
      both(is(member.boardId, boardId), is(member.userId, userId)),
    columns: { role: true },
  });
}

export async function changeRole(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId, role } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_FOUND' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  await db
    .update(boardMembers)
    .set({ role })
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function removeMember(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = memberRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_FOUND' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function leaveBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = boardRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId } = parsed.data;
  const userId = session.user.id;

  let role;
  try {
    role = await assertBoardAccess(userId, boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (role === 'owner') return { ok: false, error: 'OWNER_CANNOT_LEAVE' } as const;

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 19 tests.

- [x] **Step 5: Commit**

```bash
git add lib/actions/members.ts lib/actions/members.test.ts
git commit -m "feat: change a role, remove a member, leave a board"
```

### Task A6: Ownership transfer

**Files:**
- Modify: `lib/actions/members.ts`
- Test: `lib/actions/members.test.ts`

**Interfaces:**
- Produces:
  ```ts
  transferOwnership({ boardId: string, userId: string, confirmName: string })
    -> { ok: true }
     | { ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN'
                          | 'NAME_MISMATCH' | 'NOT_A_MEMBER' | 'TARGET_IS_OWNER' }
  ```

- [x] **Step 1: Write the failing test**

Add to `lib/actions/members.test.ts`, extending the import line with `transferOwnership`:

```ts
describe('transferOwnership', () => {
  const handover = { boardId: 'board-1', userId: 'user-2', confirmName: 'Roadmap' };

  test('refuses a board name that does not match', async () => {
    authMock.mockResolvedValue(signedIn);
    boardRow = { name: 'Roadmap' };
    await expect(transferOwnership({ ...handover, confirmName: 'roadmap' })).resolves.toEqual({
      ok: false,
      error: 'NAME_MISMATCH',
    });
    expect(ops).toEqual([]);
  });

  test('refuses a target who has not accepted an invite to this board', async () => {
    authMock.mockResolvedValue(signedIn);
    boardRow = { name: 'Roadmap' };
    membershipRow = undefined;
    await expect(transferOwnership(handover)).resolves.toEqual({
      ok: false,
      error: 'NOT_A_MEMBER',
    });
    expect(ops).toEqual([]);
  });

  // One owner row means "already the owner" and "is you" are one condition.
  test('refuses a transfer to yourself', async () => {
    authMock.mockResolvedValue(signedIn);
    boardRow = { name: 'Roadmap' };
    membershipRow = { role: 'owner' };
    await expect(transferOwnership({ ...handover, userId: 'owner-1' })).resolves.toEqual({
      ok: false,
      error: 'TARGET_IS_OWNER',
    });
    expect(ops).toEqual([]);
  });

  test('moves the board, promotes the target, and demotes the caller to member', async () => {
    authMock.mockResolvedValue(signedIn);
    boardRow = { name: 'Roadmap' };
    membershipRow = { role: 'member' };
    await expect(transferOwnership(handover)).resolves.toEqual({ ok: true });
    expect(ops).toEqual([
      { kind: 'update', table: 'boards', values: { ownerId: 'user-2' } },
      { kind: 'update', table: 'board_members', values: { role: 'owner' } },
      { kind: 'update', table: 'board_members', values: { role: 'member' } },
    ]);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `transferOwnership is not a function`.

- [x] **Step 3: Write the action**

Add to `lib/actions/members.ts`, extending its schema import with `boards`:

```ts
const transferSchema = memberRef.extend({ confirmName: z.string() });

export async function transferOwnership(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, userId, confirmName } = parsed.data;
  const previousOwnerId = session.user.id;

  try {
    await assertBoardAccess(previousOwnerId, boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Re-checked here because a client can skip the dialog that asked for it.
  const board = await db.query.boards.findFirst({
    where: (row, { eq: is }) => is(row.id, boardId),
    columns: { name: true },
  });
  if (!board || board.name !== confirmName.trim()) {
    return { ok: false, error: 'NAME_MISMATCH' } as const;
  }

  const membership = await targetMembership(boardId, userId);
  if (!membership) return { ok: false, error: 'NOT_A_MEMBER' } as const;
  if (membership.role === 'owner') return { ok: false, error: 'TARGET_IS_OWNER' } as const;

  await db.transaction(async (tx) => {
    await tx.update(boards).set({ ownerId: userId }).where(eq(boards.id, boardId));
    await tx
      .update(boardMembers)
      .set({ role: 'owner' })
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
    await tx
      .update(boardMembers)
      .set({ role: 'member' })
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, previousOwnerId)));
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run the whole gate**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint      > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm test      > /tmp/unit.log 2>&1; echo "TEST=$?"; tail -5 /tmp/unit.log
```

Expected: all three `=0`, 23 tests in `lib/actions/members.test.ts`.

- [x] **Step 5: Commit and open the Section A pull request**

CLAUDE.md changes in this PR, because these are the section that makes them true — "keep this file current, in the same change":

- **"Data model"**: add `board_invites` with its columns, the unique `(boardId, email)` pair, the `email` index and the check constraint.
- **"Auth and permissions"**: rewrite the invite-flow line. There is no sign-in callback; invites key on an email address and resolve when the invitee accepts from `/boards`.

The event count stays at twelve until Section D publishes the three new ones.

```bash
git add lib/actions/members.ts lib/actions/members.test.ts CLAUDE.md docs/plans/member-management.md
git commit -m "feat: hand a board to another member"
git push -u origin feat/members-actions
```

Open the PR with `gh pr create`, base `main`. The body states: the spec and this section, the observed output of the gate above (not the intent), that no UI reaches these actions yet, and that the migration must be applied to production by hand by whoever merges it. Then stop and hand back — Section B starts in a fresh session.

---

# Section B — the members dialog

Branch `feat/members-dialog` from `main` once A has landed. Confirm the base is real first:

```bash
git fetch origin
git merge-base --is-ancestor origin/feat/members-actions origin/main && echo "base is real"
```

### Task B1: The dialog, the list, and the email rule

**Files:**
- Modify: `lib/members.ts`, `lib/members.test.ts`
- Create: `components/board/members-button.tsx`, `components/board/members-dialog.tsx`, `components/board/members-dialog.test.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`

**Interfaces:**
- Consumes: `listMembers`, `listPendingInvites` from A2.
- Produces:
  ```ts
  // lib/members.ts
  export type VisibleMember = Omit<BoardMemberRow, 'email'> & { email: string | null };
  export function visibleMembers(members: BoardMemberRow[], viewerIsOwner: boolean): VisibleMember[];

  // components/board/members-dialog.tsx — 'use client'
  export function MembersDialog(props: {
    boardId: string; boardName: string; viewerId: string; isOwner: boolean;
    members: VisibleMember[]; invites: PendingInvite[];
  }): React.ReactElement;

  // components/board/members-button.tsx — server component
  export function MembersButton(props: {
    boardId: string; boardName: string; viewerId: string; role: BoardRole;
  }): Promise<React.ReactElement>;
  ```

- [x] **Step 1: Write the failing tests**

Add to `lib/members.test.ts`:

```ts
describe('visibleMembers', () => {
  const rows = [
    { userId: 'u1', name: 'Ada', email: 'ada@example.test', image: null, role: 'owner' as const },
    { userId: 'u2', name: 'Grace', email: 'grace@example.test', image: null, role: 'member' as const },
  ];

  test('gives the owner every address', () => {
    expect(visibleMembers(rows, true).map((m) => m.email)).toEqual([
      'ada@example.test',
      'grace@example.test',
    ]);
  });

  // The rule is about what is sent, not what is rendered. A dialog handed every
  // address and told to hide some has already published them to the client.
  test('sends a non-owner no addresses at all', () => {
    expect(visibleMembers(rows, false).map((m) => m.email)).toEqual([null, null]);
  });

  test('keeps the names and roles either way', () => {
    expect(visibleMembers(rows, false).map((m) => [m.name, m.role])).toEqual([
      ['Ada', 'owner'],
      ['Grace', 'member'],
    ]);
  });
});
```

Extend that file's import to include `visibleMembers`.

Create `components/board/members-dialog.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { MembersDialog } from './members-dialog';

const members = [
  { userId: 'u1', name: 'Ada', email: null, image: null, role: 'owner' as const },
  { userId: 'u2', name: 'Grace', email: null, image: null, role: 'viewer' as const },
];

const render = (props: Partial<Parameters<typeof MembersDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <MembersDialog
      boardId="board-1"
      boardName="Roadmap"
      viewerId="u2"
      isOwner={false}
      members={members}
      invites={[]}
      {...props}
    />,
  );

describe('MembersDialog', () => {
  test('names everyone on the board and their role', () => {
    const html = render();
    expect(html).toContain('Ada');
    expect(html).toContain('Grace');
    expect(html).toMatch(/viewer/i);
  });

  test('offers a non-owner the way out', () => {
    expect(render()).toMatch(/leave board/i);
  });

  test('does not offer the owner a way to leave their own board', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    expect(html).not.toMatch(/leave board/i);
  });
});
```

- [x] **Step 2: Run them to watch them fail**

```bash
pnpm exec vitest run lib/members.test.ts components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `visibleMembers is not a function`, and the dialog module does not resolve.

- [x] **Step 3: Write the helper, the dialog and the button**

In `lib/members.ts`:

```ts
export type VisibleMember = Omit<BoardMemberRow, 'email'> & { email: string | null };

// "Only the owner sees addresses" is a rule about what is sent. A dialog handed
// every address and told to render some of them has already put them in the
// props and in the network tab.
export function visibleMembers(
  members: BoardMemberRow[],
  viewerIsOwner: boolean,
): VisibleMember[] {
  return members.map((member) => ({ ...member, email: viewerIsOwner ? member.email : null }));
}
```

Create `components/board/members-dialog.tsx`. This task builds the read-only half; B2 to B4 add the owner's controls and the leave button's action call.

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { leaveBoard } from '@/lib/actions/members';
import { avatarHue, initials } from '@/lib/avatar';
import type { PendingInvite, VisibleMember } from '@/lib/members';

export function MembersDialog({
  boardId,
  boardName,
  viewerId,
  isOwner,
  members,
  invites,
}: {
  boardId: string;
  boardName: string;
  viewerId: string;
  isOwner: boolean;
  members: VisibleMember[];
  invites: PendingInvite[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  void boardName;
  void invites;
  void pending;


  function leave() {
    startTransition(async () => {
      const result = await leaveBoard({ boardId });
      if (!result.ok) {
        setError('You could not be taken off this board. Try again.');
        return;
      }
      router.push('/boards');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium">
        Members
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Members</DialogTitle>
        <ul className="mt-4 space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
                style={{ background: `hsl(${avatarHue(member.userId)} 45% 40%)` }}
              >
                {initials(member.name, member.email ?? '')}
              </span>
              <span className="flex-1 text-sm">
                {member.name ?? member.email ?? 'Someone'}
                {member.userId === viewerId && <span className="ml-2 text-xs text-muted">You</span>}
              </span>
              {member.email && <span className="text-xs text-muted">{member.email}</span>}
              <span className="font-mono text-xs text-muted">{member.role}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 text-sm text-time-over">{error}</p>}
        {!isOwner && (
          <button
            type="button"
            onClick={leave}
            className="mt-5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium text-time-over"
          >
            Leave board
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

The three `void` statements are scaffolding for props B2 to B4 consume; delete each one as its task starts using the prop. Do not remove the props themselves — the server component already passes them.

Create `components/board/members-button.tsx`:

```tsx
import { MembersDialog } from '@/components/board/members-dialog';
import { listMembers, listPendingInvites, visibleMembers } from '@/lib/members';
import type { BoardRole } from '@/lib/permissions';

export async function MembersButton({
  boardId,
  boardName,
  viewerId,
  role,
}: {
  boardId: string;
  boardName: string;
  viewerId: string;
  role: BoardRole;
}) {
  const isOwner = role === 'owner';
  const members = visibleMembers(await listMembers(boardId), isOwner);
  const invites = isOwner ? await listPendingInvites(boardId) : [];

  return (
    <MembersDialog
      boardId={boardId}
      boardName={boardName}
      viewerId={viewerId}
      isOwner={isOwner}
      members={members}
      invites={invites}
    />
  );
}
```

In `app/(app)/(board)/boards/[boardId]/layout.tsx`, pass it **outside** the write gate:

```tsx
actions={
  <>
    <MembersButton
      boardId={boardId}
      boardName={board.name}
      viewerId={session.user.id}
      role={role}
    />
    {atLeast(role, 'member') ? <NewCardButton /> : null}
  </>
}
```

`NewCardButton` is today's only `actions` child and it sits inside `atLeast(role, 'member')`. Adding the members control inside that same conditional would hide it from viewers — the people most likely to want out of a board.

- [x] **Step 4: Run the tests and the bundler**

```bash
pnpm exec vitest run lib/members.test.ts components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: both `=0`. **The build is not optional here.** `members-dialog.tsx` is a client component importing from `@/lib/members`; a value import from `@/lib/permissions` or `@/lib/events` anywhere in that file's graph pulls the pg pool or the Pusher SDK into the browser bundle, and typecheck, lint and unit tests all pass on that mistake. `import type` is erased and is safe.

- [x] **Step 5: Commit**

```bash
git add lib/members.ts lib/members.test.ts components/board/members-button.tsx components/board/members-dialog.tsx components/board/members-dialog.test.tsx "app/(app)/(board)/boards/[boardId]/layout.tsx"
git commit -m "feat: show who is on the board, and let a member leave it"
```

### Task B2: Inviting, and the pending list

**Files:**
- Modify: `components/board/members-dialog.tsx`, `components/board/members-dialog.test.tsx`

**Interfaces:**
- Consumes: `inviteMember`, `revokeInvite` from A3; the `invites: PendingInvite[]` prop from B1.

- [x] **Step 1: Write the failing test**

Add to `components/board/members-dialog.test.tsx`:

```tsx
const invites = [
  { id: 'i1', email: 'waiting@example.test', role: 'member' as const, createdAt: new Date(0) },
];

describe('MembersDialog, as the owner', () => {
  const asOwner = { viewerId: 'u1', isOwner: true, invites };

  test('offers a field to invite an address', () => {
    const html = render(asOwner);
    expect(html).toMatch(/invite by email/i);
    expect(html).toContain('type="email"');
  });

  test('lists an invite that has not been answered yet', () => {
    expect(render(asOwner)).toContain('waiting@example.test');
  });

  test('offers to take a pending invite back', () => {
    expect(render(asOwner)).toMatch(/revoke/i);
  });

  test('shows a non-owner none of it', () => {
    const html = render({ invites });
    expect(html).not.toMatch(/invite by email/i);
    expect(html).not.toContain('waiting@example.test');
  });
});
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — no invite field in the markup.

- [x] **Step 3: Add the owner's invite section**

In `components/board/members-dialog.tsx`, delete `void invites;`, import `inviteMember` and `revokeInvite` alongside `leaveBoard`, and add state for the form:

```tsx
const [email, setEmail] = useState('');
const [role, setRole] = useState<'member' | 'viewer'>('member');

function invite(event: React.FormEvent) {
  event.preventDefault();
  setError(null);
  startTransition(async () => {
    const result = await inviteMember({ boardId, email, role });
    if (!result.ok) {
      setError(
        result.error === 'ALREADY_MEMBER'
          ? 'They are already on this board.'
          : 'That invite could not be sent. Check the address and try again.',
      );
      return;
    }
    setEmail('');
    router.refresh();
  });
}

function revoke(inviteId: string) {
  startTransition(async () => {
    const result = await revokeInvite({ inviteId });
    if (!result.ok) {
      setError('That invite could not be withdrawn. Try again.');
      return;
    }
    router.refresh();
  });
}
```

Render, inside `{isOwner && ( … )}` beneath the member list:

```tsx
<form onSubmit={invite} className="mt-5 space-y-2">
  <label className="block text-sm text-muted" htmlFor="invite-email">
    Invite by email
  </label>
  <div className="flex gap-2">
    <input
      id="invite-email"
      type="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
      className="flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
    />
    <select
      aria-label="Role"
      value={role}
      onChange={(event) => setRole(event.target.value === 'viewer' ? 'viewer' : 'member')}
      className="rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm"
    >
      <option value="member">Member</option>
      <option value="viewer">Viewer</option>
    </select>
    <button
      type="submit"
      disabled={pending}
      className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
    >
      Send invite
    </button>
  </div>
</form>
```

And the pending list, still inside the owner block:

```tsx
{invites.length > 0 && (
  <ul className="mt-4 space-y-2 border-t border-line pt-3">
    {invites.map((invite) => (
      <li key={invite.id} className="flex items-center gap-3 text-sm">
        <span className="flex-1">{invite.email}</span>
        <span className="font-mono text-xs text-muted">invited as {invite.role}</span>
        <button
          type="button"
          onClick={() => revoke(invite.id)}
          className="text-xs font-medium text-time-over"
        >
          Revoke
        </button>
      </li>
    ))}
  </ul>
)}
```

Delete `void pending;` — the invite button now uses it.

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add components/board/members-dialog.tsx components/board/members-dialog.test.tsx
git commit -m "feat: invite someone from the members dialog, and withdraw it"
```

### Task B3: Changing a role and removing someone

**Files:**
- Modify: `components/board/members-dialog.tsx`, `components/board/members-dialog.test.tsx`

**Interfaces:**
- Consumes: `changeRole`, `removeMember` from A5.

- [x] **Step 1: Write the failing test**

Add to `components/board/members-dialog.test.tsx`:

```tsx
describe('MembersDialog role controls', () => {
  test('lets the owner change a member role and remove them', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    expect(html).toContain('aria-label="Role for Grace"');
    expect(html).toMatch(/remove/i);
  });

  // One owner row is the invariant the whole design rests on: no control in
  // this dialog may offer to demote or remove the owner.
  test('offers no role control and no remove against the owner row', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    expect(html).not.toContain('aria-label="Role for Ada"');
  });

  test('shows a non-owner no controls at all', () => {
    const html = render();
    expect(html).not.toContain('aria-label="Role for Grace"');
    expect(html).not.toMatch(/remove/i);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — no `aria-label="Role for Grace"` in the markup.

- [x] **Step 3: Add the controls**

Import `changeRole` and `removeMember`, and add:

```tsx
function setMemberRole(userId: string, next: 'member' | 'viewer') {
  startTransition(async () => {
    const result = await changeRole({ boardId, userId, role: next });
    if (!result.ok) {
      setError('That role could not be changed. Try again.');
      return;
    }
    router.refresh();
  });
}

function remove(userId: string) {
  startTransition(async () => {
    const result = await removeMember({ boardId, userId });
    if (!result.ok) {
      setError('They could not be removed. Try again.');
      return;
    }
    router.refresh();
  });
}
```

In the member list item, replace the plain role label with a conditional. The owner's own row keeps the static label, so no control exists that could demote the one owner:

```tsx
{isOwner && member.role !== 'owner' ? (
  <>
    <select
      aria-label={`Role for ${member.name ?? member.email ?? 'this member'}`}
      value={member.role}
      onChange={(event) =>
        setMemberRole(member.userId, event.target.value === 'viewer' ? 'viewer' : 'member')
      }
      className="rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1 text-xs"
    >
      <option value="member">Member</option>
      <option value="viewer">Viewer</option>
    </select>
    <button
      type="button"
      onClick={() => remove(member.userId)}
      className="text-xs font-medium text-time-over"
    >
      Remove
    </button>
  </>
) : (
  <span className="font-mono text-xs text-muted">{member.role}</span>
)}
```

- [x] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add components/board/members-dialog.tsx components/board/members-dialog.test.tsx
git commit -m "feat: change a member role or remove them from the dialog"
```

### Task B4: Handing the board over

**Files:**
- Modify: `components/board/members-dialog.tsx`, `components/board/members-dialog.test.tsx`

**Interfaces:**
- Consumes: `transferOwnership` from A6; the `boardName` prop from B1.

- [x] **Step 1: Write the failing test**

```tsx
describe('MembersDialog transfer', () => {
  test('offers the owner a way to hand the board to a member', () => {
    expect(render({ viewerId: 'u1', isOwner: true })).toMatch(/make owner/i);
  });

  test('offers a non-owner nothing of the kind', () => {
    expect(render()).not.toMatch(/make owner/i);
  });
});
```

- [x] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — no "Make owner" in the markup.

- [x] **Step 3: Add the transfer step**

Delete `void boardName;`. Import `transferOwnership`. Add state for the second step and the typed confirmation:

```tsx
const [handingTo, setHandingTo] = useState<string | null>(null);
const [confirmName, setConfirmName] = useState('');

function transfer(userId: string) {
  setError(null);
  startTransition(async () => {
    const result = await transferOwnership({ boardId, userId, confirmName });
    if (!result.ok) {
      setError(
        result.error === 'NAME_MISMATCH'
          ? `Type ${boardName} exactly to hand the board over.`
          : 'The board could not be handed over. Try again.',
      );
      return;
    }
    setHandingTo(null);
    setConfirmName('');
    router.refresh();
  });
}
```

Beside "Remove" in an owner's view of a member row:

```tsx
<button
  type="button"
  onClick={() => setHandingTo(member.userId)}
  className="text-xs font-medium"
>
  Make owner
</button>
```

And, beneath the list when `handingTo` is set:

```tsx
{handingTo && (
  <div className="mt-4 rounded-[var(--radius-control)] border border-line p-3">
    <p className="text-sm">
      They become the owner and you become a member. Type <strong>{boardName}</strong> to confirm.
    </p>
    <input
      aria-label="Board name"
      value={confirmName}
      onChange={(event) => setConfirmName(event.target.value)}
      className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
    />
    <button
      type="button"
      onClick={() => transfer(handingTo)}
      disabled={pending}
      className="mt-2 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium text-time-over"
    >
      Hand over the board
    </button>
  </div>
)}
```

- [x] **Step 4: Run the gate**

```bash
pnpm exec vitest run components/board/members-dialog.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `=0`, 12 tests in the dialog file. Confirm no `void ` scaffolding statements remain in `members-dialog.tsx`.

- [x] **Step 5: Commit**

```bash
git add components/board/members-dialog.tsx components/board/members-dialog.test.tsx
git commit -m "feat: hand a board over from the members dialog"
```

### Task B5: Prove it in a browser, and ship Section B

**Files:**
- Create: `e2e/members.spec.ts`
- Modify: `e2e/support/session.ts`

**Interfaces:**
- Produces: `boardMemberRoles(boardId): Promise<{ user_id: string; role: string }[]>` and `boardOwnerId(boardId): Promise<string | null>` in `e2e/support/session.ts`, used again in Sections C and D.

- [ ] **Step 1: Add the seed helpers**

In `e2e/support/session.ts`:

```ts
export async function boardMemberRoles(
  boardId: string,
): Promise<{ user_id: string; role: string }[]> {
  const { rows } = await seedPool().query<{ user_id: string; role: string }>(
    'select user_id, role from board_members where board_id = $1 order by role',
    [boardId],
  );
  return rows;
}

export async function boardOwnerId(boardId: string): Promise<string | null> {
  const { rows } = await seedPool().query<{ owner_id: string }>(
    'select owner_id from boards where id = $1',
    [boardId],
  );
  return rows[0]?.owner_id ?? null;
}
```

- [ ] **Step 2: Write the failing e2e spec**

Create `e2e/members.spec.ts`. Section B drives the owner's dialog against a seeded second member — Section C replaces the seeding with the real invite flow.

```ts
import { expect, test } from '@playwright/test';

import {
  boardMemberRoles,
  boardOwnerId,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('the owner changes a role and removes a member', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Staffed');
  const other = await seedSession(context);
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();

    const wrote = written(page);
    await page.getByLabel('Role for Test User').selectOption('viewer');
    await wrote;
    await expect
      .poll(async () => (await boardMemberRoles(boardId)).find((r) => r.user_id === other.userId)?.role)
      .toBe('viewer');

    const removed = written(page);
    await page.getByRole('button', { name: 'Remove' }).click();
    await removed;
    await expect
      .poll(async () => (await boardMemberRoles(boardId)).length)
      .toBe(1);
  } finally {
    await removeSeededUser(other.userId);
    await removeSeededUser(owner.userId);
  }
});

test('handing the board over swaps both roles and the owner column', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Handover');
  const heir = await seedSession(context);
  await seedMember(boardId, heir.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Make owner' }).click();
    await page.getByLabel('Board name').fill('Handover');

    const wrote = written(page);
    await page.getByRole('button', { name: 'Hand over the board' }).click();
    await wrote;

    await expect.poll(async () => boardOwnerId(boardId)).toBe(heir.userId);
    const roles = await boardMemberRoles(boardId);
    expect(roles.filter((row) => row.role === 'owner')).toEqual([
      { user_id: heir.userId, role: 'owner' },
    ]);
    expect(roles.find((row) => row.user_id === owner.userId)?.role).toBe('member');
  } finally {
    await removeSeededUser(heir.userId);
    await removeSeededUser(owner.userId);
  }
});

test('a viewer can see who is on the board and leave it', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Read only');
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();
    // Addresses belong to the owner who typed them; a viewer is never sent one.
    await expect(page.getByText(owner.email)).toHaveCount(0);

    const wrote = written(page);
    await page.getByRole('button', { name: 'Leave board' }).click();
    await wrote;
    await page.waitForURL('**/boards');
    await expect.poll(async () => (await boardMemberRoles(boardId)).length).toBe(1);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
```

`seedSession` gives every user the name "Test User", so `Role for Test User` is the label for the seeded member — the owner's own row has no such control by design.

- [ ] **Step 3: Run it**

```bash
pnpm exec playwright test e2e/members.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: PASS, 3 tests. **Compare the number that ran against the number collected** — a passing count is not a passing suite.

- [ ] **Step 4: Take the screenshots the PR needs**

The dialog in both themes at 1440px and 390px, as owner and as viewer. Save under `docs/screenshots/`, matching what the account-deletion PR committed. Close any browser or dev server you opened.

- [ ] **Step 5: Commit and open the Section B pull request**

```bash
git add e2e/members.spec.ts e2e/support/session.ts docs/screenshots docs/plans/member-management.md
git commit -m "test: drive the members dialog through a browser"
git push -u origin feat/members-dialog
```

PR base `main`. The body carries the observed gate output, the screenshots, and the note that nothing invites anyone yet — accept lands in Section C. Then stop and hand back.

---

# Section C — the invitee's side

Branch `feat/members-invitations` from `main` once A has landed (it does not need B).

### Task C1: Invitations on `/boards`

**Files:**
- Create: `components/boards/invitations.tsx`, `components/boards/invitations.test.tsx`
- Modify: `app/(app)/(chrome)/boards/page.tsx`

**Interfaces:**
- Consumes: `listInvitesForUser` from A2; `acceptInvite`, `declineInvite` from A4.
- Produces:
  ```ts
  export function Invitations({ invites }: { invites: UserInvite[] }): React.ReactElement | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `components/boards/invitations.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Invitations } from './invitations';

const invites = [
  {
    id: 'i1',
    boardId: 'b1',
    boardName: 'Roadmap',
    role: 'member' as const,
    invitedByName: 'Ada',
  },
];

describe('Invitations', () => {
  test('renders nothing when there are none', () => {
    expect(renderToStaticMarkup(<Invitations invites={[]} />)).toBe('');
  });

  test('names who invited you, to what, and as what', () => {
    const html = renderToStaticMarkup(<Invitations invites={invites} />);
    expect(html).toContain('Ada');
    expect(html).toContain('Roadmap');
    expect(html).toMatch(/member/i);
  });

  test('falls back to the board alone when the inviter is gone', () => {
    const html = renderToStaticMarkup(
      <Invitations invites={[{ ...invites[0], invitedByName: null }]} />,
    );
    expect(html).toContain('Roadmap');
    expect(html).toMatch(/you have been invited/i);
  });

  test('offers both answers', () => {
    const html = renderToStaticMarkup(<Invitations invites={invites} />);
    expect(html).toMatch(/accept/i);
    expect(html).toMatch(/decline/i);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run components/boards/invitations.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — the module does not resolve.

- [ ] **Step 3: Write the component and wire the page**

Create `components/boards/invitations.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { acceptInvite, declineInvite } from '@/lib/actions/members';
import type { UserInvite } from '@/lib/members';

export function Invitations({ invites }: { invites: UserInvite[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (invites.length === 0) return null;

  function answer(inviteId: string, accepted: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await (accepted ? acceptInvite({ inviteId }) : declineInvite({ inviteId }));
      if (!result.ok) {
        setError('That invitation is no longer open. Refresh to see what changed.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">Invitations</h2>
      <ul className="mt-3 space-y-3">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-[15px]">
              {invite.invitedByName
                ? `${invite.invitedByName} invited you to ${invite.boardName} as a ${invite.role}.`
                : `You have been invited to ${invite.boardName} as a ${invite.role}.`}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(invite.id, true)}
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(invite.id, false)}
              className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-time-over">{error}</p>}
    </section>
  );
}
```

In `app/(app)/(chrome)/boards/page.tsx`, read the invites beside the boards and render the section **above** the heading block, so it sits above both the list and the empty state:

```tsx
const invites = session.user.email ? await listInvitesForUser(session.user.email) : [];
```

```tsx
<main className="mx-auto w-full max-w-3xl px-4 py-8">
  <Invitations invites={invites} />
  <div className="mb-6 flex items-center justify-between">
```

The existing "Create your first board" empty state stays exactly as it is. An invitation is a thing waiting for you and the empty state is a thing to do; they are not alternatives, so neither replaces the other.

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run components/boards/invitations.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: both `=0`, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/boards/invitations.tsx components/boards/invitations.test.tsx "app/(app)/(chrome)/boards/page.tsx"
git commit -m "feat: answer a board invitation from the board list"
```

### Task C2: An invite must not outlive the account it names

**Files:**
- Modify: `lib/actions/account.ts`, `lib/actions/account.test.ts`
- Modify: `app/(legal)/privacy/page.tsx`, `app/(legal)/privacy/page.test.tsx`

**Interfaces:**
- Consumes: the `boardInvites` table from A1.
- Produces: no new exports. `deleteAccount`'s result union is unchanged.

- [ ] **Step 1: Write the failing tests**

`lib/actions/account.test.ts`'s transaction mock records only that *a* delete happened. Replace its `tx` with one that records which table, so the new statement is provable:

```ts
const deleted: string[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const tx = {
  delete: (table: unknown) => ({
    where: async () => {
      deleted.push(tableName(table));
    },
  }),
};
```

Reset it in `beforeEach` with `deleted.length = 0;`, and replace every `deletedUserId` assertion: `expect(deletedUserId).toBeNull()` becomes `expect(deleted).toEqual([])`, and `expect(deletedUserId).toBe('called')` becomes the new assertion below. Then add:

```ts
// board_invites keys on an email address and has no foreign key to cascade
// through, so nothing else removes an invite addressed to a departing user.
// /privacy promises the deletion is complete.
test('takes pending invites addressed to the departing user with it', async () => {
  authMock.mockResolvedValue(signedIn);
  await expect(deleteAccount({ confirmEmail: 'me@example.test' })).resolves.toEqual({ ok: true });
  expect(deleted).toEqual(['board_invites', 'user']);
});
```

And in `app/(legal)/privacy/page.test.tsx`:

```ts
test('says what happens to an address typed into an invite', () => {
  expect(html()).toMatch(/invite/i);
  expect(html()).toMatch(/until (the invitation is|it is) accepted, declined, withdrawn or expires/i);
});
```

- [ ] **Step 2: Run them to watch them fail**

```bash
pnpm exec vitest run lib/actions/account.test.ts "app/(legal)/privacy/page.test.tsx" > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/unit.log
```

Expected: FAIL — `deleted` is `['user']`, and the policy says nothing about invites.

- [ ] **Step 3: Delete the invites and say so in the policy**

In `lib/actions/account.ts`, import `sql` from `drizzle-orm` and `boardInvites` from the schema, then inside the existing transaction, **before** the user delete:

```ts
// board_invites keys on an address, not a user id, so no foreign key removes
// these. An invite left behind would keep an email address alive after the
// account it names is gone.
await tx.delete(boardInvites).where(sql`lower(${boardInvites.email}) = ${typed}`);
await tx.delete(users).where(eq(users.id, userId));
```

`typed` is already the session's own address, trimmed and lower-cased, and the `EMAIL_MISMATCH` check above guarantees it equals the session email.

In `app/(legal)/privacy/page.tsx`, add to "What we collect" or the sharing section — wherever the surrounding prose reads best — and bump `LAST_UPDATED` to the merge date:

> **Invitations.** If you invite somebody to a board, we store the email address you type until the invitation is accepted, declined, withdrawn or expires after 30 days. If you delete your account, invitations addressed to you go with it.

- [ ] **Step 4: Run them to watch them pass**

```bash
pnpm exec vitest run lib/actions/account.test.ts "app/(legal)/privacy/page.test.tsx" > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS. If the policy assertion still fails, the regex and the prose disagree — fix the prose, and only widen the regex if the prose is right.

- [ ] **Step 5: Give the blocked danger zone its second way out**

`/account`'s danger zone lists the boards blocking a deletion and offers only "delete that board". Transfer now exists, so the copy gains the other resolution. In the component that renders the blocked list, extend the sentence to say that handing the board to one of its members from that board's members dialog also unblocks the deletion. No logic changes: `sharedBoardsOwnedBy` stops returning a board the moment you are no longer its owner, so `deleteAccount` unblocks itself.

Find it with `grep -rn "OWNS_SHARED_BOARDS" components app`, and keep the existing links to each board.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/account.ts lib/actions/account.test.ts "app/(legal)/privacy/page.tsx" "app/(legal)/privacy/page.test.tsx" components
git commit -m "fix: delete pending invites with the account they name"
```

### Task C3: The whole invite flow, in two browsers

**Files:**
- Modify: `e2e/members.spec.ts`, `e2e/support/session.ts`

**Interfaces:**
- Produces: `pendingInviteCount(boardId): Promise<number>` in `e2e/support/session.ts`.

- [ ] **Step 1: Add the helper and write the failing test**

In `e2e/support/session.ts`:

```ts
export async function pendingInviteCount(boardId: string): Promise<number> {
  const { rows } = await seedPool().query<{ n: number }>(
    'select count(*)::int as n from board_invites where board_id = $1',
    [boardId],
  );
  return rows[0].n;
}
```

Add to `e2e/members.spec.ts`. Two contexts, because the invite is sent by one person and answered by another:

```ts
test('an invite sent by the owner is accepted by its addressee', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const invitee = await seedSession(inviteeContext);
  const boardId = await seedBoard(owner.userId, 'Shared work');

  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByLabel('Invite by email').fill(invitee.email);

    const sent = written(ownerPage);
    await ownerPage.getByRole('button', { name: 'Send invite' }).click();
    await sent;
    await expect.poll(async () => pendingInviteCount(boardId)).toBe(1);

    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto('/boards');
    await expect(inviteePage.getByText('Shared work')).toBeVisible();

    const accepted = written(inviteePage);
    await inviteePage.getByRole('button', { name: 'Accept' }).click();
    await accepted;

    // The invite is consumed and the membership exists: both halves, because
    // either one alone would pass with the other broken.
    await expect.poll(async () => pendingInviteCount(boardId)).toBe(0);
    await expect
      .poll(async () => (await boardMemberRoles(boardId)).find((r) => r.user_id === invitee.userId)?.role)
      .toBe('member');

    await inviteePage.goto(`/boards/${boardId}`);
    await expect(inviteePage.getByRole('button', { name: 'Members' })).toBeVisible();
  } finally {
    await removeSeededUser(invitee.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await inviteeContext.close();
  }
});

test('declining an invite leaves no membership and no invite', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const invitee = await seedSession(inviteeContext);
  const boardId = await seedBoard(owner.userId, 'Not for me');

  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByLabel('Invite by email').fill(invitee.email);
    const sent = written(ownerPage);
    await ownerPage.getByRole('button', { name: 'Send invite' }).click();
    await sent;

    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto('/boards');
    const declined = written(inviteePage);
    await inviteePage.getByRole('button', { name: 'Decline' }).click();
    await declined;

    await expect.poll(async () => pendingInviteCount(boardId)).toBe(0);
    await expect.poll(async () => (await boardMemberRoles(boardId)).length).toBe(1);
  } finally {
    await removeSeededUser(invitee.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await inviteeContext.close();
  }
});
```

Extend the file's import from `./support/session` with `pendingInviteCount`.

- [ ] **Step 2: Run the whole e2e suite**

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: `EXIT=0`, and the number that ran equals the number collected. The whole suite, not just this file — `/boards` gained a section above the list and `e2e/boards.spec.ts` asserts that page's empty state.

- [ ] **Step 3: Prove the deletion by hand**

Seed nothing; use two real accounts in a browser. Invite an address, then delete that account from `/account`, then read the table directly:

```bash
psql "$DATABASE_URL_UNPOOLED" -c "select count(*) from board_invites where email = '<the address>'"
```

Expected: `0`. Record the actual output in the PR body.

- [ ] **Step 4: Screenshots**

`/boards` with an invitation pending, both themes, 1440px and 390px. Close every browser and dev server you opened.

- [ ] **Step 5: Commit and open the Section C pull request**

```bash
git add e2e/members.spec.ts e2e/support/session.ts docs/screenshots docs/plans/member-management.md
git commit -m "test: send, accept and decline an invite in two browsers"
git push -u origin feat/members-invitations
```

PR base `main`. The body carries the gate output, the `psql` result from Step 3 verbatim, and the note that membership changes are not yet realtime — Section D. Then stop and hand back.

---

# Section D — realtime membership

Branch `feat/members-realtime` from `main` once B and C have landed.

### Task D1: Three events, published

**Files:**
- Modify: `lib/events.ts`, `lib/actions/members.ts`, `lib/actions/members.test.ts`

**Interfaces:**
- Produces: three new members of the `BoardEvent` union:
  ```ts
  | { type: 'member.added'; userId: string; role: BoardRole }
  | { type: 'member.updated'; userId: string; role: BoardRole }
  | { type: 'member.removed'; userId: string }
  ```
  Every membership action gains a `mutationId: string` field in its input schema, matching the card and comment actions.

- [ ] **Step 1: Write the failing test**

Add to `lib/actions/members.test.ts`. The harness already mocks `@/lib/events`; add the `publish` spy the comments suite uses:

```ts
const publish = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
});
```

and `publish.mockReset()` in `beforeEach`. Then:

```ts
const MUTATION_ID = '11111111-1111-4111-8111-111111111111';

describe('membership events', () => {
  test('accepting an invite announces the new member', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2', email: 'new@example.test' } });
    findPendingInvite.mockResolvedValue({
      id: 'invite-1',
      boardId: 'board-1',
      email: 'new@example.test',
      role: 'member',
    });
    await acceptInvite({ inviteId: 'invite-1' });
    // acceptInvite is called from /boards, which has no RealtimeProvider and so
    // no claim() to take an id from. The accepting user is not subscribed to
    // this channel either, so there is no echo of their own to suppress.
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'member.added',
      userId: 'user-2',
      role: 'member',
      mutationId: expect.any(String),
      actorId: 'user-2',
    });
  });

  test('a demotion announces the new role', async () => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = { role: 'member' };
    await changeRole({
      boardId: 'board-1',
      userId: 'user-2',
      role: 'viewer',
      mutationId: MUTATION_ID,
    });
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'member.updated',
      userId: 'user-2',
      role: 'viewer',
      mutationId: MUTATION_ID,
      actorId: 'owner-1',
    });
  });

  test.each([
    ['removeMember', () => removeMember({ boardId: 'board-1', userId: 'user-2', mutationId: MUTATION_ID })],
    ['leaveBoard', () => leaveBoard({ boardId: 'board-1', mutationId: MUTATION_ID })],
  ])('%s announces the departure', async (name, call) => {
    authMock.mockResolvedValue(signedIn);
    membershipRow = { role: 'member' };
    assertBoardAccess.mockResolvedValue(name === 'leaveBoard' ? 'member' : 'owner');
    await call();
    expect(publish).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({ type: 'member.removed' }),
    );
  });

  // Transfer moves two rows, so it says so twice rather than inventing a
  // fourth event for a case the other three already describe.
  test('a transfer announces both role changes', async () => {
    authMock.mockResolvedValue(signedIn);
    boardRow = { name: 'Roadmap' };
    membershipRow = { role: 'member' };
    await transferOwnership({
      boardId: 'board-1',
      userId: 'user-2',
      confirmName: 'Roadmap',
      mutationId: MUTATION_ID,
    });
    expect(publish).toHaveBeenNthCalledWith(
      1,
      'board-1',
      expect.objectContaining({ type: 'member.updated', userId: 'user-2', role: 'owner' }),
    );
    expect(publish).toHaveBeenNthCalledWith(
      2,
      'board-1',
      expect.objectContaining({ type: 'member.updated', userId: 'owner-1', role: 'member' }),
    );
  });

  test('inviting and revoking announce nothing, because only the owner sees them', async () => {
    authMock.mockResolvedValue(signedIn);
    await inviteMember(invite);
    inviteRow = { id: 'invite-1', boardId: 'board-1' };
    await revokeInvite({ inviteId: 'invite-1' });
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/unit.log
```

Expected: FAIL — `publish` was not called.

- [ ] **Step 3: Add the events and publish them**

In `lib/events.ts`, add the three union members alongside the twelve already there. Import `BoardRole` as a type from `@/lib/permissions` — a value import would be a cycle, since `permissions` imports `db`.

In `lib/actions/members.ts`, add `mutationId: z.string().min(1)` to the schemas of `changeRole`, `removeMember`, `leaveBoard` and `transferOwnership`. **Not** to `inviteMember` or `revokeInvite`, which publish nothing, and **not** to `acceptInvite`: it is called from `/boards`, which has no `RealtimeProvider` and therefore no `claim()`, and the accepting user is not subscribed to that board's channel yet, so there is no echo of their own to suppress. `acceptInvite` generates its own with `crypto.randomUUID()` and says why on the line above.

**Adding `mutationId` breaks the tests A5 and A6 wrote.** `changeRole`, `removeMember`, `leaveBoard` and `transferOwnership` now answer `INVALID` without it. Add `mutationId: MUTATION_ID` to every existing call of those four in this file as part of this step — the failures are the point at which you notice, not a surprise.

Then call `publish` **after** each transaction resolves:

```ts
await publish(invite.boardId, {
  type: 'member.added',
  userId,
  role: invite.role,
  mutationId: parsed.data.mutationId,
  actorId: userId,
});
```

`changeRole` and `removeMember` follow the same shape with `actorId: session.user.id`. `transferOwnership` publishes twice after its transaction: the target as `owner`, then the caller as `member`.

Publishing inside a transaction would announce a write that may still roll back, which is why every call sits after it.

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/actions/members.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 29 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts lib/actions/members.ts lib/actions/members.test.ts
git commit -m "feat: announce a membership change on the board channel"
```

### Task D2: Delivering them, and acting on your own

**Files:**
- Modify: `components/board/realtime.tsx`, `components/board/members-dialog.tsx`
- Create: `components/board/membership-watch.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`, `lib/events.test.ts`

**Interfaces:**
- Consumes: `subscribe` and `claim` from `RealtimeContext`.
- Produces:
  ```ts
  export function MembershipWatch({ viewerId }: { viewerId: string }): null;
  ```

- [ ] **Step 1: Write the failing test**

`lib/events.test.ts` already asserts things about the event surface. Add the check that catches the failure mode CLAUDE.md warns about — an event in the union that nothing listens for:

```ts
test('every event the server can publish is one the client binds', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync('components/board/realtime.tsx', 'utf8'),
  );
  const bound = source.slice(source.indexOf('EVENT_NAMES'), source.indexOf('CLAIM_MEMORY'));

  for (const name of [
    'card.created', 'card.updated', 'card.moved', 'card.deleted',
    'column.created', 'column.updated', 'column.moved', 'column.deleted',
    'comment.created', 'comment.created.truncated', 'comment.updated', 'comment.deleted',
    'member.added', 'member.updated', 'member.removed',
  ]) {
    expect(bound, `${name} is published but never delivered`).toContain(`'${name}'`);
  }
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/events.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `member.added is published but never delivered`.

- [ ] **Step 3: Bind the names and watch for your own**

Add the three names to `EVENT_NAMES` in `components/board/realtime.tsx`.

Create `components/board/membership-watch.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useRealtime } from '@/components/board/realtime';

export function MembershipWatch({ viewerId }: { viewerId: string }) {
  const { subscribe } = useRealtime();
  const router = useRouter();

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'member.removed' && event.userId === viewerId) {
          router.replace('/boards');
          return;
        }
        // A role change is re-read from the server rather than patched here:
        // canWrite is computed in the layout from the role it just fetched, so
        // a refresh is what makes the board stop offering writes it cannot do.
        if (
          (event.type === 'member.updated' || event.type === 'member.added') &&
          event.userId === viewerId
        ) {
          router.refresh();
        }
      }),
    [subscribe, router, viewerId],
  );

  return null;
}
```

`useRealtime` is the consumer hook that file exports (verified at `components/board/realtime.tsx:145`); it returns `{ subscribe, claim, status, reconnected }`.

Mount it in the board layout inside `RealtimeProvider`:

```tsx
<MembershipWatch viewerId={session.user.id} />
```

In `members-dialog.tsx`, subscribe to the same context and `router.refresh()` on any event whose type starts with `member.`, so an open dialog stops showing a membership that has changed underneath it. Every action in the dialog must now pass a `mutationId` — generate it with the context's `claim()`, exactly as the card and comment actions do, or your own change will come back as an echo and refresh the dialog under your hands.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec vitest run lib/events.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `=0`.

- [ ] **Step 5: Commit**

```bash
git add components/board/realtime.tsx components/board/membership-watch.tsx components/board/members-dialog.tsx "app/(app)/(board)/boards/[boardId]/layout.tsx" lib/events.test.ts
git commit -m "feat: act on a membership change while the board is open"
```

### Task D3: Two live clients, and the Section D pull request

**Files:**
- Modify: `e2e/members.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('a demotion takes the write controls away without a reload', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const member = await seedSession(memberContext);
  const boardId = await seedBoard(owner.userId, 'Live roles');
  await seedMember(boardId, member.userId, 'member');

  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/boards/${boardId}`);
    await expect(memberPage.getByRole('button', { name: 'New card' })).toBeVisible();

    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByLabel('Role for Test User').selectOption('viewer');

    await expect(memberPage.getByRole('button', { name: 'New card' })).toBeHidden();
  } finally {
    await removeSeededUser(member.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await memberContext.close();
  }
});

test('a removal sends the removed member back to the board list', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const member = await seedSession(memberContext);
  const boardId = await seedBoard(owner.userId, 'Live removal');
  await seedMember(boardId, member.userId, 'member');

  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/boards/${boardId}`);

    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByRole('button', { name: 'Remove' }).click();

    await memberPage.waitForURL('**/boards');
  } finally {
    await removeSeededUser(member.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await memberContext.close();
  }
});
```

These two need real Pusher credentials in `.env.local`. `e2e/realtime.spec.ts` already depends on them; follow whatever skip guard that file uses rather than inventing a second convention, and say in the PR whether they ran or were skipped.

- [ ] **Step 2: Run the whole suite**

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/e2e.log
```

Expected: `EXIT=0`, count run equal to count collected.

- [ ] **Step 3: Update the documentation this section invalidates**

- `CLAUDE.md`, "Realtime": "Events, all twelve" becomes fifteen, and the three names join the list.
- `CLAUDE.md`, "Open decisions": member management is resolved; replace the account-deletion entry's "there is no ownership transfer until member management lands" with what now exists.

- [ ] **Step 4: Verify by hand, then screenshot**

Two real accounts, two browsers: demote one and watch "New card" disappear without a reload; remove them and watch the tab land on `/boards`. Confirm the removed tab's status strip goes to `failed` if it reconnects — `/api/pusher/auth` re-checks membership on every subscribe. Close everything you opened.

- [ ] **Step 5: Commit and open the Section D pull request**

```bash
git add e2e/members.spec.ts CLAUDE.md docs/plans/member-management.md
git commit -m "docs: record fifteen events and the invite flow that exists"
git push -u origin feat/members-realtime
```

PR base `main`. The body states which of the two live tests ran and which were skipped for missing credentials, and carries the hand-verification from Step 4. Then run `/superpowers:review` over the whole sub-project before considering it finished.
