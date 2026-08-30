# Boards & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boards that belong to someone — three tables, one authorisation function every later action calls, a board list you can create, rename and delete from, and a permission-checked board route showing the five seeded columns.

**Architecture:** `assertBoardAccess(userId, boardId, minRole)` asks one question of `board_members` and throws `BoardAccessError`; Server Components let it reach `notFound()`, actions convert it to the repository's discriminated result. Board creation writes the board, its `owner` membership row and five fractionally-ranked columns in one transaction. Reads are Server Components; there is no realtime and no client cache in this sub-project.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Drizzle ORM + drizzle-kit, Postgres (Neon dev branch locally, docker Postgres in CI), Zod 4, `fractional-indexing` 4, Tailwind v4 + re-tokenised shadcn/ui, Vitest, Playwright.

**Spec:** `docs/specs/boards.md` — read it before Task 1. This plan argues from it and does not repeat its reasoning.

## Global Constraints

Copied from `CLAUDE.md` and `docs/specs/boards.md`. Every task's requirements implicitly include these.

- **Never assume — prove it.** Do not claim a test passes, a migration applied, or a page renders without having run it and read the output.
- **TDD, red then green.** Write the test, run it, watch it fail for the stated reason, then write the minimal implementation. Never backfill a test.
- **Before any push:** `pnpm typecheck && pnpm lint && pnpm test` — and `pnpm test:e2e` for any task that touches a route.
- **Server action shape, exactly:** session → Zod `safeParse` → `assertBoardAccess` → transaction → `{ ok: true, data } | { ok: false, error }`. Actions never throw for expected failures.
- **Never inline a membership query** in an action or a page. Access questions go through `lib/permissions.ts`.
- **Never trust `boardId` or `userId` from the client for authorisation.** Derive the user from the session.
- **No `any`, no non-null assertions to silence the compiler, no `@ts-expect-error`** without an explanation on the line above.
- **No unnecessary comments.** Comment a non-obvious decision, never what the code plainly says.
- **Copy:** active voice, sentence case, no filler. A control says what happens ("Create board", not "Submit"). The name survives the flow. Empty states are invitations, errors say what happened and what to do, and never apologise.
- **Colour:** three roles only — flow (column hue), accent (`--flow-mid`, the only teal), time (the only warm colour, due dates only). No fourth role, no new gradient beyond the column rule and header wash.
- **Ordering is fractional ranks only.** `text` ranks via `lib/rank.ts`. Never integer positions, never renumber siblings.
- **Dark and light both ship**, driven by `data-theme` on `<html>`. Every colour comes from a token.
- **Commit granularity:** one concern per commit, imperative subject, each commit leaves the app working. One section, one branch, one PR.
- **Model:** implementation and per-task review on Sonnet; the final whole-branch review on Opus. Pass the model explicitly when dispatching.

---

## File structure

| File | Responsibility | Section |
|---|---|---|
| `lib/rank.ts` | `rankBetween`, `seedRanks`. The only ordering mechanism in the codebase | A |
| `lib/rank.test.ts` | Ordering properties, not the library's internals | A |
| `lib/db/schema.ts` | Modify: `boardRole` enum, `boards`, `boardMembers`, `columns`, and their relations | A |
| `lib/db/schema.test.ts` | Modify: pin the new table and column names alongside the adapter's | A |
| `lib/db/index.ts` | Modify: pass `schema` to `drizzle()` so `db.query.*` exists | A |
| `lib/db/migrations/0001_*.sql` | Generated. Never hand-edited | A |
| `lib/permissions.ts` | `atLeast`, `BoardAccessError`, `assertBoardAccess`, `boardAccessResult`. The single source of truth for access | B |
| `lib/permissions.test.ts` | The ladder, both throws, and the pass-through in `boardAccessResult` | B |
| `lib/actions/boards.ts` | `createBoard`, `renameBoard`, `deleteBoard` | B |
| `lib/board-defaults.ts` | `DEFAULT_COLUMN_NAMES`. Separate because a `'use server'` module may export only async functions | B |
| `lib/actions/boards.test.ts` | Validation boundaries, the seeded transaction, the typed-name check | B |
| `lib/boards.ts` | Reads: `listBoardsForUser`, `getBoardWithColumns` | C, D |
| `components/ui/dialog.tsx` | shadcn primitive, re-tokenised | C |
| `components/boards/board-list.tsx` | The list, its rows, its empty state | C |
| `components/boards/new-board-dialog.tsx` | Create | C |
| `components/boards/board-row-menu.tsx` | Rename dialog and the name-typed delete confirm | C |
| `app/(app)/(chrome)/boards/page.tsx` | The list route. Keeps the footer and normal scroll | C |
| `app/(app)/(chrome)/layout.tsx` | Renders `SiteFooter` | D |
| `app/(app)/(board)/layout.tsx` | Fixed viewport, no footer | D |
| `app/(app)/(board)/boards/[boardId]/page.tsx` | The read-only board shell | D |
| `components/board/column-shell.tsx` | One empty column: flow rule, hue wash, header | D |
| `app/layout.tsx` | Modify: stop rendering `SiteFooter` | D |
| `components/app/top-bar.tsx` | Modify: optional board title | D |
| `e2e/support/session.ts` | Modify: `seedBoard`, `seedMember` | C |
| `e2e/boards.spec.ts` | List, create, rename, delete | C |
| `e2e/board-view.spec.ts` | The 404, the five columns, the footer's absence | D |

### Two decisions settled while writing this plan

The spec fixes the behaviour; these fix the mechanism, and are recorded so they are not rediscovered.

**1. `db.query.*` is enabled, and that is what makes the ladder unit-testable.** `lib/db/index.ts` currently calls `drizzle({ client: pool })` with no schema, so Drizzle's relational query API does not exist. Task 2 passes the schema. The payoff is in Task 3: a test can mock `@/lib/db` as `{ query: { boardMembers: { findFirst } } }` — a plain object — instead of mocking a chained `select().from().where()` builder, which is where mocked-ORM tests usually become a test of the mock. `app/api/health/route.test.ts` already establishes mocking `@/lib/db` as the house pattern.

**2. The footer moves out of the root layout into two route groups.** `SiteFooter` renders in `app/layout.tsx` today, so no child layout can remove it — a layout cannot un-render its parent. Nested route groups can: `app/(app)/(chrome)/` keeps the footer and normal scroll, `app/(app)/(board)/` is the fixed-viewport board. Both still map to `/boards` and `/boards/[boardId]` — a route group contributes no URL segment. Rejected: a client component reading `usePathname()` to hide the footer, which turns a static server-rendered footer into client JS on every route to solve a routing problem with state.

---

## Section A — Schema, migration, and the rank helper

Branch: `feat/boards-schema`.

### Task 1: The rank helper

**Files:**
- Create: `lib/rank.ts`
- Create: `lib/rank.test.ts`
- Modify: `package.json` (add `fractional-indexing`)

**Interfaces:**
- Consumes: nothing.
- Produces: `rankBetween(a: string | null, b: string | null): string` and `seedRanks(count: number): string[]`. Task 4 (`createBoard`) and all of sub-project 4 depend on these names.

`fractional-indexing@4.0.0` is ESM-only (`"type": "module"`) and exports `generateKeyBetween(a, b, digits?, intDigits?)` and `generateNKeysBetween(a, b, n, digits?, intDigits?)`. With the alphabet omitted, keys take the `a0`, `a1`, `a2` form. Both facts are read from the published `src/index.d.ts`, not assumed.

- [x] **Step 1: Add the dependency**

```bash
pnpm add fractional-indexing@4.0.0
```

- [x] **Step 2: Write the failing test**

`lib/rank.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { rankBetween, seedRanks } from './rank';

describe('seedRanks', () => {
  test('returns the requested number of keys in ascending order', () => {
    const ranks = seedRanks(5);

    expect(ranks).toHaveLength(5);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(5);
  });

  test('returns nothing for a count of zero', () => {
    expect(seedRanks(0)).toEqual([]);
  });
});

describe('rankBetween', () => {
  test('sorts strictly between its neighbours', () => {
    const [first, second] = seedRanks(2);

    const middle = rankBetween(first, second);

    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
  });

  test('extends past either end', () => {
    const [only] = seedRanks(1);

    expect(rankBetween(null, only) < only).toBe(true);
    expect(rankBetween(only, null) > only).toBe(true);
  });
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm test lib/rank.test.ts`
Expected: FAIL — `Failed to resolve import "./rank"`.

- [x] **Step 4: Write the implementation**

`lib/rank.ts`:

```ts
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export const rankBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);

export const seedRanks = (count: number) => generateNKeysBetween(null, null, count);
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/rank.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/rank.ts lib/rank.test.ts
git commit -m "feat: add the fractional rank helper"
```

### Task 2: The three tables and the migration

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/schema.test.ts`
- Modify: `lib/db/index.ts`
- Create: `lib/db/migrations/0001_*.sql` (generated)

**Interfaces:**
- Consumes: `users` from the existing schema.
- Produces: `boardRole`, `boards`, `boardMembers`, `columns`, and a `db` whose `db.query.boards` / `db.query.boardMembers` / `db.query.columns` exist. Tasks 3–8 depend on all of it.

- [x] **Step 1: Write the failing test**

Append to `lib/db/schema.test.ts`. The existing file pins the adapter's names because a rename breaks its queries silently; these pins exist for a different reason — the migration is generated from them, so a rename is a schema change nobody reviewed.

```ts
import { boardMembers, boardRole, boards, columns } from './schema';

describe('board tables', () => {
  test('use snake_case names of our own, not the adapter dialect', () => {
    expect(getTableName(boards)).toBe('boards');
    expect(getTableName(boardMembers)).toBe('board_members');
    expect(getTableName(columns)).toBe('columns');
  });

  test('key membership off the text user id the adapter defines', () => {
    expect(boardMembers.userId.columnType).toBe('PgText');
    expect(boards.ownerId.columnType).toBe('PgText');
  });

  test('constrain the role to the three roles CLAUDE.md defines', () => {
    expect(boardRole.enumValues).toEqual(['owner', 'member', 'viewer']);
  });
});
```

`getTableName` comes from `drizzle-orm`; add it to the file's existing imports.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/db/schema.test.ts`
Expected: FAIL — `boards` is not exported from `./schema`.

- [x] **Step 3: Write the schema**

Append to `lib/db/schema.ts`, and add `pgEnum` to the `drizzle-orm/pg-core` import and `relations` from `drizzle-orm`:

```ts
export const boardRole = pgEnum('board_role', ['owner', 'member', 'viewer']);

export const boards = pgTable('boards', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const boardMembers = pgTable(
  'board_members',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: boardRole('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('board_members_user_id_idx').on(t.userId),
  ],
);

export const columns = pgTable(
  'columns',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rank: text('rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('columns_board_id_rank_idx').on(t.boardId, t.rank)],
);

export const boardsRelations = relations(boards, ({ many }) => ({
  members: many(boardMembers),
  columns: many(columns),
}));

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  board: one(boards, { fields: [boardMembers.boardId], references: [boards.id] }),
}));

export const columnsRelations = relations(columns, ({ one }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
}));
```

- [x] **Step 4: Give the client its schema**

`lib/db/index.ts` — the relational query API needs it, and Task 3's test mocks the shape it exposes:

```ts
import * as schema from './schema';

export const db = drizzle({ client: pool, schema });
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/db/schema.test.ts`
Expected: PASS. Then `pnpm typecheck` — expected exit 0.

- [x] **Step 6: Generate the migration**

```bash
pnpm db:generate
```

Read the generated SQL before going on. Expected: one `CREATE TYPE "public"."board_role"`, three `CREATE TABLE`s, the two indexes, and four foreign keys — `boards.owner_id → user`, `board_members.board_id → boards`, `board_members.user_id → user`, `columns.board_id → boards`. The `relations()` helpers emit no SQL. Never hand-edit it. If it contains anything else, stop — the schema is wrong, not the migration.

- [x] **Step 7: Apply it to the dev branch and prove it**

```bash
pnpm db:migrate
```

Then confirm the tables exist rather than assuming the command's success line:

```bash
pnpm db:studio   # or psql "$DATABASE_URL_UNPOOLED" -c '\dt'
```

Expected: `boards`, `board_members`, `columns` alongside the three auth tables. Shut `db:studio` down afterwards.

- [x] **Step 8: Commit**

```bash
git add lib/db/schema.ts lib/db/schema.test.ts lib/db/index.ts lib/db/migrations
git commit -m "feat: add boards, board_members and columns"
```

### Section A gate

- [x] `pnpm typecheck && pnpm lint && pnpm test` pass, output observed.
- [x] The generated SQL was read, not just generated.
- [x] CI is green on the PR — that is what proves the migration applies to an empty database, since the workflow runs `pnpm db:migrate` against a throwaway Postgres before the test steps.
- [ ] **Production is migrated by hand when this merges:** `DATABASE_URL_UNPOOLED=<production> pnpm db:migrate`, then confirm the three tables exist against production. Vercel deploys from the push to `main`, so CI cannot gate this.
- [ ] Open the PR. Stop. Start Section B in a fresh session.

---

## Section B — Permissions and the three actions

Branch: `feat/boards-permissions`. No UI in this section; nothing a user can see changes.

### Task 3: `lib/permissions.ts`

**Files:**
- Create: `lib/permissions.ts`
- Create: `lib/permissions.test.ts`

**Interfaces:**
- Consumes: `db` (with `db.query.boardMembers`) and `boardRole` from Task 2.
- Produces:
  - `type BoardRole = 'owner' | 'member' | 'viewer'` (derived from `boardRole.enumValues`)
  - `atLeast(role: BoardRole, min: BoardRole): boolean`
  - `class BoardAccessError extends Error` with `readonly reason: 'FORBIDDEN' | 'NOT_FOUND'`
  - `assertBoardAccess(userId: string, boardId: string, minRole: BoardRole): Promise<BoardRole>`
  - `boardAccessResult(error: unknown): { ok: false; error: 'FORBIDDEN' | 'NOT_FOUND' }` — rethrows anything else
- Every action in Tasks 4 and 5, and both routes in Sections C and D, call these.

- [ ] **Step 1: Write the failing test**

`lib/permissions.test.ts`. Note what is being mocked: `db.query.boardMembers.findFirst`, a plain function on a plain object. This is why Task 2 gave the client its schema.

```ts
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
```

The fourth test is the one that pins the spec's 404 decision: one query, and it is about membership, not existence. If someone later adds an existence check to distinguish 403 from 404, this test fails and the review question gets asked.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/permissions.test.ts`
Expected: FAIL — `Failed to resolve import "./permissions"`.

- [ ] **Step 3: Write the implementation**

`lib/permissions.ts`:

```ts
import { db } from '@/lib/db';
import { boardRole } from '@/lib/db/schema';

export type BoardRole = (typeof boardRole.enumValues)[number];

const LADDER: Record<BoardRole, number> = { viewer: 0, member: 1, owner: 2 };

export function atLeast(role: BoardRole, min: BoardRole): boolean {
  return LADDER[role] >= LADDER[min];
}

export class BoardAccessError extends Error {
  constructor(readonly reason: 'FORBIDDEN' | 'NOT_FOUND') {
    super(reason);
    this.name = 'BoardAccessError';
  }
}

// Asks only whether the caller is on the board, never whether the board exists:
// a 403 would confirm a guessed id is real.
export async function assertBoardAccess(
  userId: string,
  boardId: string,
  minRole: BoardRole,
): Promise<BoardRole> {
  const membership = await db.query.boardMembers.findFirst({
    where: (member, { and, eq }) => and(eq(member.boardId, boardId), eq(member.userId, userId)),
    columns: { role: true },
  });

  if (!membership) throw new BoardAccessError('NOT_FOUND');
  if (!atLeast(membership.role, minRole)) throw new BoardAccessError('FORBIDDEN');

  return membership.role;
}

export function boardAccessResult(error: unknown) {
  if (error instanceof BoardAccessError) {
    return { ok: false, error: error.reason } as const;
  }
  throw error;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/permissions.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions.ts lib/permissions.test.ts
git commit -m "feat: add the board permission ladder"
```

### Task 4: `createBoard`

**Files:**
- Modify: `lib/actions/boards.ts` (create — the directory exists, holding `session.ts`)
- Create: `lib/board-defaults.ts`
- Create: `lib/actions/boards.test.ts`
- Modify: `package.json` (add `zod`)

`DEFAULT_COLUMN_NAMES` lives in its own plain module, **not** in the action file: a `'use server'` module may only export async functions, so a `const` array there is a build error. The Playwright seed helper in Task 6 imports it too, and cannot import a server-action module at all.

**Interfaces:**
- Consumes: `seedRanks` (Task 1), the tables (Task 2), `auth` from `lib/auth.ts`.
- Produces: `createBoard(input: unknown): Promise<{ ok: true; data: { id: string } } | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' }>`, and `DEFAULT_COLUMN_NAMES: readonly string[]` from `lib/board-defaults.ts`. Task 7's dialog calls the action; Task 6's seed helper and Section D's e2e use the names.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add zod@4.5.4
```

- [ ] **Step 2: Write the failing test**

`lib/actions/boards.test.ts`. The transaction is mocked by handing the callback a `tx` that records what it was asked to insert — that is what makes the seeded-columns and one-owner-row claims testable without a database.

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Insert = { table: string; values: unknown };
const inserts: Insert[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find(
    (s) => s.description === 'drizzle:Name',
  );
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const tx = {
  insert: (table: unknown) => ({
    values: (values: unknown) => ({
      returning: async () => {
        inserts.push({ table: tableName(table), values });
        return [{ id: 'board-1', name: (values as { name: string }).name }];
      },
      then: (resolve: (v: unknown) => unknown) => {
        inserts.push({ table: tableName(table), values });
        return Promise.resolve(resolve(undefined));
      },
    }),
  }),
};

vi.mock('@/lib/db', () => ({
  db: { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { createBoard } = await import('./boards');
const { DEFAULT_COLUMN_NAMES } = await import('@/lib/board-defaults');

beforeEach(() => {
  inserts.length = 0;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('createBoard', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);

    await expect(createBoard({ name: 'Roadmap' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('refuses an empty name', async () => {
    await expect(createBoard({ name: '   ' })).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a name over eighty characters', async () => {
    await expect(createBoard({ name: 'x'.repeat(81) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('writes the board, one owner row, and the five seeded columns', async () => {
    const result = await createBoard({ name: '  Roadmap  ' });

    expect(result).toEqual({ ok: true, data: { id: 'board-1' } });

    const board = inserts.find((i) => i.table === 'boards');
    expect(board?.values).toMatchObject({ name: 'Roadmap', ownerId: 'user-1' });

    const members = inserts.find((i) => i.table === 'board_members');
    expect(members?.values).toEqual({ boardId: 'board-1', userId: 'user-1', role: 'owner' });

    const seeded = inserts.find((i) => i.table === 'columns')?.values as {
      name: string;
      rank: string;
    }[];
    expect(seeded.map((c) => c.name)).toEqual(DEFAULT_COLUMN_NAMES);
    expect(seeded.map((c) => c.rank)).toEqual([...seeded.map((c) => c.rank)].sort());
  });

  test('seeds the columns CLAUDE.md names, in order', () => {
    expect(DEFAULT_COLUMN_NAMES).toEqual([
      'Ready to Work',
      'In Progress',
      'In Testing',
      'In Review',
      'Done',
    ]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test lib/actions/boards.test.ts`
Expected: FAIL — `Failed to resolve import "./boards"`.

- [ ] **Step 4: Write the implementation**

`lib/board-defaults.ts`:

```ts
export const DEFAULT_COLUMN_NAMES = [
  'Ready to Work',
  'In Progress',
  'In Testing',
  'In Review',
  'Done',
] as const;
```

`lib/actions/boards.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { DEFAULT_COLUMN_NAMES } from '@/lib/board-defaults';
import { db } from '@/lib/db';
import { boardMembers, boards, columns } from '@/lib/db/schema';
import { seedRanks } from '@/lib/rank';

const boardName = z.string().trim().min(1).max(80);

const createSchema = z.object({ name: boardName });

export async function createBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const ownerId = session.user.id;
  const ranks = seedRanks(DEFAULT_COLUMN_NAMES.length);

  const board = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(boards)
      .values({ name: parsed.data.name, ownerId })
      .returning();

    await tx.insert(boardMembers).values({ boardId: created.id, userId: ownerId, role: 'owner' });
    await tx.insert(columns).values(
      DEFAULT_COLUMN_NAMES.map((name, position) => ({
        boardId: created.id,
        name,
        rank: ranks[position],
      })),
    );

    return created;
  });

  revalidatePath('/boards');
  return { ok: true, data: { id: board.id } } as const;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/actions/boards.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/board-defaults.ts lib/actions/boards.ts lib/actions/boards.test.ts
git commit -m "feat: create a board with its owner and seeded columns"
```

### Task 5: `renameBoard` and `deleteBoard`

**Files:**
- Modify: `lib/actions/boards.ts`
- Modify: `lib/actions/boards.test.ts`

**Interfaces:**
- Consumes: `assertBoardAccess`, `boardAccessResult` (Task 3).
- Produces:
  - `renameBoard(input: unknown): Promise<{ ok: true } | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' }>`
  - `deleteBoard(input: unknown): Promise<{ ok: true } | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'NAME_MISMATCH' }>`
- Task 8's menu calls both.

- [ ] **Step 1: Write the failing test**

Append to `lib/actions/boards.test.ts`. Extend the file's existing imports with `deleteBoard, renameBoard` from `./boards` and `BoardAccessError` from `@/lib/permissions`, and extend the `@/lib/db` mock with the query and mutation surfaces these two need:

```ts
const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

describe('renameBoard', () => {
  test('requires member, not viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));

    await expect(renameBoard({ boardId: 'b1', name: 'New name' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('trims and writes the new name', async () => {
    assertBoardAccess.mockResolvedValue('member');

    await expect(renameBoard({ boardId: 'b1', name: '  Renamed  ' })).resolves.toEqual({ ok: true });
    expect(updated).toEqual({ id: 'b1', name: 'Renamed' });
  });
});

describe('deleteBoard', () => {
  test('requires owner', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'owner');
  });

  test('refuses when the typed name does not match, so the dialog is not the only guard', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'roadmap' })).resolves.toEqual({
      ok: false,
      error: 'NAME_MISMATCH',
    });
    expect(deleted).toBeNull();
  });

  test('deletes when the typed name matches exactly', async () => {
    assertBoardAccess.mockResolvedValue('owner');
    boardRow = { name: 'Roadmap' };

    await expect(deleteBoard({ boardId: 'b1', confirmName: 'Roadmap' })).resolves.toEqual({
      ok: true,
    });
    expect(deleted).toBe('b1');
  });
});
```

The mock file-level state these use — `updated`, `deleted`, `boardRow` — is recorded by extending the existing `@/lib/db` mock:

```ts
let boardRow: { name: string } | undefined;
let updated: { id: string; name: string } | null = null;
let deleted: string | null = null;

vi.mock('@/lib/db', () => ({
  db: {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    query: { boards: { findFirst: async () => boardRow } },
    update: () => ({
      set: (values: { name: string }) => ({
        where: async () => {
          updated = { id: 'b1', name: values.name };
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deleted = 'b1';
      },
    }),
  },
}));
```

Reset `boardRow`, `updated` and `deleted` in the existing `beforeEach`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/boards.test.ts`
Expected: FAIL — `renameBoard is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/actions/boards.ts`:

```ts
const renameSchema = z.object({ boardId: z.string().min(1), name: boardName });
const deleteSchema = z.object({ boardId: z.string().min(1), confirmName: z.string() });

export async function renameBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.update(boards).set({ name: parsed.data.name }).where(eq(boards.id, parsed.data.boardId));

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function deleteBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Re-checked here because a client can skip the dialog that asked for it.
  const board = await db.query.boards.findFirst({
    where: (b, { eq: equals }) => equals(b.id, parsed.data.boardId),
    columns: { name: true },
  });
  if (!board || board.name !== parsed.data.confirmName.trim()) {
    return { ok: false, error: 'NAME_MISMATCH' } as const;
  }

  await db.delete(boards).where(eq(boards.id, parsed.data.boardId));

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

Add `eq` to the `drizzle-orm` imports and `assertBoardAccess, boardAccessResult` to the `@/lib/permissions` import.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/actions/boards.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/boards.ts lib/actions/boards.test.ts
git commit -m "feat: rename and delete a board"
```

### Section B gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass, output observed.
- [ ] No action inlines a membership query; every access question goes through `assertBoardAccess`.
- [ ] Nothing user-visible changed — `/boards` is still the placeholder. Say so in the PR rather than implying a feature landed.
- [ ] Open the PR. Stop. Start Section C in a fresh session.

---

## Section C — The board list

Branch: `feat/boards-list`.

**Invoke the `frontend-design` skill before Task 6's implementation step**, per `CLAUDE.md`. It has not run for this sub-project yet; the spec deliberately did not invoke it.

### Task 6: The list, and the seed helpers that prove it

**Files:**
- Create: `lib/boards.ts`
- Create: `components/boards/board-list.tsx`
- Modify: `app/(app)/boards/page.tsx` → moves to `app/(app)/(chrome)/boards/page.tsx` in Task 9; leave it where it is for now
- Modify: `e2e/support/session.ts`
- Create: `e2e/boards.spec.ts`

**Interfaces:**
- Consumes: the tables (Task 2), `DEFAULT_COLUMN_NAMES` (Task 4).
- Produces:
  - `listBoardsForUser(userId: string): Promise<{ id: string; name: string; role: BoardRole; updatedAt: Date }[]>`, `updatedAt` descending
  - `seedBoard(ownerId: string, name?: string): Promise<string>` returning the board id, and `seedMember(boardId: string, userId: string, role: BoardRole): Promise<void>`
- Task 7 and Task 8 render inside this list; Section D's e2e uses both helpers.

- [ ] **Step 1: Write the seed helpers**

Append to `e2e/support/session.ts`. It talks to Postgres directly rather than through Drizzle, matching how `seedSession` already works, and it cannot import `lib/actions/boards.ts` — that is a server-action module.

```ts
import { generateNKeysBetween } from 'fractional-indexing';
import { DEFAULT_COLUMN_NAMES } from '../../lib/board-defaults';

export async function seedBoard(ownerId: string, name = 'Seeded board'): Promise<string> {
  const boardId = crypto.randomUUID();
  const ranks = generateNKeysBetween(null, null, DEFAULT_COLUMN_NAMES.length);

  await pool.query('insert into boards (id, name, owner_id) values ($1, $2, $3)', [
    boardId,
    name,
    ownerId,
  ]);
  await pool.query(
    'insert into board_members (board_id, user_id, role) values ($1, $2, $3)',
    [boardId, ownerId, 'owner'],
  );
  for (const [position, columnName] of DEFAULT_COLUMN_NAMES.entries()) {
    await pool.query('insert into columns (id, board_id, name, rank) values ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      boardId,
      columnName,
      ranks[position],
    ]);
  }

  return boardId;
}

export async function seedMember(
  boardId: string,
  userId: string,
  role: 'owner' | 'member' | 'viewer',
): Promise<void> {
  await pool.query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [
    boardId,
    userId,
    role,
  ]);
}
```

No new cleanup: `boards.owner_id` cascades from `user`, so the existing `removeSeededUser` takes seeded boards, memberships and columns with it.

- [ ] **Step 2: Write the failing test**

`e2e/boards.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('an empty board list invites you to create one', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');

  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();

  await removeSeededUser(userId);
});

test('the list shows the boards you are a member of', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');

  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeHidden();

  await removeSeededUser(userId);
});

test('someone else’s board never appears in your list', async ({ page, context }) => {
  const owner = await seedSession(context);
  await seedBoard(owner.userId, 'Not yours');
  await context.clearCookies();
  const viewer = await seedSession(context);

  await page.goto('/boards');

  await expect(page.getByText('Not yours')).toBeHidden();

  await removeSeededUser(owner.userId);
  await removeSeededUser(viewer.userId);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: FAIL — the page still renders the "Nothing here yet" placeholder, so neither the heading nor the link is found.

- [ ] **Step 4: Write the read**

`lib/boards.ts`:

```ts
import { db } from '@/lib/db';
import type { BoardRole } from '@/lib/permissions';

export type BoardSummary = {
  id: string;
  name: string;
  role: BoardRole;
  updatedAt: Date;
};

export async function listBoardsForUser(userId: string): Promise<BoardSummary[]> {
  const memberships = await db.query.boardMembers.findMany({
    where: (member, { eq }) => eq(member.userId, userId),
    columns: { role: true },
    with: { board: { columns: { id: true, name: true, updatedAt: true } } },
  });

  return memberships
    .map(({ role, board }) => ({ id: board.id, name: board.name, role, updatedAt: board.updatedAt }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
```

- [ ] **Step 5: Write the list**

`components/boards/board-list.tsx` — a Server Component, no `'use client'`:

```tsx
import Link from 'next/link';
import type { BoardSummary } from '@/lib/boards';

export function BoardList({ boards }: { boards: BoardSummary[] }) {
  return (
    <ul className="divide-y divide-line rounded-[10px] border border-line bg-surface">
      {boards.map((board) => (
        <li key={board.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href={`/boards/${board.id}`} className="text-[15px] font-medium text-ink">
            {board.name}
          </Link>
          <div className="flex items-center gap-3">
            {board.role !== 'owner' && (
              <span className="text-xs text-muted">{board.role}</span>
            )}
            <time
              dateTime={board.updatedAt.toISOString()}
              className="font-mono text-xs text-muted"
            >
              {formatUpdated(board.updatedAt)}
            </time>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

`formatUpdated` lives in the same file — it has one caller:

```tsx
const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const;

function formatUpdated(at: Date): string {
  const elapsed = at.getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [unit, milliseconds] of UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return format.format(Math.round(elapsed / milliseconds), unit);
    }
  }
  return format.format(0, 'minute');
}
```

It renders on the server, so the viewer's locale is the server's. That is wrong in the same way every server-rendered relative time is wrong, and it is deliberate here: the alternative is a client component for a timestamp. `CLAUDE.md`'s "render in the viewer's locale" rule falls due for due dates in sub-project 5, where it matters.

`app/(app)/boards/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { BoardList } from '@/components/boards/board-list';
import { auth } from '@/lib/auth';
import { listBoardsForUser } from '@/lib/boards';

export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const boards = await listBoardsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-medium tracking-tight">Boards</h1>
      </div>
      {boards.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-12 text-center">
          <h2 className="text-[22px] font-medium tracking-tight">Create your first board</h2>
        </div>
      ) : (
        <BoardList boards={boards} />
      )}
    </main>
  );
}
```

The "New board" button arrives in Task 7; the empty-state test asserting it will still fail until then, so leave that assertion failing and say so in the commit — or move it into Task 7's step. Do not delete it.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: the two list tests PASS. The empty-state test still fails on the missing button until Task 7.

- [ ] **Step 7: Commit**

```bash
git add lib/boards.ts components/boards/board-list.tsx "app/(app)/boards/page.tsx" e2e/support/session.ts e2e/boards.spec.ts
git commit -m "feat: list the boards you are a member of"
```

### Task 7: Creating a board

**Files:**
- Create: `components/ui/dialog.tsx` (shadcn, re-tokenised)
- Create: `components/boards/new-board-dialog.tsx`
- Modify: `app/(app)/boards/page.tsx`
- Modify: `e2e/boards.spec.ts`

**Interfaces:**
- Consumes: `createBoard` (Task 4).
- Produces: `<NewBoardDialog />`, a client component rendering the "New board" trigger. Task 8 reuses `components/ui/dialog.tsx`.

- [ ] **Step 1: Add the dialog primitive**

```bash
pnpm dlx shadcn@latest add dialog
```

Re-tokenise it exactly as `components/ui/dropdown-menu.tsx` was: modal radius 16, `--surface` background, `--line` border, the 2px accent focus ring at 2px offset. Untouched shadcn is recognisable on sight and undoes the design system.

- [ ] **Step 2: Write the failing test**

Append to `e2e/boards.spec.ts`:

```ts
test('creating a board adds it to the list', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByLabel('Board name').fill('Roadmap');
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();

  await removeSeededUser(userId);
});

test('a board with no name cannot be created', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByText('Enter a name for the board')).toBeVisible();

  await removeSeededUser(userId);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: FAIL — no "New board" button exists.

- [ ] **Step 4: Write the dialog**

`components/boards/new-board-dialog.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createBoard } from '@/lib/actions/boards';

export function NewBoardDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError('Enter a name for the board');
      return;
    }

    startTransition(async () => {
      const result = await createBoard({ name });
      if (!result.ok) {
        setError('That board could not be created. Try again.');
        return;
      }
      setOpen(false);
      setName('');
      setError(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-[8px] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white">
        New board
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New board</DialogTitle>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm text-muted" htmlFor="board-name">
            Board name
          </label>
          <input
            id="board-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2 text-[15px]"
          />
          {error && <p className="text-sm text-time-over">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="rounded-[8px] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
          >
            Create board
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Render `<NewBoardDialog />` twice on the page: in the header row beside the title, and inside the empty state under "Create your first board".

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: PASS, all five tests including Task 6's empty-state test.

- [ ] **Step 6: Commit**

```bash
git add components/ui/dialog.tsx components/boards/new-board-dialog.tsx "app/(app)/boards/page.tsx" e2e/boards.spec.ts
git commit -m "feat: create a board from the list"
```

### Task 8: Renaming and deleting

**Files:**
- Create: `components/boards/board-row-menu.tsx`
- Modify: `components/boards/board-list.tsx`
- Modify: `e2e/boards.spec.ts`

**Interfaces:**
- Consumes: `renameBoard`, `deleteBoard` (Task 5), the dropdown primitive already in `components/ui/dropdown-menu.tsx`, the dialog from Task 7.
- Produces: `<BoardRowMenu board={...} />`, rendered only when `board.role === 'owner'`.

- [ ] **Step 1: Write the failing test**

Append to `e2e/boards.spec.ts`:

```ts
test('renaming a board keeps the new name after a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Board name').fill('Q3 roadmap');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('link', { name: 'Q3 roadmap' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Q3 roadmap' })).toBeVisible();

  await removeSeededUser(userId);
});

test('deleting a board needs its name typed exactly', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  const confirm = page.getByRole('button', { name: 'Delete board' });
  await page.getByLabel('Type the board name to confirm').fill('roadmap');
  await confirm.click();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();

  await page.getByLabel('Type the board name to confirm').fill('Roadmap');
  await confirm.click();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();

  await removeSeededUser(userId);
});
```

The first half of the delete test is the point: a near-miss does not delete. It proves the guard, not the happy path.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: FAIL — no "Board actions for Roadmap" button.

- [ ] **Step 3: Write the menu**

`components/boards/board-row-menu.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteBoard, renameBoard } from '@/lib/actions/boards';
import type { BoardSummary } from '@/lib/boards';

export function BoardRowMenu({ board }: { board: BoardSummary }) {
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(board.name);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    setOpen(null);
    setConfirmName('');
    setError(null);
  }

  function rename(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameBoard({ boardId: board.id, name });
      if (!result.ok) {
        setError('That name could not be saved. Try again.');
        return;
      }
      close();
      router.refresh();
    });
  }

  function remove(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteBoard({ boardId: board.id, confirmName });
      if (!result.ok) {
        setError(
          result.error === 'NAME_MISMATCH'
            ? 'That is not the board name. Type it exactly to delete.'
            : 'That board could not be deleted. Try again.',
        );
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Board actions for ${board.name}`}
          className="rounded-[8px] px-2 py-1 text-muted"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen('delete')}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent>
          <DialogTitle>Rename board</DialogTitle>
          <form onSubmit={rename} className="mt-4 space-y-3">
            <label className="block text-sm text-muted" htmlFor={`rename-${board.id}`}>
              Board name
            </label>
            <input
              id={`rename-${board.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            {error && <p className="text-sm text-time-over">{error}</p>}
            <button type="submit" disabled={pending} className="rounded-[8px] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white">
              Save changes
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'delete'} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent>
          <DialogTitle>Delete {board.name}</DialogTitle>
          <p className="mt-2 text-sm text-muted">
            This deletes the board and everything on it. It cannot be undone.
          </p>
          <form onSubmit={remove} className="mt-4 space-y-3">
            <label className="block text-sm text-muted" htmlFor={`confirm-${board.id}`}>
              Type the board name to confirm
            </label>
            <input
              id={`confirm-${board.id}`}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            {error && <p className="text-sm text-time-over">{error}</p>}
            <button
              type="submit"
              disabled={pending || confirmName.length === 0}
              className="rounded-[8px] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
            >
              Delete board
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

The submit says "Delete board" and the heading names the board, so the copy rule holds: the name survives the flow. The button is enabled as soon as anything is typed — the *server* rejects a mismatch, per Task 5, so a disabled button is a convenience and never the guard.

- [ ] **Step 4: Render it from the row**

In `components/boards/board-list.tsx`, render `<BoardRowMenu board={board} />` in the right-hand group when `board.role === 'owner'`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm test:e2e e2e/boards.spec.ts`
Expected: PASS, seven tests.

- [ ] **Step 6: Commit**

```bash
git add components/boards/board-row-menu.tsx components/boards/board-list.tsx e2e/boards.spec.ts
git commit -m "feat: rename and delete a board from its row"
```

### Section C gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [ ] A near-miss on the delete confirmation does not delete — observed in the e2e run, not inferred from the code.
- [ ] Screenshots of the list, the empty state and the delete confirm, in both themes, attached to the PR. Section C of the Foundation plan shipped without screenshots and its gate stayed unticked; Section C of Auth did not repeat it. Do not restart the habit.
- [ ] Open the PR. Stop. Start Section D in a fresh session.

---

## Section D — The board shell

Branch: `feat/boards-shell`.

### Task 9: The two route groups

**Files:**
- Create: `app/(app)/(chrome)/layout.tsx`
- Create: `app/(app)/(board)/layout.tsx`
- Move: `app/(app)/boards/page.tsx` → `app/(app)/(chrome)/boards/page.tsx`
- Modify: `app/layout.tsx`
- Create: `e2e/board-view.spec.ts`

**Interfaces:**
- Consumes: `SiteFooter`.
- Produces: the two layouts. Task 10's page lives under `(board)`.

Route groups contribute no URL segment, so `(chrome)/boards/page.tsx` is still `/boards` and `(board)/boards/[boardId]/page.tsx` is still `/boards/[boardId]`. The `(app)` layout is the parent of both and keeps the session check. Its `TopBar` moves down into the two groups in Task 10, once there is a title to vary — leave it in place for this task so nothing is half-moved across a commit.

- [ ] **Step 1: Write the failing test**

`e2e/board-view.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('the footer is on the list and gone from the board', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');
  await expect(page.getByRole('contentinfo')).toBeVisible();

  await page.goto(`/boards/${boardId}`);
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeHidden();

  await removeSeededUser(userId);
});
```

The privacy link stays reachable from the account menu — `e2e/shell.spec.ts` already asserts that and must keep passing. Run it in this task too rather than trusting it.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:e2e e2e/board-view.spec.ts`
Expected: FAIL — `/boards/<id>` 404s, because the route does not exist yet.

- [ ] **Step 3: Move the footer out of the root layout**

In `app/layout.tsx`, drop the `<SiteFooter />` and the flex wrapper that positioned it, leaving `{children}` in the body.

`app/(app)/(chrome)/layout.tsx`:

```tsx
import { SiteFooter } from '@/components/site-footer';

export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-49px)] flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
```

`app/(app)/(board)/layout.tsx`:

```tsx
export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-[calc(100vh-49px)] overflow-hidden">{children}</div>;
}
```

`49px` is the top bar's height; take the real value from `components/app/top-bar.tsx` rather than trusting this number, and if it is not 49 use a token or a CSS variable rather than scattering a literal.

The `(auth)` and `(legal)` groups need the footer too — add the same `<SiteFooter />` to their layouts, or create one if they have none. `components/site-footer.test.tsx` and the privacy page test must both still pass.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test:e2e` (the whole suite — this task moves files that every route test touches)
Expected: the footer test PASSes except the board route assertion, which still 404s until Task 10. Every previously passing test still passes.

- [ ] **Step 5: Commit**

```bash
git add app e2e/board-view.spec.ts
git commit -m "refactor: split the app into chrome and board route groups"
```

### Task 10: The board shell

**Files:**
- Create: `app/(app)/(board)/boards/[boardId]/page.tsx`
- Create: `components/board/column-shell.tsx`
- Modify: `lib/boards.ts`
- Modify: `components/app/top-bar.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `e2e/board-view.spec.ts`

**Interfaces:**
- Consumes: `assertBoardAccess` (Task 3), `flowHue` from `lib/flow.ts`.
- Produces: `getBoardWithColumns(boardId: string): Promise<{ id: string; name: string; columns: { id: string; name: string; rank: string }[] } | null>` — `null` when no such board — with columns rank-ascending, and `<ColumnShell name hue nextHue />`. Sub-project 4 fills `ColumnShell` with cards.

- [ ] **Step 1: Write the failing test**

Append to `e2e/board-view.spec.ts`:

```ts
test('the board shows its five seeded columns in order', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  await page.goto(`/boards/${boardId}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
  await expect(page.getByTestId('column-name')).toHaveText([
    'Ready to Work',
    'In Progress',
    'In Testing',
    'In Review',
    'Done',
  ]);

  await removeSeededUser(userId);
});

test('a non-member gets a 404, not a board', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Not yours');
  await context.clearCookies();
  const stranger = await seedSession(context);

  const response = await page.goto(`/boards/${boardId}`);

  expect(response?.status()).toBe(404);
  await expect(page.getByText('Not yours')).toBeHidden();

  await removeSeededUser(owner.userId);
  await removeSeededUser(stranger.userId);
});
```

The second test is the highest-value test in this sub-project. It must assert the **status code**, not just that the name is absent — a page that renders "you cannot see this" with a 200 would pass a text-only assertion while still confirming the board exists.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:e2e e2e/board-view.spec.ts`
Expected: FAIL — both, on a 404 for the owner's own board.

- [ ] **Step 3: Write the read**

Append to `lib/boards.ts`:

```ts
export async function getBoardWithColumns(boardId: string) {
  const board = await db.query.boards.findFirst({
    where: (b, { eq }) => eq(b.id, boardId),
    columns: { id: true, name: true },
    with: {
      columns: {
        columns: { id: true, name: true, rank: true },
        orderBy: (column, { asc }) => [asc(column.rank)],
      },
    },
  });

  return board ?? null;
}
```

- [ ] **Step 4: Write the column shell**

`components/board/column-shell.tsx` — a Server Component. The 3px rule is a gradient from this column's hue to the next one's, so side by side the rules form one unbroken band; the header wash is the same hue at 6% alpha fading to transparent over 80px. Both come from `flowHue(index, total)`, which `lib/flow.ts` already provides and `lib/flow.test.ts` already covers.

```tsx
export function ColumnShell({ name, hue, nextHue }: { name: string; hue: number; nextHue: number }) {
  return (
    <section className="flex w-[300px] shrink-0 flex-col">
      <div
        className="h-[3px] w-full"
        style={{
          background: `linear-gradient(to right, hsl(${hue} 60% 50%), hsl(${nextHue} 60% 50%))`,
        }}
      />
      <div
        className="px-3 pt-3 pb-20"
        style={{
          background: `linear-gradient(to bottom, hsl(${hue} 60% 50% / 0.06), transparent 80px)`,
        }}
      >
        <h2
          data-testid="column-name"
          className="text-xs font-semibold uppercase tracking-[0.08em] text-muted"
        >
          {name}
        </h2>
        <p className="mt-6 text-sm text-muted">Nothing here yet</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Write the page**

`app/(app)/(board)/boards/[boardId]/page.tsx`. Note the ordering: session, then access, then read. The `notFound()` is what turns the throw into the status code the test asserts.

```tsx
import { notFound, redirect } from 'next/navigation';
import { ColumnShell } from '@/components/board/column-shell';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { flowHue } from '@/lib/flow';
import { assertBoardAccess, BoardAccessError } from '@/lib/permissions';

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  const board = await getBoardWithColumns(boardId);
  if (!board) notFound();

  return (
    <main className="h-full overflow-x-auto">
      <h1 className="sr-only">{board.name}</h1>
      <div className="flex h-full gap-3 px-4">
        {board.columns.map((column, index) => (
          <ColumnShell
            key={column.id}
            name={column.name}
            hue={flowHue(index, board.columns.length)}
            nextHue={flowHue(Math.min(index + 1, board.columns.length - 1), board.columns.length)}
          />
        ))}
      </div>
    </main>
  );
}
```

`params` is a Promise in Next 16 — await it. Do not add `'use client'`: this page reads the database.

- [ ] **Step 6: Put the board title in the top bar**

A page cannot pass data up into a layout, so the title is resolved where the board is: in a layout on the dynamic segment.

`components/app/top-bar.tsx` gains `title?: string`. When present it renders as the `<h1>`; when absent the bar shows "Work Planner" in a `<span>` as it does today. Delete the "sub-project 4 adds the board title" comment — it is now false.

`app/(app)/layout.tsx` keeps the session check and **stops rendering `TopBar`**; each group renders its own. Add `<TopBar … />` to `app/(app)/(chrome)/layout.tsx` with no title.

Create `app/(app)/(board)/boards/[boardId]/layout.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/app/top-bar';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, BoardAccessError } from '@/lib/permissions';

export default async function BoardTitleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  const board = await getBoardWithColumns(boardId);
  if (!board) notFound();

  return (
    <>
      <TopBar
        title={board.name}
        userId={session.user.id}
        name={session.user.name ?? null}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />
      <div className="h-[calc(100vh-49px)] overflow-hidden">{children}</div>
    </>
  );
}
```

That fixed-height wrapper moves here from `(board)/layout.tsx`, which Task 9 created — `(board)/layout.tsx` now only groups, so delete it if it holds nothing else.

**The layout and the page both check access and both read the board. That is deliberate, and it is not two queries.** `CLAUDE.md` requires every entry point to re-check rather than trust a parent, and Next may render them in parallel. Wrap the read in React's `cache` so the duplicate call within one request is deduped:

```ts
import { cache } from 'react';

export const getBoardWithColumns = cache(async (boardId: string) => { /* … */ });
```

The page's `<h1 className="sr-only">` from Step 5 comes out — the top bar now carries the only `<h1>`, which is what the e2e assertion targets.

- [ ] **Step 7: Run everything and watch it pass**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

Expected: all pass, including the 404 test asserting `status() === 404`.

- [ ] **Step 8: Update the documentation in the same PR**

- `CLAUDE.md`: the layout tree gains `(chrome)`/`(board)` and `lib/permissions.ts` is no longer aspirational. Note that the footer now lives in the route-group layouts, not the root.
- `docs/specs/foundation.md`: mark "dropping `SiteFooter` on the board route" resolved here rather than in sub-project 4.
- `docs/specs/boards.md`: tick its verification list with what was observed.

- [ ] **Step 9: Commit**

```bash
git add app components lib e2e CLAUDE.md docs
git commit -m "feat: render the board shell behind a permission check"
```

### Section D gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [ ] A second **real** account — not a seeded session — gets a 404 on the first account's board URL, observed in a browser on the deployed preview.
- [ ] `docker compose up --build` reaches a healthy app container with the new migration applied, and the stack is shut down afterwards.
- [ ] Screenshots of the board shell in both themes attached to the PR.
- [ ] Open the PR. Stop.

---

## Definition of done

Sub-project 3 is complete when every checkbox above is ticked and:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass on `main`.
- A board created in a browser shows its five columns in the order `Ready to Work, In Progress, In Testing, In Review, Done`.
- A second account gets a 404 on a board it is not a member of.
- Deleting a board leaves no orphaned `board_members` or `columns` rows — confirmed with a `select`, not assumed from the foreign keys.
- Production has been migrated by hand and holds the six tables.

Carried forward to the invite sub-project, and not to be decided while executing this plan: when invites land relative to the card modal, and whether a board can change owner.
