# Board Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only board shell into a working canvas — cards you can create, rename, delete and drag between columns, columns you can rename, add, reorder and delete, and a board that stays usable at 360px.

**Architecture:** One new table, `cards`, whose `column_id` carries no `onDelete` action so the database itself refuses to orphan cards. Eight server actions across `lib/actions/cards.ts` and `lib/actions/columns.ts`, each resolving its board from the row it is about rather than trusting a client-supplied `boardId`, each writing one row and bumping `boards.updatedAt` in the same transaction. The canvas is one client component owning a `useReducer` over a pure, separately-tested state module; optimism is applied locally first and undone by **inverse operation** rather than by snapshot restore. dnd-kit sees cards only — column reorder is a menu action — so there is one `DndContext` and no nested sortable contexts.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript strict, Drizzle ORM + drizzle-kit, Neon Postgres, Zod 4, `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2, `fractional-indexing` 4.0.0, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/specs/board-canvas.md`

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Never assume — prove it.** Do not tick a step you have not run and read the output of. "Should work" is not a status.
- **Before any commit:** `pnpm typecheck && pnpm lint && pnpm test` — all three, output observed.
- **TDD, red-green-refactor.** The failing test is written and *watched to fail* before the implementation exists. Do not backfill tests.
- **No `any`, no non-null assertions to silence the compiler, no `@ts-expect-error`** without an explanation on the line above.
- **No unnecessary comments.** Comment only non-obvious decisions. Never narrate what the code plainly says.
- **Server action convention, exactly:** `'use server'` → `auth()` → `{ ok: false, error: 'UNAUTHENTICATED' }` → Zod `safeParse` → `{ ok: false, error: 'INVALID' }` → `assertBoardAccess` → transaction → `{ ok: true, data }`. Actions return a discriminated result; they never throw for expected failures.
- **Never trust a client `boardId` or `userId` for authorisation.** Card and column actions resolve the board from the row.
- **Neighbours, never indexes.** `moveCard` and `moveColumn` take `beforeId`/`afterId`, not a position.
- **Ranks are `text`, from `lib/rank.ts`.** Never store integer positions, never renumber siblings on move.
- **A rank fixture in a test must be a key `fractional-indexing` accepts,** because any fixture whose
  rank reaches `rankBetween` or `ranksAfter` is validated by the library and throws
  `invalid order key: <key>` if it is malformed. Under the default alphabet the head character
  encodes the integer part's length: `a` means two characters (`a0`, `a1`), `b` means three
  (`b00`, `b01`). **`'b0'` is not a valid key** — it reads as "three characters" but is two. It was
  written as a fixture in Task 8 and cost a red test that looked like an implementation bug. The
  rule is about *reach*, not about the literal: `'b0'` survives harmlessly in the Section C and E
  reducer and `dropTarget` fixtures, which sort ranks as opaque strings and never call the library.
  It is any fixture whose rank flows into `ranksAfter`/`rankBetween` — Section C's create path at
  `ranksAfter(last?.rank ?? null, 1)`, Section E's drop — that must hold a real key. Prefer
  `a0`/`a1`/`a2` for one range and `b00`/`b01` for a second, and check a new rank against the
  library before assuming a failure is the code's.
- **One migration mechanism:** `pnpm db:generate`. Never hand-edit a generated migration. Never `db:push`.
- **`revalidatePath('/boards')` after every mutation. The canvas is never revalidated** — its invalidation story is Pusher in sub-project 6.
- **No state management library.** `useState`/`useReducer` only. No TanStack Query in this sub-project.
- **No in-memory state between requests.** `lib/db/index.ts` remains the only module-level singleton.
- **Copy rule:** active voice, sentence case, no filler, no apology. "Add card", not "Submit". Errors say what happened and what to do.
- **Design tokens only** — `--canvas`, `--surface`, `--ink`, `--muted`, `--line`, the flow hues, `--time-soon`/`--time-over`. Warm colour is reserved for due dates and is **not used in this sub-project**. Accent teal is `--flow-mid` and nothing else.
- **Branch per section, PR per section.** Never commit to `main`. Each section branches from `main` — confirm with `git merge-base --is-ancestor <parent-tip> origin/main` if stacking. Never force-push a branch with an open PR.
- **Model table:** implementation and per-task review on Sonnet; the final whole-branch review on Opus. Always pass the model explicitly when dispatching a subagent.
- **Invoke the `frontend-design` skill** before the first implementation step of Sections C, D and E. Not before Sections A, B or F.

---

## File structure

Created or modified across the whole plan, so decomposition is visible before Task 1.

| File | Responsibility | Section |
|---|---|---|
| `lib/db/schema.ts` | The `cards` table and its relations | A |
| `lib/db/schema.test.ts` | Table name, columns, indexes, referential actions as declared | A |
| `lib/db/migrations/0002_*.sql` | Generated. Never hand-edited | A |
| `e2e/schema.spec.ts` | The referential-action proof against a real Postgres | A |
| `lib/boards.ts` | `getBoardWithColumns` grows cards and the caller's role | A |
| `lib/actions/cards.ts` | `createCard`, `renameCard`, `deleteCard`, `moveCard` | B |
| `lib/actions/cards.test.ts` | Their Zod boundaries, role ladder, one-row writes | B |
| `lib/actions/columns.ts` | `addColumn`, `renameColumn`, `moveColumn`, `deleteColumn` | B |
| `lib/actions/columns.test.ts` | Same, plus `deleteColumn`'s three rejections | B |
| `lib/board-state.ts` | Pure reducer, selectors and inverse operations. No React, no db | C |
| `lib/board-state.test.ts` | Every action, every inverse, inverse composition | C |
| `components/board/board-canvas.tsx` | `'use client'`. Owns the reducer, the status strip, the action calls | C |
| `components/board/board-column.tsx` | One column: flow rule, wash, header, card list, add composer. Replaces `column-shell.tsx` | C |
| `components/board/board-card.tsx` | One card: title, `⋯` menu, drag wiring in Section E | C |
| `components/board/add-card.tsx` | The inline title composer at a column's foot | C |
| `components/board/board-actions.tsx` | The context that lets the top bar's "New card" reach the canvas's reducer | C |
| `components/board/new-card-button.tsx` | The top bar button. Calls into the context | C |
| `components/app/top-bar.tsx` | Grows an `actions` slot | C |
| `components/board/column-shell.tsx` | **Deleted** in Section C, absorbed by `board-column.tsx` | C |
| `components/board/column-switcher.tsx` | The tab strip below 700px | F |
| `app/(app)/(board)/boards/[boardId]/page.tsx` | Reads, then hands the canvas its seed | A, C |
| `app/(app)/(board)/boards/[boardId]/layout.tsx` | Wraps in the actions provider, puts the button in the bar | C |
| `e2e/support/session.ts` | `seedCard`, `boardColumns` | A |
| `e2e/cards.spec.ts` | Create, rename, delete, move-to | C |
| `e2e/columns.spec.ts` | Add, rename, reorder, delete-into-target | D |
| `e2e/board-dnd.spec.ts` | Drag across columns, surviving a reload | E |
| `e2e/board-responsive.spec.ts` | 360px | F |
| `e2e/board-view.spec.ts` | Modified: it asserts the five columns and must keep passing | C |

`components/board/board-canvas.tsx` is the only file that calls a server action from the canvas. The column and card components receive callbacks; they never import an action. That keeps the optimistic path in exactly one place and keeps every other component testable as a pure render.

---

## Section A — The cards table, the referential-action proof, and the read

**Branch:** `feat/canvas-schema`

Nothing user-visible changes in this section. Say so in the PR rather than implying a feature landed.

### Task 1: The `cards` table and the third migration

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/schema.test.ts`
- Create: `lib/db/migrations/0002_*.sql` (generated — the name is drizzle-kit's choice)

**Interfaces:**
- Consumes: `boards`, `columns`, `users` from `lib/db/schema.ts`.
- Produces: `cards` (a `PgTable`), and `cardsRelations`. Every later task imports `cards` from `@/lib/db/schema`. Column names on the TypeScript side are `id`, `boardId`, `columnId`, `title`, `description`, `dueDate`, `rank`, `createdById`, `createdAt`, `updatedAt`.

- [x] **Step 1: Write the failing test**

Append to `lib/db/schema.test.ts`:

```ts
describe('the cards table', () => {
  test('is named cards and carries the columns CLAUDE.md documents', () => {
    expect(getTableName(cards)).toBe('cards');
    expect(getTableConfig(cards).columns.map((column) => column.name).sort()).toEqual([
      'board_id',
      'column_id',
      'created_at',
      'created_by_id',
      'description',
      'due_date',
      'id',
      'rank',
      'title',
      'updated_at',
    ]);
  });

  test('makes title and rank required, and leaves SP5 fields nullable', () => {
    const byName = Object.fromEntries(
      getTableConfig(cards).columns.map((column) => [column.name, column.notNull]),
    );
    expect(byName.title).toBe(true);
    expect(byName.rank).toBe(true);
    expect(byName.description).toBe(false);
    expect(byName.due_date).toBe(false);
  });

  // The whole no-orphan design rests on this pair. board_id cascades so
  // deleting a board takes its cards; column_id declares no action at all, so
  // Postgres refuses a column delete that would orphan them. Changing either
  // silently changes what deleteColumn is allowed to do.
  test('cascades from its board but declares no action on its column', () => {
    const actions = getTableConfig(cards).foreignKeys.map((key) => ({
      column: key.reference().columns[0].name,
      onDelete: key.onDelete,
    }));

    expect(actions).toContainEqual({ column: 'board_id', onDelete: 'cascade' });
    expect(actions).toContainEqual({ column: 'created_by_id', onDelete: 'cascade' });
    expect(actions).toContainEqual({ column: 'column_id', onDelete: undefined });
  });

  test('indexes the read path and the permission path', () => {
    const indexes = getTableConfig(cards)
      .indexes.map((index) => index.config.name)
      .sort();
    expect(indexes).toEqual(['cards_board_id_idx', 'cards_column_id_rank_idx']);
  });
});
```

Add `cards` to the import at the top of the file.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/db/schema.test.ts`
Expected: FAIL — `cards` is not exported from `./schema`.

- [x] **Step 3: Write the schema**

Append to `lib/db/schema.ts`, after `columns`:

```ts
export const cards = pgTable(
  'cards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    // No onDelete: Postgres's default NO ACTION is what refuses to orphan a
    // column's cards. deleteColumn moves them to a named target first.
    columnId: text('column_id')
      .notNull()
      .references(() => columns.id),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    rank: text('rank').notNull(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('cards_column_id_rank_idx').on(t.columnId, t.rank),
    index('cards_board_id_idx').on(t.boardId),
  ],
);
```

Then extend the relations so `getBoardWithColumns` can nest the read. Add to the existing `boardsRelations` and add two new ones:

```ts
export const columnsRelations = relations(columns, ({ one, many }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one }) => ({
  board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
  column: one(columns, { fields: [cards.columnId], references: [columns.id] }),
}));
```

If `boardsRelations` does not already list `cards`, add `cards: many(cards)` to it.

- [x] **Step 4: Give the client its schema**

`lib/db/index.ts` passes the whole schema module to `drizzle()`. Confirm by reading it that the new tables and relations are picked up without an edit — if it imports named tables rather than `* as schema`, add `cards`, `cardsRelations` and `columnsRelations`.

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/db/schema.test.ts`
Expected: PASS, including the four new tests.

- [x] **Step 6: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `lib/db/migrations/0002_*.sql`.

- [x] **Step 7: Read the generated SQL**

Open the generated file and confirm, by reading rather than assuming:

- `"column_id" text NOT NULL` with a foreign key that has **no** `ON DELETE` clause;
- `"board_id"` and `"created_by_id"` foreign keys with `ON DELETE cascade`;
- `"description"` and `"due_date"` nullable, `"title"` and `"rank"` `NOT NULL`;
- both `CREATE INDEX` statements present.

If the `column_id` constraint has an `ON DELETE` clause, the schema is wrong — fix `schema.ts`, delete the generated file, and regenerate. Never hand-edit it.

- [x] **Step 8: Apply it to the dev branch and prove it**

```bash
pnpm db:migrate
psql "$(grep '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')" -c '\d cards'
```

Expected: `\d cards` prints the table, both indexes, and three foreign-key constraints — one of which, `cards_column_id_columns_id_fk`, has no `ON DELETE`. **Confirm with `\d`, not with `db:migrate`'s success line** — `CLAUDE.md` records the run where that line lied.

Done differently, and the difference is worth recording: `psql` is not installed on the development
machine, so the catalogue was read through the repository's own `pg` driver instead — `pg_constraint`
for the delete actions and `pg_indexes` for the indexes. The substitution is for `psql` only. The
point of the step is that the *database* is asked rather than `db:migrate`'s success line, and it was.

- [x] **Step 9: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/db/schema.ts lib/db/schema.test.ts lib/db/migrations
git commit -m "feat: add the cards table"
```

---

### Task 2: Prove the referential actions against a real database

This is the task that can reject the design. The spec's `NO ACTION` choice rests on an **unverified** claim: that `NO ACTION` is checked at the end of the statement, so a board delete whose cascade removes both the columns and the cards succeeds, while `RESTRICT` would abort it. Nothing else is built until this is observed.

**Files:**
- Modify: `e2e/support/session.ts`
- Create: `e2e/schema.spec.ts`

**Interfaces:**
- Consumes: `seedSession`, `seedBoard`, `removeSeededUser`, `closeSeedPool` from `e2e/support/session.ts`.
- Produces:
  - `boardColumns(boardId: string): Promise<{ id: string; name: string; rank: string }[]>` — a board's columns in rank order.
  - `seedCard(columnId: string, opts: { boardId: string; createdById: string; title?: string; rank?: string }): Promise<string>` — returns the new card id.
  - Every later e2e spec uses both.

- [x] **Step 1: Write the seed helpers**

Append to `e2e/support/session.ts`:

```ts
export async function boardColumns(
  boardId: string,
): Promise<{ id: string; name: string; rank: string }[]> {
  const { rows } = await seedPool().query(
    'select id, name, rank from columns where board_id = $1 order by rank',
    [boardId],
  );
  return rows;
}

export async function seedCard(
  columnId: string,
  opts: { boardId: string; createdById: string; title?: string; rank?: string },
): Promise<string> {
  const cardId = crypto.randomUUID();
  await seedPool().query(
    'insert into cards (id, board_id, column_id, title, rank, created_by_id) values ($1, $2, $3, $4, $5, $6)',
    [
      cardId,
      opts.boardId,
      columnId,
      opts.title ?? 'Seeded card',
      opts.rank ?? generateNKeysBetween(null, null, 1)[0],
      opts.createdById,
    ],
  );
  return cardId;
}
```

`generateNKeysBetween` is already imported at the top of the file.

- [x] **Step 2: Write the failing test**

Create `e2e/schema.spec.ts`. It drives no browser — it is a Playwright test because that is where this repository keeps its real-database tests, and Playwright is what has `DATABASE_URL` pointed at the dev branch.

```ts
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// The whole no-orphan design rests on NO ACTION being checked at the end of the
// statement rather than immediately. If this fails, cards.columnId must become
// ON DELETE cascade and the rule moves entirely into deleteColumn.
test('deleting a board takes its columns and cards with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascade');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from boards where id = $1', [boardId]);

    for (const table of ['cards', 'columns', 'board_members']) {
      const { rows } = await pool.query(`select count(*)::int as n from ${table} where board_id = $1`, [
        boardId,
      ]);
      expect(rows[0].n, `${table} should be empty`).toBe(0);
    }
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a column that still holds cards is refused by the database', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'No orphans');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await expect(pool.query('delete from columns where id = $1', [first.id])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 3: Run it**

Run: `pnpm exec playwright test e2e/schema.spec.ts`

Expected: both PASS. **This is a verification step, not a red step** — the schema already exists from Task 1, and the point is to find out whether the claim holds.

**If the first test fails** with a foreign key violation on the board delete, the `NO ACTION` claim is wrong. Stop. Change `columnId` to `.references(() => columns.id, { onDelete: 'cascade' })`, update Task 1's `onDelete: undefined` assertion to `'cascade'`, regenerate the migration, delete the second test above, and record in `docs/specs/board-canvas.md` that the claim did not hold and the rule now lives only in `deleteColumn`. Then continue.

- [x] **Step 4: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add e2e/support/session.ts e2e/schema.spec.ts
git commit -m "test: prove the cards table cannot orphan a column's cards"
```

---

### Task 3: The board read grows cards and the caller's role

**Files:**
- Modify: `lib/boards.ts`
- Modify: `app/(app)/(board)/boards/[boardId]/page.tsx`
- Create: `lib/boards.test.ts`

**Interfaces:**
- Consumes: `cards` from `@/lib/db/schema`; `BoardRole` from `@/lib/permissions`.
- Produces:
  ```ts
  export type BoardCardRow = {
    id: string; columnId: string; title: string; rank: string; createdAt: Date;
  };
  export type BoardColumnRow = { id: string; name: string; rank: string; cards: BoardCardRow[] };
  export type BoardWithCards = { id: string; name: string; columns: BoardColumnRow[] };
  export const getBoardWithColumns: (boardId: string) => Promise<BoardWithCards | null>;
  ```

  The `Row` suffix is not decoration. Task 10 creates `BoardCard` and `BoardColumn`
  **components**; a read type sharing those names is a trap the first file that
  imports both would fall into. The function keeps its own name — the layout and
  the page both already call it, and React's `cache` collapses the duplicate.
  Section C's `BoardCanvas` is seeded from exactly this shape. The function keeps its name — the layout and page both already call it and React's `cache` collapses the duplicate.

- [x] **Step 1: Write the failing test**

Create `lib/boards.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

let boardRow: unknown;
const findFirst = vi.fn(async () => boardRow);

vi.mock('@/lib/db', () => ({ db: { query: { boards: { findFirst: () => findFirst() } } } }));

const { getBoardWithColumns } = await import('./boards');

beforeEach(() => {
  boardRow = undefined;
  findFirst.mockClear();
});

describe('getBoardWithColumns', () => {
  test('returns null for a board that is not there', async () => {
    await expect(getBoardWithColumns('missing')).resolves.toBeNull();
  });

  test('asks for cards nested under their column', async () => {
    boardRow = {
      id: 'b1',
      name: 'Roadmap',
      columns: [
        {
          id: 'c1',
          name: 'Ready to Work',
          rank: 'a0',
          cards: [
            { id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: new Date(0) },
          ],
        },
      ],
    };

    const board = await getBoardWithColumns('b1');

    expect(board?.columns[0].cards).toEqual([
      { id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: new Date(0) },
    ]);
  });

  test('gives a column with no cards an empty array, not undefined', async () => {
    boardRow = { id: 'b1', name: 'Roadmap', columns: [{ id: 'c1', name: 'Done', rank: 'a1', cards: [] }] };

    const board = await getBoardWithColumns('b1');

    expect(board?.columns[0].cards).toEqual([]);
  });
});
```

`getBoardWithColumns` is wrapped in React's `cache`, which memoises per request. Vitest has no request scope, so each call runs the query — that is why every test above uses a distinct id or resets `boardRow` first.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/boards.test.ts`
Expected: FAIL — the returned column has no `cards` property.

- [x] **Step 3: Write the implementation**

Replace `getBoardWithColumns` in `lib/boards.ts`:

```ts
export type BoardCardRow = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: Date;
};

export type BoardColumnRow = { id: string; name: string; rank: string; cards: BoardCardRow[] };
export type BoardWithCards = { id: string; name: string; columns: BoardColumnRow[] };

export const getBoardWithColumns = cache(async (boardId: string): Promise<BoardWithCards | null> => {
  const board = await db.query.boards.findFirst({
    where: (b, { eq }) => eq(b.id, boardId),
    columns: { id: true, name: true },
    with: {
      columns: {
        columns: { id: true, name: true, rank: true },
        orderBy: (column, { asc }) => [asc(column.rank)],
        with: {
          cards: {
            columns: { id: true, columnId: true, title: true, rank: true, createdAt: true },
            orderBy: (card, { asc }) => [asc(card.rank), asc(card.createdAt), asc(card.id)],
          },
        },
      },
    },
  });

  return board ?? null;
});
```

The three-part `orderBy` is `CLAUDE.md`'s tie-break rule — rank, then `createdAt`, then `id` — pushed into the query so the client never has to apply it to a fresh read.

- [x] **Step 4: Pass the role down to the page**

`assertBoardAccess` already returns the caller's role. In `app/(app)/(board)/boards/[boardId]/page.tsx`, capture it:

```ts
let role: BoardRole;
try {
  role = await assertBoardAccess(session.user.id, boardId, 'viewer');
} catch (error) {
  // A membership miss is indistinguishable from a missing board on purpose:
  // a 403 would confirm a guessed id is real.
  if (error instanceof BoardAccessError) notFound();
  throw error;
}
```

Leave the rendering alone in this task — `ColumnShell` still renders and `role` is unused until Section C. To keep the compiler honest rather than adding a suppression, hand it to the existing markup as a data attribute the canvas will later replace:

```tsx
<main className="h-full overflow-x-auto" data-role={role}>
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test && pnpm exec playwright test e2e/board-view.spec.ts`
Expected: unit tests PASS; `board-view.spec.ts` still PASS — the five columns still render, because nothing about the shell changed.

- [x] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/boards.ts lib/boards.test.ts "app/(app)/(board)/boards/[boardId]/page.tsx"
git commit -m "feat: read a board's cards and the caller's role"
```

---

### Section A gate

- [x] `pnpm typecheck && pnpm lint && pnpm test` pass, output observed. 88 unit tests across 13 files
      at `6a80536`; 91 across the same 13 files on `main` today, after `756e18e` added the
      set-but-empty `MIGRATE_URL` tests.
- [x] `pnpm exec playwright test` passes, output observed. 30 passed in 17.1s, exit 0, at `6a80536`.
- [x] The generated SQL was **read**, not just generated, and `column_id` has no `ON DELETE` clause.
      Also read: `title` and `rank` `NOT NULL`, `description` and `due_date` nullable, both
      `CREATE INDEX` statements present.
- [x] `\d cards` against the dev branch confirms the table, both indexes and the three foreign keys.
      Read through the `pg` driver rather than `psql`, which is not installed — see Task 1 Step 8.
      `pg_constraint.confdeltype`: `column_id` → `a` (no action), `board_id` → `c`, `created_by_id` → `c`.
- [x] Task 2's two tests were observed passing — or the fallback was taken and the spec updated to say so.
      Observed passing, no fallback: a board delete cascades through its columns **and** cards in one
      statement, and a bare column delete holding cards is refused with a foreign-key violation. That
      is the `NO ACTION` claim the spec rested on, confirmed behaviourally as well as in the catalogue.
- [x] CI is green on the PR. That is what proves the migration applies to an empty database.
      PR #42: `verify` pass in 1m31s, Vercel pass.
- [x] **Production is migrated by hand *before* merging, not after:** `getBoardWithColumns` already
      joins `cards`, so the usual order would leave a window between Vercel's deploy and the hand-run
      migration where `/boards/[boardId]` throws `relation "cards" does not exist` for every user.
      Migration `0002` is purely additive and no code deployed today references `cards`, so there is
      nothing to lose by running it first: `MIGRATE_URL="$(npx --yes neonctl@4 connection-string main
      --project-id withered-glade-54206401)" pnpm db:migrate`, then `\dt` against production to
      confirm `cards` exists — before merging the PR, not after.
      Done in that order, and the order is provable: `drizzle.__drizzle_migrations` on production
      (`ep-plain-truth-b2qok7du`) records the third migration at 2026-08-30T20:40:57Z, and PR #42
      merged at 2026-08-31T07:55:27Z. `cards` is present in production's `public` schema.
- [x] Open the PR, saying plainly that nothing user-visible changed. Stop. Start Section B in a fresh session. — PR #42.

---

## Section B — The eight server actions

**Branch:** `feat/canvas-actions`

No UI in this section either. The rules are proven in unit tests against a mocked `db`.

### Two decisions settled while writing this plan

**`beforeCardId` means the card above the new position, `afterCardId` the card below.** `CLAUDE.md` gives the parameter names but not their orientation, and the two readings produce silently inverted ordering. Fixed here: the new rank is `rankBetween(before?.rank ?? null, after?.rank ?? null)`. Dropping a card at the very top passes `beforeCardId: null`; at the very bottom, `afterCardId: null`. `moveColumn` follows the same convention with `beforeColumnId`/`afterColumnId`, left-to-right.

**The board is resolved from the row, then access is checked, then the transaction opens.** The convention block in `CLAUDE.md` reads session → parse → check → transaction, and a card action cannot check before it knows the board. Resolving the board id is a read, not a decision, so it sits between the parse and the check — and the value it produces is the thing being authorised, never a value the client supplied.

---

### Task 4: `lib/rank.ts` grows a bulk-append helper, and the board scope helpers

**Files:**
- Modify: `lib/rank.ts`
- Modify: `lib/rank.test.ts`
- Create: `lib/actions/scope.ts`

**Interfaces:**
- Consumes: `generateNKeysBetween` from `fractional-indexing`; `db`, `boards`, `cards`, `columns` from the schema.
- Produces:
  ```ts
  // lib/rank.ts
  export const ranksAfter: (a: string | null, count: number) => string[];

  // lib/actions/scope.ts
  export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  export function boardIdForCard(cardId: string): Promise<string | null>;
  export function boardIdForColumn(columnId: string): Promise<string | null>;
  export function touchBoard(tx: Tx, boardId: string): Promise<void>;
  ```
  Tasks 5 through 8 all import these three functions and the `Tx` type.

- [x] **Step 1: Write the failing test**

Append to `lib/rank.test.ts`:

```ts
describe('ranksAfter', () => {
  test('returns the requested number of keys, all after the given one', () => {
    const keys = ranksAfter('a0', 3);

    expect(keys).toHaveLength(3);
    expect(keys.every((key) => key > 'a0')).toBe(true);
    expect([...keys].sort()).toEqual(keys);
  });

  test('starts from the beginning when there is nothing before', () => {
    expect(ranksAfter(null, 2)).toEqual(seedRanks(2));
  });

  test('returns nothing for a count of zero', () => {
    expect(ranksAfter('a0', 0)).toEqual([]);
  });
});
```

Add `ranksAfter` to the import at the top of the file.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/rank.test.ts`
Expected: FAIL — `ranksAfter` is not exported.

- [x] **Step 3: Write the implementation**

Append to `lib/rank.ts`:

```ts
export const ranksAfter = (a: string | null, count: number) => generateNKeysBetween(a, null, count);
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/rank.test.ts`
Expected: PASS.

- [x] **Step 5: Write the scope helpers**

Create `lib/actions/scope.ts`. These are not tested on their own — they are one query each with no branching, and Tasks 5 to 8 exercise every path through them.

```ts
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { boards } from '@/lib/db/schema';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function boardIdForCard(cardId: string): Promise<string | null> {
  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, cardId),
    columns: { boardId: true },
  });
  return card?.boardId ?? null;
}

export async function boardIdForColumn(columnId: string): Promise<string | null> {
  const column = await db.query.columns.findFirst({
    where: (c, { eq: is }) => is(c.id, columnId),
    columns: { boardId: true },
  });
  return column?.boardId ?? null;
}

// Every card and column write bumps the board so /boards orders by activity
// rather than by "last renamed". $onUpdate would fire on any set; the explicit
// value keeps the intent readable in the one place it matters.
export async function touchBoard(tx: Tx, boardId: string): Promise<void> {
  await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
}
```

- [x] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/rank.ts lib/rank.test.ts lib/actions/scope.ts
git commit -m "feat: add a bulk rank helper and the board scope helpers"
```

---

### Task 5: `createCard`, `renameCard`, `deleteCard`

**Files:**
- Create: `lib/actions/cards.ts`
- Create: `lib/actions/cards.test.ts`

**Interfaces:**
- Consumes: `Tx`, `boardIdForCard`, `boardIdForColumn`, `touchBoard` from `./scope`; `rankBetween`, `ranksAfter` from `@/lib/rank`; `assertBoardAccess`, `boardAccessResult` from `@/lib/permissions`.
- Produces:
  ```ts
  export function createCard(input: unknown): Promise<
    | { ok: true; data: { id: string; rank: string } }
    | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' }>;
  export function renameCard(input: unknown): Promise<{ ok: true } | { ok: false; error: ... }>;
  export function deleteCard(input: unknown): Promise<{ ok: true } | { ok: false; error: ... }>;
  ```
  Section C's canvas calls all three. `createCard` returns the id **and** the rank because the reducer must settle its temp card with both.

- [x] **Step 1: Write the failing test**

Create `lib/actions/cards.test.ts`. The mock records every write so a test can assert *how many* rows an action touched, which is the property the fractional-rank design exists to protect.

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

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];

let cardRow: { id: string; boardId: string; columnId: string; rank: string } | undefined;
let columnRow: { id: string; boardId: string } | undefined;
let cardsInColumn: { id: string; rank: string }[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const query = {
  cards: {
    findFirst: async () => cardRow,
    findMany: async () => cardsInColumn,
  },
  columns: { findFirst: async () => columnRow },
};

const tx = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return {
        returning: async () => [{ id: 'card-1', ...(values as object) }],
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
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
  db: { query, transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { createCard, deleteCard, renameCard } = await import('./cards');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  cardRow = { id: 'card-1', boardId: 'b1', columnId: 'col-1', rank: 'a0' };
  columnRow = { id: 'col-1', boardId: 'b1' };
  cardsInColumn = [];
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('createCard', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(createCard({ columnId: 'col-1', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('refuses an empty title', async () => {
    await expect(createCard({ columnId: 'col-1', title: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a title over two hundred characters', async () => {
    await expect(createCard({ columnId: 'col-1', title: 'x'.repeat(201) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a column that is not there', async () => {
    columnRow = undefined;
    await expect(createCard({ columnId: 'gone', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  // The board is never taken from the caller. It is resolved from the column,
  // and that resolved value is what assertBoardAccess is asked about.
  test('authorises the board the column belongs to, at member', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(createCard({ columnId: 'col-1', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test("trims the title and appends below the column's last card", async () => {
    cardsInColumn = [{ id: 'card-0', rank: 'a0' }];

    const result = await createCard({ columnId: 'col-1', title: '  Ship it  ' });

    expect(result.ok).toBe(true);
    const insert = ops.find((op) => op.kind === 'insert');
    expect(insert?.table).toBe('cards');
    expect(insert?.values).toMatchObject({ title: 'Ship it', columnId: 'col-1', boardId: 'b1' });
    expect((insert?.values as { rank: string }).rank > 'a0').toBe(true);
  });

  test('returns the id and the rank, so the client can settle its temp card', async () => {
    const result = await createCard({ columnId: 'col-1', title: 'Ship it' });

    expect(result).toMatchObject({ ok: true, data: { id: 'card-1' } });
    expect(typeof (result as { data: { rank: string } }).data.rank).toBe('string');
  });

  test('bumps the board in the same transaction', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it' });
    expect(ops).toContainEqual(
      expect.objectContaining({ kind: 'update', table: 'boards' }),
    );
  });
});

describe('renameCard', () => {
  test('refuses an empty title', async () => {
    await expect(renameCard({ cardId: 'card-1', title: '  ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(renameCard({ cardId: 'gone', title: 'Ship it' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test("authorises the card's own board", async () => {
    await renameCard({ cardId: 'card-1', title: 'Ship it' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('writes the trimmed title and bumps the board', async () => {
    await renameCard({ cardId: 'card-1', title: '  Ship it  ' });

    expect(ops.filter((op) => op.table === 'cards')).toEqual([
      { kind: 'update', table: 'cards', values: { title: 'Ship it' } },
    ]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('deleteCard', () => {
  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(deleteCard({ cardId: 'gone' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteCard({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('deletes exactly one card and bumps the board', async () => {
    await expect(deleteCard({ cardId: 'card-1' })).resolves.toEqual({ ok: true });

    expect(ops.filter((op) => op.table === 'cards')).toEqual([{ kind: 'delete', table: 'cards' }]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: FAIL — `./cards` does not exist.

- [x] **Step 3: Write the implementation**

`createCard` hoists `const createdById = session.user.id` instead of reading it where it is used. The
`!session?.user?.id` guard narrows a *property chain*, and TypeScript drops that narrowing inside a
nested function — so `session.user.id` is `string | undefined` again inside the `db.transaction`
callback and `tsc` rejects the insert. A plain `const` carries its own narrowing across the boundary.
`createBoard` in `lib/actions/boards.ts` already does this with `ownerId`; the amendment brings this
action into line rather than inventing a pattern. Only `createCard` needs it — no other action in this
section touches the session inside its transaction.

Create `lib/actions/cards.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cards } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { ranksAfter } from '@/lib/rank';

import { boardIdForCard, boardIdForColumn, touchBoard } from './scope';

const cardTitle = z.string().trim().min(1).max(200);
const id = z.string().min(1);

const createSchema = z.object({ columnId: id, title: cardTitle });
const renameSchema = z.object({ cardId: id, title: cardTitle });
const deleteSchema = z.object({ cardId: id });

export async function createCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const createdById = session.user.id;

  const boardId = await boardIdForColumn(parsed.data.columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(createdById, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const siblings = await tx.query.cards.findMany({
      where: (card, { eq: is }) => is(card.columnId, parsed.data.columnId),
      columns: { id: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const [rank] = ranksAfter(siblings.at(-1)?.rank ?? null, 1);

    const [row] = await tx
      .insert(cards)
      .values({
        boardId,
        columnId: parsed.data.columnId,
        title: parsed.data.title,
        rank,
        createdById,
      })
      .returning();

    await touchBoard(tx, boardId);
    return { id: row.id, rank };
  });

  revalidatePath('/boards');
  return { ok: true, data: created } as const;
}

export async function renameCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ title: parsed.data.title }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function deleteCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.delete(cards).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: PASS, all of them.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/actions/cards.ts lib/actions/cards.test.ts
git commit -m "feat: create, rename and delete a card"
```

---

### Task 6: `moveCard`

**Files:**
- Modify: `lib/actions/cards.ts`
- Modify: `lib/actions/cards.test.ts`

**Interfaces:**
- Consumes: everything Task 5 produced, plus `rankBetween` from `@/lib/rank`.
- Produces:
  ```ts
  export function moveCard(input: {
    cardId: string; toColumnId: string;
    beforeCardId: string | null; afterCardId: string | null;
  } | unknown): Promise<{ ok: true; data: { rank: string } } | { ok: false; error: ... }>;
  ```
  Section E's drag handler and Section C's "Move to" both call this. It returns the server's rank so the reducer can replace its optimistic guess.

**Why the neighbours are found in JS rather than queried by id:** the action already needs the target column's cards to compute a rank, and finding `beforeCardId` inside that list proves the neighbour is genuinely in the target column at the same time. Two queries collapse into one, and a neighbour from another column is rejected for free rather than by a separate check.

- [x] **Step 1: Write the failing test**

Append to `lib/actions/cards.test.ts`, and add `moveCard` to the import:

```ts
describe('moveCard', () => {
  beforeEach(() => {
    columnRow = { id: 'col-2', boardId: 'b1' };
    cardsInColumn = [
      { id: 'card-a', rank: 'a0' },
      { id: 'card-b', rank: 'a1' },
    ];
  });

  test('refuses a card that is not there', async () => {
    cardRow = undefined;
    await expect(
      moveCard({ cardId: 'gone', toColumnId: 'col-2', beforeCardId: null, afterCardId: null }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  test('refuses a target column on another board', async () => {
    columnRow = { id: 'col-2', boardId: 'other-board' };
    await expect(
      moveCard({ cardId: 'card-1', toColumnId: 'col-2', beforeCardId: null, afterCardId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a neighbour that is not in the target column', async () => {
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: 'card-from-elsewhere',
        afterCardId: null,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses neighbours in the wrong order', async () => {
    await expect(
      moveCard({
        cardId: 'card-1',
        toColumnId: 'col-2',
        beforeCardId: 'card-b',
        afterCardId: 'card-a',
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(
      moveCard({ cardId: 'card-1', toColumnId: 'col-2', beforeCardId: null, afterCardId: null }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  test('ranks between the two neighbours it was given', async () => {
    const result = await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: 'card-a',
      afterCardId: 'card-b',
    });

    expect(result.ok).toBe(true);
    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
  });

  test('ranks before everything when dropped at the top', async () => {
    const result = await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: null,
      afterCardId: 'card-a',
    });

    expect((result as { data: { rank: string } }).data.rank < 'a0').toBe(true);
  });

  // This is the property fractional ranks exist to protect. A move must never
  // renumber siblings — one card row, plus the board's timestamp.
  test('writes exactly one card row, and bumps the board', async () => {
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-2',
      beforeCardId: 'card-a',
      afterCardId: 'card-b',
    });

    expect(ops.filter((op) => op.table === 'cards')).toHaveLength(1);
    expect(ops.filter((op) => op.table === 'cards')[0]).toMatchObject({
      kind: 'update',
      values: expect.objectContaining({ columnId: 'col-2' }),
    });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: FAIL — `moveCard` is not exported.

- [x] **Step 3: Write the implementation**

Add to `lib/actions/cards.ts`, and add `rankBetween` to the `@/lib/rank` import:

```ts
const moveSchema = z.object({
  cardId: id,
  toColumnId: id,
  beforeCardId: id.nullable(),
  afterCardId: id.nullable(),
});

export async function moveCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { cardId, toColumnId, beforeCardId, afterCardId } = parsed.data;
  if (beforeCardId && beforeCardId === afterCardId) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Asked after the access check, not before: answering it first would tell a
  // caller with no membership whether two ids sit on the same board.
  const targetBoardId = await boardIdForColumn(toColumnId);
  if (targetBoardId !== boardId) return { ok: false, error: 'INVALID' } as const;

  const rank = await db.transaction(async (tx) => {
    const siblings = await tx.query.cards.findMany({
      where: (card, { eq: is }) => is(card.columnId, toColumnId),
      columns: { id: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const before = beforeCardId ? siblings.find((card) => card.id === beforeCardId) : null;
    const after = afterCardId ? siblings.find((card) => card.id === afterCardId) : null;

    // A named neighbour that is not in the target column means the client is
    // working from a board someone else has already changed.
    if ((beforeCardId && !before) || (afterCardId && !after)) return null;
    if (before && after && before.rank >= after.rank) return null;

    const next = rankBetween(before?.rank ?? null, after?.rank ?? null);

    await tx.update(cards).set({ columnId: toColumnId, rank: next }).where(eq(cards.id, cardId));
    await touchBoard(tx, boardId);
    return next;
  });

  if (rank === null) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  return { ok: true, data: { rank } } as const;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/actions/cards.ts lib/actions/cards.test.ts
git commit -m "feat: move a card between its neighbours"
```

---

### Task 7: `addColumn`, `renameColumn`, `moveColumn`

**Files:**
- Create: `lib/actions/columns.ts`
- Create: `lib/actions/columns.test.ts`

**Interfaces:**
- Consumes: `Tx`, `boardIdForColumn`, `touchBoard` from `./scope`; `rankBetween` from `@/lib/rank`.
- Produces:
  ```ts
  export function addColumn(input: unknown): Promise<
    { ok: true; data: { id: string; rank: string } } | { ok: false; error: ... }>;
  export function renameColumn(input: unknown): Promise<{ ok: true } | { ok: false; error: ... }>;
  export function moveColumn(input: unknown): Promise<
    { ok: true; data: { rank: string } } | { ok: false; error: ... }>;
  ```
  `addColumn` takes `{ boardId, name, afterColumnId: string | null }` — it is the one action that legitimately takes a `boardId`, because there is no row to resolve one from, and it checks that board directly. `moveColumn` takes `{ columnId, beforeColumnId, afterColumnId }`, left-to-right.

- [x] **Step 1: Write the failing test**

Create `lib/actions/columns.test.ts`:

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

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];

let columnRow: { id: string; boardId: string } | undefined;
let boardColumnRows: { id: string; rank: string }[] = [];
let cardsInColumn: { id: string; rank: string }[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const query = {
  columns: { findFirst: async () => columnRow, findMany: async () => boardColumnRows },
  cards: { findMany: async () => cardsInColumn },
};

const tx = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return {
        returning: async () => [{ id: 'col-new', ...(values as object) }],
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
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
  db: { query, transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));

const { addColumn, moveColumn, renameColumn } = await import('./columns');
const { BoardAccessError } = await import('@/lib/permissions');

beforeEach(() => {
  ops.length = 0;
  columnRow = { id: 'col-2', boardId: 'b1' };
  boardColumnRows = [
    { id: 'col-1', rank: 'a0' },
    { id: 'col-2', rank: 'a1' },
    { id: 'col-3', rank: 'a2' },
  ];
  cardsInColumn = [];
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('addColumn', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null })).resolves.toEqual(
      { ok: false, error: 'UNAUTHENTICATED' },
    );
  });

  test('refuses an empty name', async () => {
    await expect(addColumn({ boardId: 'b1', name: '  ', afterColumnId: null })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  // The one action that takes a boardId, because there is no row to resolve one
  // from. It is checked directly rather than believed.
  test('checks the board it was given, at member', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null })).resolves.toEqual(
      { ok: false, error: 'FORBIDDEN' },
    );
  });

  test('appends at the end when no column is named', async () => {
    const result = await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });

    expect((result as { data: { rank: string } }).data.rank > 'a2').toBe(true);
  });

  test('inserts between the named column and the one after it', async () => {
    const result = await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: 'col-1' });

    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
  });

  test('refuses a named column that is not on the board', async () => {
    await expect(
      addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: 'elsewhere' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('bumps the board', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('renameColumn', () => {
  test('refuses a column that is not there', async () => {
    columnRow = undefined;
    await expect(renameColumn({ columnId: 'gone', name: 'Blocked' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('writes the trimmed name and bumps the board', async () => {
    await renameColumn({ columnId: 'col-2', name: '  Blocked  ' });

    expect(ops.filter((op) => op.table === 'columns')).toEqual([
      { kind: 'update', table: 'columns', values: { name: 'Blocked' } },
    ]);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'update', table: 'boards' }));
  });
});

describe('moveColumn', () => {
  test('refuses a neighbour that is not on the board', async () => {
    await expect(
      moveColumn({ columnId: 'col-3', beforeColumnId: 'elsewhere', afterColumnId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses neighbours in the wrong order', async () => {
    await expect(
      moveColumn({ columnId: 'col-1', beforeColumnId: 'col-3', afterColumnId: 'col-2' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('ranks between the two neighbours, writing one row', async () => {
    const result = await moveColumn({
      columnId: 'col-3',
      beforeColumnId: 'col-1',
      afterColumnId: 'col-2',
    });

    const rank = (result as { data: { rank: string } }).data.rank;
    expect(rank > 'a0' && rank < 'a1').toBe(true);
    expect(ops.filter((op) => op.table === 'columns')).toHaveLength(1);
  });

  test('moves to the far left when nothing is before it', async () => {
    const result = await moveColumn({
      columnId: 'col-3',
      beforeColumnId: null,
      afterColumnId: 'col-1',
    });

    expect((result as { data: { rank: string } }).data.rank < 'a0').toBe(true);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/columns.test.ts`
Expected: FAIL — `./columns` does not exist.

- [x] **Step 3: Write the implementation**

Create `lib/actions/columns.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { columns } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { rankBetween } from '@/lib/rank';

import { boardIdForColumn, touchBoard, type Tx } from './scope';

const columnName = z.string().trim().min(1).max(60);
const id = z.string().min(1);

const addSchema = z.object({ boardId: id, name: columnName, afterColumnId: id.nullable() });
const renameSchema = z.object({ columnId: id, name: columnName });
const moveSchema = z.object({
  columnId: id,
  beforeColumnId: id.nullable(),
  afterColumnId: id.nullable(),
});

function siblingColumns(tx: Tx, boardId: string) {
  return tx.query.columns.findMany({
    where: (column, { eq: is }) => is(column.boardId, boardId),
    columns: { id: true, rank: true },
    orderBy: (column, { asc }) => [asc(column.rank)],
  });
}

export async function addColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, name, afterColumnId } = parsed.data;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);

    const position = afterColumnId
      ? siblings.findIndex((column) => column.id === afterColumnId)
      : siblings.length - 1;
    if (afterColumnId && position === -1) return null;

    const rank = rankBetween(siblings[position]?.rank ?? null, siblings[position + 1]?.rank ?? null);

    const [row] = await tx.insert(columns).values({ boardId, name, rank }).returning();
    await touchBoard(tx, boardId);
    return { id: row.id, rank };
  });

  if (!created) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  return { ok: true, data: created } as const;
}

export async function renameColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForColumn(parsed.data.columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(columns)
      .set({ name: parsed.data.name })
      .where(eq(columns.id, parsed.data.columnId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function moveColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { columnId, beforeColumnId, afterColumnId } = parsed.data;
  if (beforeColumnId && beforeColumnId === afterColumnId) {
    return { ok: false, error: 'INVALID' } as const;
  }

  const boardId = await boardIdForColumn(columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const rank = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);

    const before = beforeColumnId ? siblings.find((c) => c.id === beforeColumnId) : null;
    const after = afterColumnId ? siblings.find((c) => c.id === afterColumnId) : null;

    if ((beforeColumnId && !before) || (afterColumnId && !after)) return null;
    if (before && after && before.rank >= after.rank) return null;

    const next = rankBetween(before?.rank ?? null, after?.rank ?? null);

    await tx.update(columns).set({ rank: next }).where(eq(columns.id, columnId));
    await touchBoard(tx, boardId);
    return next;
  });

  if (rank === null) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  return { ok: true, data: { rank } } as const;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/actions/columns.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/actions/columns.ts lib/actions/columns.test.ts
git commit -m "feat: add, rename and reorder a column"
```

---

### Task 8: `deleteColumn`

**Files:**
- Modify: `lib/actions/columns.ts`
- Modify: `lib/actions/columns.test.ts`

**Interfaces:**
- Consumes: `ranksAfter` from `@/lib/rank`, plus everything Task 7 produced.
- Produces:
  ```ts
  export function deleteColumn(input: unknown): Promise<
    | { ok: true }
    | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'LAST_COLUMN' }>;
  ```
  `LAST_COLUMN` is its own error so Section D's dialog can say why rather than showing a generic failure.

This is the only action in the sub-project that writes more than one card row, and that is inherent: every card in the deleted column moves. It re-ranks them after the target's last card rather than carrying their old ranks across, because two columns' ranks are independent and carrying them over would interleave the arrivals through the target's existing cards.

Both columns' cards are fetched in **one** query and split in JS. Two queries would work equally well; one keeps the transaction short and makes the mock in the test order-independent.

Nothing in the schema ties `cards.board_id` to `columns.board_id` — the denormalisation, and the permission check that keys off it, are both enforced only by this code. The tests below must therefore assert both halves: `'refuses a target on another board'` already proves the target must be one of `boardId`'s own `siblingColumns`, and the moved-card test asserts the update never touches `board_id` (it only sets `columnId` and `rank`).

- [x] **Step 1: Write the failing test**

In `lib/actions/columns.test.ts`, replace the `cards` entry of the `query` mock so a row carries its column:

```ts
let cardsInColumns: { id: string; columnId: string; rank: string }[] = [];

const query = {
  columns: { findFirst: async () => columnRow, findMany: async () => boardColumnRows },
  cards: { findMany: async () => cardsInColumns },
};
```

Delete the now-unused `cardsInColumn` declaration, and reset `cardsInColumns = []` in `beforeEach`. Then append, adding `deleteColumn` to the import:

```ts
describe('deleteColumn', () => {
  test('refuses a target on another board', async () => {
    await expect(
      deleteColumn({ columnId: 'col-2', targetColumnId: 'elsewhere' }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('refuses moving cards into the column being deleted', async () => {
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test("refuses to delete a board's last column", async () => {
    boardColumnRows = [{ id: 'col-2', rank: 'a0' }];
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-2' })).resolves.toEqual({
      ok: false,
      error: 'LAST_COLUMN',
    });
  });

  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  // CLAUDE.md: never cascade-delete cards with the column. Every card moves
  // first, and the column is only dropped afterwards, in the same transaction.
  test('moves every card to the target before dropping the column', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
      { id: 'card-t', columnId: 'col-1', rank: 'b00' },
    ];

    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: true,
    });

    const cardWrites = ops.filter((op) => op.table === 'cards');
    expect(cardWrites).toHaveLength(2);
    expect(cardWrites.every((op) => op.kind === 'update')).toBe(true);
    for (const write of cardWrites) {
      expect(write.values).toMatchObject({ columnId: 'col-1' });
      expect(write.values).not.toHaveProperty('boardId');
      expect((write.values as { rank: string }).rank > 'b00').toBe(true);
    }

    expect(ops.at(-2)).toMatchObject({ kind: 'delete', table: 'columns' });
    expect(ops.at(-1)).toMatchObject({ kind: 'update', table: 'boards' });
  });

  test('keeps the arriving cards in the order they had', async () => {
    cardsInColumns = [
      { id: 'card-x', columnId: 'col-2', rank: 'a0' },
      { id: 'card-y', columnId: 'col-2', rank: 'a1' },
    ];

    await deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' });

    const ranks = ops
      .filter((op) => op.table === 'cards')
      .map((op) => (op.values as { rank: string }).rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  test('deletes an empty column without writing a card row', async () => {
    await expect(deleteColumn({ columnId: 'col-2', targetColumnId: 'col-1' })).resolves.toEqual({
      ok: true,
    });
    expect(ops.filter((op) => op.table === 'cards')).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/columns.test.ts`
Expected: FAIL — `deleteColumn` is not exported.

- [x] **Step 3: Write the implementation**

Add to `lib/actions/columns.ts`. Extend the schema import list with `cards`, and add `ranksAfter` to the `@/lib/rank` import:

```ts
const deleteSchema = z.object({ columnId: id, targetColumnId: id });

export async function deleteColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { columnId, targetColumnId } = parsed.data;

  const boardId = await boardIdForColumn(columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const outcome = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);
    if (siblings.length <= 1) return 'LAST_COLUMN' as const;

    const target = siblings.find((column) => column.id === targetColumnId);
    if (!target || targetColumnId === columnId) return 'INVALID' as const;

    const affected = await tx.query.cards.findMany({
      where: (card, { inArray }) => inArray(card.columnId, [columnId, targetColumnId]),
      columns: { id: true, columnId: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const moving = affected.filter((card) => card.columnId === columnId);
    const arrivals = affected.filter((card) => card.columnId === targetColumnId);
    const ranks = ranksAfter(arrivals.at(-1)?.rank ?? null, moving.length);

    for (const [position, card] of moving.entries()) {
      await tx
        .update(cards)
        .set({ columnId: targetColumnId, rank: ranks[position] })
        .where(eq(cards.id, card.id));
    }

    await tx.delete(columns).where(eq(columns.id, columnId));
    await touchBoard(tx, boardId);
    return 'OK' as const;
  });

  if (outcome !== 'OK') return { ok: false, error: outcome } as const;

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/actions/columns.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/actions/columns.ts lib/actions/columns.test.ts
git commit -m "feat: delete a column into a named target"
```

---

### Section B gate

- [x] `pnpm typecheck && pnpm lint && pnpm test` pass, output observed. 139 tests across 15 files.
- [x] No action inlines a membership query; every access question goes through `assertBoardAccess`.
      `grep boardMembers lib/actions/cards.ts lib/actions/columns.ts lib/actions/scope.ts` returns nothing.
- [x] No card or column action takes a `boardId` for authorisation. `addColumn` takes one and checks it directly — confirm by reading all eight.
      Read: `createCard` resolves via `boardIdForColumn`; `renameCard`, `deleteCard` and `moveCard` via
      `boardIdForCard`; `renameColumn`, `moveColumn` and `deleteColumn` via `boardIdForColumn`.
      `addColumn` is the single exception and checks the board it was given. `moveCard` additionally
      resolves the *target* column's board and refuses a cross-board move before authorising.
- [x] `moveCard` and `moveColumn` each write exactly one row, asserted rather than assumed.
      Asserted in the tests by counting recorded writes, not by reading the implementation.
- [x] Every action bumps `boards.updatedAt` inside its transaction.
      Eight `touchBoard(tx, boardId)` calls, one per action, all inside the transaction callback.
- [x] Nothing user-visible changed. Say so in the PR.
      No component, route or query touched — the board still renders read-only column shells. Nothing
      calls any of the eight actions yet; Section C is the first caller.
- [x] Open the PR. Stop. Start Section C in a fresh session.

---

## Section C — Cards on the canvas

**Branch:** `feat/canvas-cards`

**Invoke the `frontend-design` skill before Task 10's implementation step**, per `CLAUDE.md`. It has not run for this sub-project yet; the spec deliberately did not invoke it. The brief it must serve is already written — "Design" in `CLAUDE.md`, and the flow spectrum `lib/flow.ts` already computes.

### Task 9: `lib/board-state.ts` — the reducer, its selectors, and its inverses

Pure. No React, no database, no server actions. It is the only place the canvas's rules live, and it is fully testable without rendering anything.

**Files:**
- Create: `lib/board-state.ts`
- Create: `lib/board-state.test.ts`

**Interfaces:**
- Consumes: nothing. This module imports only from `@/lib/rank` for the tests' convenience; the reducer itself takes ranks as inputs and never computes one.
- Produces:
  ```ts
  export type StateCard = {
    id: string; columnId: string; title: string; rank: string;
    createdAt: string; pending?: boolean;
  };
  export type StateColumn = { id: string; name: string; rank: string; pending?: boolean };
  export type BoardState = { columns: StateColumn[]; cards: StateCard[] };

  export type BoardAction =
    | { type: 'card.create'; card: StateCard }
    | { type: 'card.rename'; cardId: string; title: string }
    | { type: 'card.delete'; cardId: string }
    | { type: 'card.move'; cardId: string; toColumnId: string; rank: string }
    | { type: 'card.settle'; tempId: string; id: string; rank: string }
    | { type: 'column.create'; column: StateColumn }
    | { type: 'column.rename'; columnId: string; name: string }
    | { type: 'column.move'; columnId: string; rank: string }
    | { type: 'column.delete'; columnId: string; targetColumnId: string | null; ranks: string[] }
    | { type: 'column.settle'; tempId: string; id: string; rank: string };

  export function boardReducer(state: BoardState, action: BoardAction): BoardState;
  export function applyAll(state: BoardState, actions: BoardAction[]): BoardState;
  export function inverse(state: BoardState, action: BoardAction): BoardAction[];
  export function orderedColumns(state: BoardState): StateColumn[];
  export function cardsIn(state: BoardState, columnId: string): StateCard[];
  ```
  Tasks 10 through 18 all consume these. `inverse` is computed from the state **before** the action is applied, and returns an array because undoing a column delete means restoring the column *and* moving every card back.

**Why inverse operations rather than a snapshot:** restoring a snapshot also undoes anything that landed while the failed request was in flight. `card.settle` has no inverse — settling a temp id is a reconciliation with the server, not an optimistic guess, so it returns `[]`.

**Round-trip assertions compare rendered output, not raw state.** `BoardState`'s arrays carry no
ordering: `orderedColumns` and `cardsIn` both sort by rank, and every consumer from Task 10 onward
reads through them. An inverse therefore restores an entity's *identity*, not its array slot —
`card.create` appends, so undoing a delete puts the card back at the end of the array. Asserting
`toEqual(base())` on the state fails on that alone while every selector agrees, which is what it did
when this plan was first executed. Comparing `orderedColumns` plus `cardsIn` per column is
insensitive to the slot and stricter about what matters: it also pins the restored rank, which a
whole-state `toEqual` would let through if the reducer put the card back in the right position with
the wrong rank.

- [x] **Step 1: Write the failing test**

Create `lib/board-state.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  applyAll,
  boardReducer,
  cardsIn,
  inverse,
  orderedColumns,
  type BoardAction,
  type BoardState,
} from './board-state';

const base = (): BoardState => ({
  columns: [
    { id: 'col-1', name: 'Ready to Work', rank: 'a0' },
    { id: 'col-2', name: 'In Progress', rank: 'a1' },
  ],
  cards: [
    { id: 'card-a', columnId: 'col-1', title: 'First', rank: 'b0', createdAt: '2026-01-01' },
    { id: 'card-b', columnId: 'col-1', title: 'Second', rank: 'b1', createdAt: '2026-01-02' },
  ],
});

describe('selectors', () => {
  test('order columns by rank', () => {
    const state = { ...base(), columns: [...base().columns].reverse() };
    expect(orderedColumns(state).map((c) => c.id)).toEqual(['col-1', 'col-2']);
  });

  test("order a column's cards by rank and return only that column's", () => {
    expect(cardsIn(base(), 'col-1').map((c) => c.id)).toEqual(['card-a', 'card-b']);
    expect(cardsIn(base(), 'col-2')).toEqual([]);
  });

  // CLAUDE.md: if two ranks collide, break the tie on createdAt then id.
  test('break a rank collision on createdAt, then id', () => {
    const state: BoardState = {
      columns: base().columns,
      cards: [
        { id: 'z', columnId: 'col-1', title: 'z', rank: 'b0', createdAt: '2026-01-02' },
        { id: 'a', columnId: 'col-1', title: 'a', rank: 'b0', createdAt: '2026-01-01' },
        { id: 'b', columnId: 'col-1', title: 'b', rank: 'b0', createdAt: '2026-01-01' },
      ],
    };
    expect(cardsIn(state, 'col-1').map((c) => c.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('card actions', () => {
  test('create adds a card', () => {
    const card = {
      id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: '2026-02-01',
      pending: true,
    };
    const next = boardReducer(base(), { type: 'card.create', card });
    expect(cardsIn(next, 'col-2')).toEqual([card]);
  });

  test('rename changes only the title', () => {
    const next = boardReducer(base(), { type: 'card.rename', cardId: 'card-a', title: 'Renamed' });
    expect(next.cards.find((c) => c.id === 'card-a')).toMatchObject({
      title: 'Renamed', columnId: 'col-1', rank: 'b0',
    });
  });

  test('delete removes the card and leaves the rest alone', () => {
    const next = boardReducer(base(), { type: 'card.delete', cardId: 'card-a' });
    expect(next.cards.map((c) => c.id)).toEqual(['card-b']);
  });

  test('move sets the column and the rank', () => {
    const next = boardReducer(base(), {
      type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'd0',
    });
    expect(next.cards.find((c) => c.id === 'card-a')).toMatchObject({
      columnId: 'col-2', rank: 'd0',
    });
  });

  // A card holding a temp id has no server row yet; settling swaps in the real
  // id and rank so a later move does not name an id the server has never seen.
  test('settle swaps the temp id for the real one and clears pending', () => {
    const withTemp = boardReducer(base(), {
      type: 'card.create',
      card: { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x', pending: true },
    });

    const next = boardReducer(withTemp, { type: 'card.settle', tempId: 'tmp-1', id: 'card-c', rank: 'c9' });

    expect(cardsIn(next, 'col-2')).toEqual([
      { id: 'card-c', columnId: 'col-2', title: 'New', rank: 'c9', createdAt: 'x' },
    ]);
  });
});

describe('column actions', () => {
  test('create adds a column', () => {
    const column = { id: 'tmp-c', name: 'Blocked', rank: 'a2', pending: true };
    const next = boardReducer(base(), { type: 'column.create', column });
    expect(orderedColumns(next).map((c) => c.id)).toEqual(['col-1', 'col-2', 'tmp-c']);
  });

  test('rename changes only the name', () => {
    const next = boardReducer(base(), { type: 'column.rename', columnId: 'col-2', name: 'Doing' });
    expect(next.columns.find((c) => c.id === 'col-2')).toMatchObject({ name: 'Doing', rank: 'a1' });
  });

  test('move re-ranks one column', () => {
    const next = boardReducer(base(), { type: 'column.move', columnId: 'col-2', rank: 'Zz' });
    expect(orderedColumns(next).map((c) => c.id)).toEqual(['col-2', 'col-1']);
  });

  test('delete moves the cards to the target and drops the column', () => {
    const next = boardReducer(base(), {
      type: 'column.delete', columnId: 'col-1', targetColumnId: 'col-2', ranks: ['e0', 'e1'],
    });

    expect(next.columns.map((c) => c.id)).toEqual(['col-2']);
    expect(cardsIn(next, 'col-2').map((c) => [c.id, c.rank])).toEqual([
      ['card-a', 'e0'],
      ['card-b', 'e1'],
    ]);
  });

  test('delete with no target drops an empty column', () => {
    const next = boardReducer(base(), {
      type: 'column.delete', columnId: 'col-2', targetColumnId: null, ranks: [],
    });
    expect(next.columns.map((c) => c.id)).toEqual(['col-1']);
  });
});

describe('inverses', () => {
  // Compared through the selectors, not with toEqual on the state: raw array
  // position carries no meaning here — orderedColumns and cardsIn both sort by
  // rank, and an inverse restores an entity's identity, not its array slot.
  const rendered = (state: BoardState) =>
    orderedColumns(state).map((column) => [column, cardsIn(state, column.id)] as const);

  const restoresTheBoard = (action: BoardAction) => {
    const next = boardReducer(base(), action);
    expect(rendered(applyAll(next, inverse(base(), action)))).toEqual(rendered(base()));
  };

  test('undo a create by deleting it', () => {
    const card = { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x' };
    const action = { type: 'card.create', card } as const;

    restoresTheBoard(action);
  });

  test('undo a rename by restoring the old title', () => {
    const action = { type: 'card.rename', cardId: 'card-a', title: 'Renamed' } as const;
    restoresTheBoard(action);
  });

  test('undo a delete by putting the card back', () => {
    const action = { type: 'card.delete', cardId: 'card-a' } as const;
    restoresTheBoard(action);
  });

  test('undo a move by moving it back', () => {
    const action = { type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'z0' } as const;
    restoresTheBoard(action);
  });

  test('undo a column delete by restoring it and every card in it', () => {
    // Annotated rather than `as const`: `as const` makes `ranks` a readonly
    // tuple, which BoardAction's mutable string[] does not accept.
    const action: BoardAction = {
      type: 'column.delete',
      columnId: 'col-1',
      targetColumnId: 'col-2',
      ranks: ['e0', 'e1'],
    };
    restoresTheBoard(action);
  });

  test('settling is a reconciliation, so it has no inverse', () => {
    expect(inverse(base(), { type: 'card.settle', tempId: 't', id: 'r', rank: 'x' })).toEqual([]);
  });

  // The reason for inverses rather than a snapshot: reverting must not undo a
  // change that landed while the failed request was still in flight.
  test('an inverse leaves a change that landed in between untouched', () => {
    const failing = { type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'z0' } as const;
    const undo = inverse(base(), failing);

    const afterFailing = boardReducer(base(), failing);
    const meanwhile = boardReducer(afterFailing, {
      type: 'card.rename', cardId: 'card-b', title: 'Edited while in flight',
    });

    const reverted = applyAll(meanwhile, undo);

    expect(reverted.cards.find((c) => c.id === 'card-a')).toMatchObject({
      columnId: 'col-1', rank: 'b0',
    });
    expect(reverted.cards.find((c) => c.id === 'card-b')?.title).toBe('Edited while in flight');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/board-state.test.ts`
Expected: FAIL — `./board-state` does not exist.

- [x] **Step 3: Write the implementation**

Create `lib/board-state.ts`:

```ts
export type StateCard = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: string;
  pending?: boolean;
};

export type StateColumn = { id: string; name: string; rank: string; pending?: boolean };

export type BoardState = { columns: StateColumn[]; cards: StateCard[] };

export type BoardAction =
  | { type: 'card.create'; card: StateCard }
  | { type: 'card.rename'; cardId: string; title: string }
  | { type: 'card.delete'; cardId: string }
  | { type: 'card.move'; cardId: string; toColumnId: string; rank: string }
  | { type: 'card.settle'; tempId: string; id: string; rank: string }
  | { type: 'column.create'; column: StateColumn }
  | { type: 'column.rename'; columnId: string; name: string }
  | { type: 'column.move'; columnId: string; rank: string }
  | { type: 'column.delete'; columnId: string; targetColumnId: string | null; ranks: string[] }
  | { type: 'column.settle'; tempId: string; id: string; rank: string };

const byRank = <T extends { rank: string; id: string }>(a: T, b: T) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function orderedColumns(state: BoardState): StateColumn[] {
  return [...state.columns].sort(byRank);
}

export function cardsIn(state: BoardState, columnId: string): StateCard[] {
  return state.cards
    .filter((card) => card.columnId === columnId)
    .sort((a, b) =>
      a.rank !== b.rank
        ? byRank(a, b)
        : a.createdAt !== b.createdAt
          ? a.createdAt < b.createdAt
            ? -1
            : 1
          : byRank(a, b),
    );
}

const mapCard = (state: BoardState, cardId: string, change: (card: StateCard) => StateCard) => ({
  ...state,
  cards: state.cards.map((card) => (card.id === cardId ? change(card) : card)),
});

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'card.create':
      return { ...state, cards: [...state.cards, action.card] };

    case 'card.rename':
      return mapCard(state, action.cardId, (card) => ({ ...card, title: action.title }));

    case 'card.delete':
      return { ...state, cards: state.cards.filter((card) => card.id !== action.cardId) };

    case 'card.move':
      return mapCard(state, action.cardId, (card) => ({
        ...card,
        columnId: action.toColumnId,
        rank: action.rank,
      }));

    case 'card.settle':
      return mapCard(state, action.tempId, ({ pending: _pending, ...card }) => ({
        ...card,
        id: action.id,
        rank: action.rank,
      }));

    case 'column.create':
      return { ...state, columns: [...state.columns, action.column] };

    case 'column.rename':
      return {
        ...state,
        columns: state.columns.map((column) =>
          column.id === action.columnId ? { ...column, name: action.name } : column,
        ),
      };

    case 'column.move':
      return {
        ...state,
        columns: state.columns.map((column) =>
          column.id === action.columnId ? { ...column, rank: action.rank } : column,
        ),
      };

    case 'column.delete': {
      const moving = cardsIn(state, action.columnId);
      const ranks = new Map(moving.map((card, position) => [card.id, action.ranks[position]]));

      return {
        columns: state.columns.filter((column) => column.id !== action.columnId),
        cards: state.cards.map((card) =>
          ranks.has(card.id) && action.targetColumnId
            ? { ...card, columnId: action.targetColumnId, rank: ranks.get(card.id) ?? card.rank }
            : card,
        ),
      };
    }

    case 'column.settle':
      return {
        ...state,
        columns: state.columns.map(({ pending: _pending, ...column }) =>
          column.id === action.tempId ? { ...column, id: action.id, rank: action.rank } : column,
        ),
        cards: state.cards.map((card) =>
          card.columnId === action.tempId ? { ...card, columnId: action.id } : card,
        ),
      };
  }
}

export function applyAll(state: BoardState, actions: BoardAction[]): BoardState {
  return actions.reduce(boardReducer, state);
}

// Computed from the state BEFORE the action is applied. An array, because
// undoing a column delete means restoring the column and every card in it.
export function inverse(state: BoardState, action: BoardAction): BoardAction[] {
  switch (action.type) {
    case 'card.create':
      return [{ type: 'card.delete', cardId: action.card.id }];

    case 'card.rename': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.rename', cardId: card.id, title: card.title }] : [];
    }

    case 'card.delete': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.create', card }] : [];
    }

    case 'card.move': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card
        ? [{ type: 'card.move', cardId: card.id, toColumnId: card.columnId, rank: card.rank }]
        : [];
    }

    case 'column.create':
      return [
        { type: 'column.delete', columnId: action.column.id, targetColumnId: null, ranks: [] },
      ];

    case 'column.rename': {
      const column = state.columns.find((c) => c.id === action.columnId);
      return column ? [{ type: 'column.rename', columnId: column.id, name: column.name }] : [];
    }

    case 'column.move': {
      const column = state.columns.find((c) => c.id === action.columnId);
      return column ? [{ type: 'column.move', columnId: column.id, rank: column.rank }] : [];
    }

    case 'column.delete': {
      const column = state.columns.find((c) => c.id === action.columnId);
      if (!column) return [];
      return [
        { type: 'column.create', column },
        ...cardsIn(state, action.columnId).map(
          (card): BoardAction => ({
            type: 'card.move',
            cardId: card.id,
            toColumnId: card.columnId,
            rank: card.rank,
          }),
        ),
      ];
    }

    case 'card.settle':
    case 'column.settle':
      return [];
  }
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test lib/board-state.test.ts`
Expected: PASS, all of them. If the `toEqual(base())` inverse tests fail on a `pending` key, the `card.settle` and `column.settle` cases are not stripping it — fix there, not in the test.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/board-state.ts lib/board-state.test.ts
git commit -m "feat: the board's optimistic state, with inverse-operation rollback"
```

---

### Task 10: The canvas renders cards

Replaces `ColumnShell` with a client tree. `e2e/board-view.spec.ts` must keep passing unchanged — it asserts the five column names, and the `column-name` test id is a contract with it.

**Files:**
- Create: `components/board/board-canvas.tsx`
- Create: `components/board/board-column.tsx`
- Create: `components/board/board-card.tsx`
- Delete: `components/board/column-shell.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/page.tsx`

**Interfaces:**
- Consumes: `BoardWithCards` from `@/lib/boards` (**type-only**); `boardReducer`, `orderedColumns`, `cardsIn`, `type BoardState` from `@/lib/board-state`; `flowHue`, `flowColor` from `@/lib/flow`. **Nothing from `@/lib/permissions`** — see below.
- Produces:
  ```ts
  export function BoardCanvas(props: { board: BoardWithCards; canWrite: boolean }): JSX.Element;
  export function BoardColumn(props: {
    column: StateColumn; cards: StateCard[]; hue: number; nextHue: number; canWrite: boolean;
  }): JSX.Element;
  export function BoardCard(props: { card: StateCard; canWrite: boolean }): JSX.Element;
  ```
  Tasks 11 through 18 add props to these three; none of them ever import a server action — only `BoardCanvas` does.

- [x] **Step 1: Invoke the `frontend-design` skill**

Per `CLAUDE.md`, before writing any of this UI. The brief is already fixed by the "Design" section: card radius `--radius-card`, `--surface` with a 1px `--line` border and a shadow felt rather than seen; card title 14/20 weight 500; column header 12/600 uppercase at 0.08em tracking; the 3px flow rule and the 6% wash fading over 80px, both of which `column-shell.tsx` already implements correctly and which must survive the rewrite. **No warm colour anywhere in this sub-project** — there is no due date to signal yet.

- [x] **Step 2: Write the failing test**

Extend `e2e/board-view.spec.ts` with a card assertion, so the rewrite is proven to still render both columns and their contents. This is card rank ordering's only proof against a real database in the whole sub-project, so the two cards below are seeded with explicit ranks whose insertion order contradicts their rank order — 'Second' is inserted first but ranks after 'First'. Seeding them in rank order instead would let the assertion pass on insertion order alone and prove nothing about rank ordering; do not "simplify" it to that:

```ts
test("the board shows each column's cards in rank order", async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Second', rank: 'a1' });
  await seedCard(ready.id, { boardId, createdById: userId, title: 'First', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-title')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});
```

Add `boardColumns` and `seedCard` to that file's import from `./support/session`.

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/board-view.spec.ts`
Expected: FAIL — no element with the `card-title` test id; the shell renders "Nothing here yet".

- [x] **Step 4: Write the card**

Create `components/board/board-card.tsx`:

```tsx
'use client';

import type { StateCard } from '@/lib/board-state';

export function BoardCard({ card }: { card: StateCard; canWrite: boolean }) {
  return (
    <article
      data-card-id={card.id}
      className="group relative rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      <h3 data-testid="card-title" className="text-sm font-medium leading-5 text-ink">
        {card.title}
      </h3>
    </article>
  );
}
```

`canWrite` is accepted but unused until Task 12. Destructure it there rather than now, so this task adds no unused binding.

- [x] **Step 5: Write the column**

Create `components/board/board-column.tsx`, carrying over the gradient and wash from `column-shell.tsx` unchanged:

```tsx
'use client';

import { BoardCard } from '@/components/board/board-card';
import type { StateCard, StateColumn } from '@/lib/board-state';
import { flowColor } from '@/lib/flow';

// Columns sit flush so the 3px rules meet edge to edge and read as one band
// across the board; the 12px gutter is inset padding instead, which keeps the
// card width at 300px without breaking the spectrum.
export function BoardColumn({
  column,
  cards,
  hue,
  nextHue,
  canWrite,
}: {
  column: StateColumn;
  cards: StateCard[];
  hue: number;
  nextHue: number;
  canWrite: boolean;
}) {
  return (
    <section className="flex h-full w-[312px] shrink-0 flex-col">
      <div
        className="h-[3px] shrink-0"
        style={{ background: `linear-gradient(90deg, ${flowColor(hue)}, ${flowColor(nextHue)})` }}
      />
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4"
        style={{ background: `linear-gradient(${flowColor(hue, 0.06)}, transparent 80px)` }}
      >
        <h2
          data-testid="column-name"
          className="px-1.5 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
        >
          {column.name}
        </h2>

        {cards.length === 0 ? (
          <p className="px-1.5 pt-6 text-sm text-muted">Nothing here yet</p>
        ) : (
          <ul className="mt-3 space-y-2 px-1.5">
            {cards.map((card) => (
              <li key={card.id}>
                <BoardCard card={card} canWrite={canWrite} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [x] **Step 6: Write the canvas**

Create `components/board/board-canvas.tsx`:

```tsx
'use client';

import { useReducer } from 'react';

import { BoardColumn } from '@/components/board/board-column';
import { boardReducer, cardsIn, orderedColumns, type BoardState } from '@/lib/board-state';
import type { BoardWithCards } from '@/lib/boards';
import { flowHue } from '@/lib/flow';

// Seeded once, on mount. There is no realtime in this sub-project, so the
// reducer is the truth for the session and a reload is what re-reads the server.
function seed(board: BoardWithCards): BoardState {
  return {
    columns: board.columns.map(({ id, name, rank }) => ({ id, name, rank })),
    cards: board.columns.flatMap((column) =>
      column.cards.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        title: card.title,
        rank: card.rank,
        createdAt: card.createdAt.toISOString(),
      })),
    ),
  };
}

export function BoardCanvas({ board, canWrite }: { board: BoardWithCards; canWrite: boolean }) {
  const [state] = useReducer(boardReducer, board, seed);

  const columns = orderedColumns(state);
  const total = columns.length;

  return (
    <main className="h-full overflow-x-auto">
      <div className="flex h-full min-w-max">
        {columns.map((column, index) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={cardsIn(state, column.id)}
            hue={flowHue(index, total)}
            nextHue={flowHue(Math.min(index + 1, total - 1), total)}
            canWrite={canWrite}
          />
        ))}
      </div>
    </main>
  );
}
```

`useReducer`'s dispatch is deliberately not destructured yet — Task 11 is the first task that dispatches. ESLint will not complain about an unused array slot.

- [x] **Step 7: Point the page at it and delete the shell**

Replace the render in `app/(app)/(board)/boards/[boardId]/page.tsx`:

```tsx
return <BoardCanvas board={board} canWrite={atLeast(role, 'member')} />;
```

Remove the `ColumnShell` and `flowHue` imports from the page, add `BoardCanvas` and `atLeast`, and delete `components/board/column-shell.tsx`.

**The canvas takes the capability, not the role, and that is not a style preference.** `atLeast` lives
in `lib/permissions.ts`, which imports `lib/db`, which constructs a `pg` `Pool` at module scope. A
`'use client'` file that imports *anything* from `lib/permissions.ts` therefore pulls the driver into
the browser bundle, and the build fails with seven `Module not found` errors for `dns`, `fs`, `net`,
`tls` and `util/types`. This was written as `atLeast(role, 'member')` inside the canvas and failed
exactly that way on first execution. Deriving `canWrite` on the server costs nothing: it is the only
thing the canvas ever wanted, and Tasks 11, 12 and Section E all thread `canWrite` down rather than
the role. The one surviving `atLeast` call in Task 11 is in the board **layout**, a Server Component,
where it is fine.

`import type { BoardWithCards } from '@/lib/boards'` is safe for the same reason it looks unsafe:
`import type` is erased before bundling, so it pulls nothing. The distinction is the value import.

**`pnpm typecheck && pnpm lint && pnpm test` do not catch this** — all three pass on a client
component that imports the database. CI catches it only because Playwright's `webServer` runs
`next dev`, which fails to compile. If a task changes what a client component imports, run
`pnpm build`.

- [x] **Step 8: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/board-view.spec.ts`
Expected: PASS — including the pre-existing five-column and footer tests, which must not have changed.

- [x] **Step 9: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board "app/(app)/(board)/boards/[boardId]/page.tsx" e2e/board-view.spec.ts
git commit -m "feat: render a board's cards on a client canvas"
```

---

### Task 11: Creating a card, from two places, on one optimistic path

**Files:**
- Create: `components/board/add-card.tsx`
- Create: `components/board/board-actions.tsx`
- Create: `components/board/new-card-button.tsx`
- Modify: `components/app/top-bar.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`
- Modify: `components/board/board-canvas.tsx`, `components/board/board-column.tsx`
- Create: `e2e/cards.spec.ts`

**Interfaces:**
- Consumes: `createCard` from `@/lib/actions/cards`; `ranksAfter` from `@/lib/rank`.
- Produces:
  ```ts
  export function BoardActionsProvider(props: { children: React.ReactNode }): JSX.Element;
  export function useBoardActions(): {
    addCard: (() => void) | null;
    register: (fn: (() => void) | null) => void;
  };
  export function NewCardButton(): JSX.Element;
  export function AddCard(props: {
    columnName: string; open: boolean;
    onOpen: () => void; onClose: () => void; onSubmit: (title: string) => void;
  }): JSX.Element;
  ```
  `TopBar` grows an optional `actions?: React.ReactNode` slot rendered to the left of the account menu.

**Why a context:** a page cannot pass data up into its layout, and the top bar lives in the layout while the reducer lives in the page's tree. The layout wraps both, so a context that lets the canvas *register* a callback is the one place the two can meet — and it keeps the promise the spec makes, that both entry points share a single optimistic path.

**Three corrections, made while executing this task.**

`data-column-id` on the column `<section>` is added here, not in Task 12 Step 5 where this plan first
asks for it. Task 11's own third test locates `[data-column-id="${ready.id}"]`, so it cannot pass
without the attribute. Task 12's step is now a no-op for the attribute and only threads callbacks.

`AddCard` ties its label to its input with `useId()` rather than the planned `add-card-${columnName}`.
Every seeded column name contains spaces — `Ready to Work` — and whitespace is not legal in an HTML
`id`. Chromium happens to associate the label anyway, so `getByLabel('Card title')` would have passed
while the markup stayed invalid. The prop signature is unchanged.

Step 1's first test reloaded immediately after asserting the optimistic card, and failed: the reload
aborted the in-flight server action, so nothing was written. The row itself was never the problem —
querying `cards` three seconds after the submit returned it, with an empty status strip. The test now
waits for `[data-card-id^="tmp-"]` to reach zero before reloading, which is `card.settle` swapping the
temp id for the server's and so is the write landing rather than a sleep.

- [x] **Step 1: Write the failing test**

Create `e2e/cards.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('add a card from the column, and it survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await page.getByLabel('Card title').fill('Ship the migration');
    await page.getByLabel('Card title').press('Enter');

    await expect(page.getByTestId('card-title')).toHaveText(['Ship the migration']);

    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveText(['Ship the migration']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the composer stays open for the next card', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await page.getByLabel('Card title').fill('First');
    await page.getByLabel('Card title').press('Enter');
    await page.getByLabel('Card title').fill('Second');
    await page.getByLabel('Card title').press('Enter');

    await expect(page.getByTestId('card-title')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the header button adds to the first column', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'New card' }).click();
    await page.getByLabel('Card title').fill('From the header');
    await page.getByLabel('Card title').press('Enter');

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['From the header']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no way to add a card', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  // Replace the owner's cookie with a viewer's on the same board.
  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('column-name').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New card' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add card to/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
```

Add `seedMember` to that file's import.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/cards.spec.ts`
Expected: FAIL — no "Add card to Ready to Work" button exists.

- [x] **Step 3: Write the composer**

Create `components/board/add-card.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

export function AddCard({
  columnName,
  open,
  onOpen,
  onClose,
  onSubmit,
}: {
  columnName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full rounded-[var(--radius-control)] px-1.5 py-1.5 text-left text-sm text-muted hover:bg-ink/5 hover:text-ink"
      >
        Add card
      </button>
    );
  }

  return (
    <form
      className="mt-2 px-0.5"
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (next.length === 0) return;
        onSubmit(next);
        // Adding cards comes in runs, so the composer stays open for the next.
        setTitle('');
      }}
    >
      <label className="sr-only" htmlFor={`add-card-${columnName}`}>
        Card title
      </label>
      <input
        ref={input}
        id={`add-card-${columnName}`}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        onBlur={() => title.trim().length === 0 && onClose()}
        className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 text-sm text-ink"
      />
    </form>
  );
}
```

The `Add card` button needs a per-column accessible name so the e2e can target one column. Give it `aria-label={`Add card to ${columnName}`}`.

- [x] **Step 4: Write the actions context**

Create `components/board/board-actions.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Handler = () => void;

const BoardActionsContext = createContext<{
  addCard: Handler | null;
  register: (handler: Handler | null) => void;
} | null>(null);

export function BoardActionsProvider({ children }: { children: React.ReactNode }) {
  const [addCard, setAddCard] = useState<Handler | null>(null);

  // setState treats a bare function as an updater, so the handler is stored
  // behind one — passing it directly would call it instead of keeping it.
  const register = useCallback((handler: Handler | null) => setAddCard(() => handler), []);

  const value = useMemo(() => ({ addCard, register }), [addCard, register]);

  return <BoardActionsContext.Provider value={value}>{children}</BoardActionsContext.Provider>;
}

export function useBoardActions() {
  const context = useContext(BoardActionsContext);
  if (!context) throw new Error('useBoardActions used outside BoardActionsProvider');
  return context;
}
```

Create `components/board/new-card-button.tsx`:

```tsx
'use client';

import { useBoardActions } from '@/components/board/board-actions';

export function NewCardButton() {
  const { addCard } = useBoardActions();

  return (
    <button
      type="button"
      onClick={() => addCard?.()}
      disabled={!addCard}
      className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      New card
    </button>
  );
}
```

- [x] **Step 5: Give the top bar an actions slot**

In `components/app/top-bar.tsx`, add `actions?: React.ReactNode` to the props and render it beside the account menu:

```tsx
<div className="flex items-center gap-3">
  {actions}
  <AccountMenu userId={userId} name={name} email={email} image={image} />
</div>
```

In `app/(app)/(board)/boards/[boardId]/layout.tsx`, capture the role from `assertBoardAccess` as Task 3 did on the page, wrap the whole thing in the provider, and pass the button only to those who can write:

```tsx
return (
  <BoardActionsProvider>
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        title={board.name}
        actions={atLeast(role, 'member') ? <NewCardButton /> : null}
        userId={session.user.id}
        name={session.user.name ?? null}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  </BoardActionsProvider>
);
```

- [x] **Step 6: Wire the canvas**

In `components/board/board-canvas.tsx`, take `dispatch` from the reducer, hold which column's composer is open, register the header handler, and call the action:

```tsx
const [state, dispatch] = useReducer(boardReducer, board, seed);
const [composerIn, setComposerIn] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);
const { register } = useBoardActions();

const columns = orderedColumns(state);
const firstColumnId = columns[0]?.id ?? null;

useEffect(() => {
  register(canWrite && firstColumnId ? () => setComposerIn(firstColumnId) : null);
  return () => register(null);
}, [register, canWrite, firstColumnId]);

function addCard(columnId: string, title: string) {
  const tempId = `tmp-${crypto.randomUUID()}`;
  const last = cardsIn(state, columnId).at(-1);
  const card = {
    id: tempId,
    columnId,
    title,
    rank: ranksAfter(last?.rank ?? null, 1)[0],
    createdAt: new Date().toISOString(),
    pending: true,
  };

  dispatch({ type: 'card.create', card });
  setError(null);

  startTransition(async () => {
    const result = await createCard({ columnId, title });
    if (!result.ok) {
      dispatch({ type: 'card.delete', cardId: tempId });
      setError('That card could not be added. Try again.');
      return;
    }
    dispatch({ type: 'card.settle', tempId, id: result.data.id, rank: result.data.rank });
  });
}
```

`startTransition` comes from `useTransition`. Pass `composerIn === column.id`, `setComposerIn`, and `addCard` down to each `BoardColumn`, which renders `<AddCard />` below its card list when `canWrite`.

Render the status strip at the end of `<main>`:

```tsx
<p
  role="status"
  aria-live="polite"
  className="pointer-events-none fixed bottom-4 left-4 text-sm text-time-over"
>
  {error}
</p>
```

An empty `role="status"` region is correct — it must exist before the message arrives for the message to be announced.

- [x] **Step 7: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/cards.spec.ts e2e/board-view.spec.ts`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components app e2e/cards.spec.ts
git commit -m "feat: add a card from the column foot or the board header"
```

---

### Task 12: The card `⋯` menu — rename, move to, delete

**Files:**
- Create: `components/board/card-menu.tsx`
- Modify: `components/board/board-card.tsx`, `components/board/board-column.tsx`, `components/board/board-canvas.tsx`
- Modify: `e2e/cards.spec.ts`

**Interfaces:**
- Consumes: `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent` from `@/components/ui/dropdown-menu` — all already exported, no new primitive; `Dialog` as `board-row-menu.tsx` uses it; `renameCard`, `deleteCard`, `moveCard` from `@/lib/actions/cards`.
- Produces:
  ```ts
  export function CardMenu(props: {
    card: StateCard;
    columns: { id: string; name: string }[];
    onRename: (title: string) => void;
    onDelete: () => void;
    onMoveTo: (columnId: string) => void;
  }): JSX.Element;
  ```
  Section E adds nothing to this. The menu never calls an action — `BoardCanvas` owns every call.

- [x] **Step 1: Invoke the `frontend-design` skill** if it has not already run in this session, for the menu's hover/focus reveal on the card.

- [x] **Step 2: Write the failing test**

Append to `e2e/cards.spec.ts`:

```ts
test('rename a card, and the new title survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Typo' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Typo' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Card title').fill('Fixed');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('card-title')).toHaveText(['Fixed']);
    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveText(['Fixed']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('delete a card, and it stays gone', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Doomed' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Doomed' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete card' }).click();

    await expect(page.getByTestId('card-title')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

// Move to is the pointer-free path at every width, and the only cross-column
// move once the board collapses in Section F.
test('move a card to another column without dragging', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Travelling' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Travelling' }).click();
    await page.getByRole('menuitem', { name: 'Move to' }).click();
    await page.getByRole('menuitem', { name: 'In Progress' }).click();

    const target = page.locator(`[data-column-id="${inProgress.id}"]`);
    await expect(target.getByTestId('card-title')).toHaveText(['Travelling']);

    await page.reload();
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Travelling']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no card menu', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Read only' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-title')).toHaveText(['Read only']);
    await expect(page.getByRole('button', { name: /^Card actions for/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
```

`BoardColumn`'s outer `<section>` needs `data-column-id={column.id}` for these locators. Add it in Step 4.

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/cards.spec.ts`
Expected: FAIL — no "Card actions for Typo" button.

- [x] **Step 4: Write the menu**

Create `components/board/card-menu.tsx`, following `components/boards/board-row-menu.tsx`'s shape exactly — same dropdown, same dialog, same copy voice:

```tsx
'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StateCard } from '@/lib/board-state';

export function CardMenu({
  card,
  columns,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  columns: { id: string; name: string }[];
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  const [title, setTitle] = useState(card.title);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Card actions for ${card.title}`}
          disabled={card.pending}
          className="absolute right-1.5 top-1.5 rounded-[var(--radius-control)] px-1.5 text-muted opacity-0 hover:bg-ink/10 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {columns
                .filter((column) => column.id !== card.columnId)
                .map((column) => (
                  <DropdownMenuItem key={column.id} onSelect={() => onMoveTo(column.id)}>
                    {column.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Rename card</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = title.trim();
              if (next.length === 0) return;
              onRename(next);
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`rename-card-${card.id}`}>
              Card title
            </label>
            <input
              id={`rename-card-${card.id}`}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Save changes
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'delete'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Delete {card.title}</DialogTitle>
          <p className="mt-2 text-sm text-muted">This removes the card. It cannot be undone.</p>
          <button
            type="button"
            onClick={() => {
              onDelete();
              setOpen(null);
            }}
            className="mt-4 rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
          >
            Delete card
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

A card is deleted from a dialog with a plain confirm, not a typed name. A board is a container of everything; one card is not, and `CLAUDE.md`'s typed-name guard is scoped to board deletion.

**Three corrections, made while executing this task.**

The trigger is `flex h-6 w-6 items-center justify-center` rather than the planned `px-1.5`. A bare `⋯`
glyph with horizontal padding only is roughly a 20×16 target; 24px square is the floor this file's
"Quality floor" asks for, and it costs nothing visually because the control is transparent until
hover or focus.

`board-card.tsx` gives the title `pr-6` when `canWrite`. The trigger is absolutely positioned over the
card's top-right corner, so without it a title long enough to wrap runs underneath the `⋯`.

Step 2's three reload tests hit the same race Task 11 did: the optimistic update lands, the assertion
passes, and `page.reload()` then aborts the server action still in flight. Unlike `card.create` there
is no temp id to watch, so the spec waits on the action's own POST round trip via a `written(page)`
helper taken before the click. `data-column-id` needed by these locators was already added in Task 11,
so Step 5's instruction to add it is a no-op and only the callbacks are threaded.

The trigger is hidden while `card.pending` — the spec's rule that a card holding a temp id exposes no controls until the server has given it a real id.

- [x] **Step 5: Render it, and add the column id**

In `board-card.tsx`, accept `canWrite` and the three callbacks plus `columns`, and render `<CardMenu … />` inside the `<article>` when `canWrite`. In `board-column.tsx`, add `data-column-id={column.id}` to the `<section>` and thread the callbacks through.

- [x] **Step 6: Wire the three actions in the canvas**

In `board-canvas.tsx`, each follows the same shape — apply optimistically, compute the inverse from the pre-state, revert on failure:

```tsx
function run(action: BoardAction, call: () => Promise<{ ok: boolean }>, message: string) {
  const undo = inverse(state, action);
  dispatch(action);
  setError(null);

  startTransition(async () => {
    const result = await call();
    if (!result.ok) {
      for (const step of undo) dispatch(step);
      setError(message);
    }
  });
}

const renameCardTo = (card: StateCard, title: string) =>
  run(
    { type: 'card.rename', cardId: card.id, title },
    () => renameCard({ cardId: card.id, title }),
    'That card could not be renamed. Try again.',
  );

const removeCard = (card: StateCard) =>
  run(
    { type: 'card.delete', cardId: card.id },
    () => deleteCard({ cardId: card.id }),
    'That card could not be deleted. Try again.',
  );

const moveCardTo = (card: StateCard, toColumnId: string) => {
  const last = cardsIn(state, toColumnId).at(-1);
  return run(
    { type: 'card.move', cardId: card.id, toColumnId, rank: ranksAfter(last?.rank ?? null, 1)[0] },
    () =>
      moveCard({
        cardId: card.id,
        toColumnId,
        beforeCardId: last?.id ?? null,
        afterCardId: null,
      }),
    'That card could not be moved. Try again.',
  );
};
```

The optimistic rank and the server's rank are computed independently and will usually differ. That is harmless: both are strictly between the same two neighbours, so the resulting **order** is identical, and the next reload takes the server's value. Only the ordering is a contract; the string is not.

- [x] **Step 7: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/cards.spec.ts && pnpm test`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board e2e/cards.spec.ts
git commit -m "feat: rename, move and delete a card from its menu"
```

---

### Section C gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, output observed.
      typecheck clean; `pnpm build` clean; eslint 0 errors and 2 pre-existing `_pending` warnings in
      `lib/board-state.ts`; vitest 164 passed across 16 files; playwright 39 passed, exit 0.
- [x] `e2e/board-view.spec.ts` still passes unchanged — the flow rule, the wash and the five column names survived the rewrite from `ColumnShell`. `git diff 582a256..HEAD -- e2e/board-view.spec.ts` is empty, so Tasks 11 and 12 did not touch it.
- [x] `components/board/column-shell.tsx` is deleted, not left orphaned. It was renamed to `board-column.tsx` in 582a256; no file of that name exists.
- [x] No component except `board-canvas.tsx` imports a server action. `grep -rn "from '@/lib/actions/" components/` returns only `board-canvas.tsx` inside `components/board/`; the other three hits are the pre-existing account menu and board-list components.
- [x] A viewer, checked in a browser and not only in Playwright, sees a board with no "New card", no "Add card" and no card menus. Rendered at 1280x800 with the first card hovered and the screenshot read by eye, not only asserted: the header carries the avatar alone, no column has an "Add card" foot, and the hovered card shows no `⋯`.
- [ ] Screenshots of the board with cards, in both themes, attached to the PR. Captured at 1280x800 in
      both themes plus the viewer's board, and described in the PR body — but **not attached**, since
      images cannot be uploaded to GitHub from the CLI. They need dragging in by hand.
- [x] Open the PR. Stop. Start Section D in a fresh session. — PR #45.

---

## Section D — Columns on the canvas

**Branch:** `feat/canvas-columns`

**Invoke the `frontend-design` skill before Task 13's implementation step.**

### Task 13: The column `⋯` menu — rename, add, move left, move right

**Files:**
- Create: `components/board/column-menu.tsx`
- Modify: `components/board/board-column.tsx`, `components/board/board-canvas.tsx`
- Create: `e2e/columns.spec.ts`

**Interfaces:**
- Consumes: `addColumn`, `renameColumn`, `moveColumn` from `@/lib/actions/columns`; `rankBetween` from `@/lib/rank`.
- Produces:
  ```ts
  export function ColumnMenu(props: {
    column: StateColumn;
    isFirst: boolean;
    isLast: boolean;
    onRename: (name: string) => void;
    onAddAfter: (name: string) => void;
    onMove: (direction: 'left' | 'right') => void;
    onDelete: () => void;   // opens Task 14's dialog; a no-op stub in this task
  }): JSX.Element;
  ```

**How "move left" becomes neighbours:** the menu says a direction; the canvas turns it into the pair the action wants. For a column at index `i` in rank order, moving left lands it between `columns[i - 2]` and `columns[i - 1]`; moving right, between `columns[i + 1]` and `columns[i + 2]`. A missing neighbour is `null`, which is how the action is told "the far end". The direction never reaches the server — an index is stale the moment someone else moves something, and a direction is an index in disguise.

- [x] **Step 1: Write the failing test**

Create `e2e/columns.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
} from './support/session';

const DEFAULTS = ['Ready to Work', 'In Progress', 'In Testing', 'In Review', 'Done'];

test.afterAll(async () => {
  await closeSeedPool();
});

test('rename a column, and the name survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Testing' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Column name').fill('QA');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Progress', 'QA', 'In Review', 'Done',
    ]);
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Progress', 'QA', 'In Review', 'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('add a column to the right of another', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Add column right' }).click();
    await page.getByLabel('Column name').fill('Blocked');
    await page.getByRole('button', { name: 'Add column' }).click();

    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Progress', 'Blocked', 'In Testing', 'In Review', 'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('move a column left, and the order survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Testing' }).click();
    await page.getByRole('menuitem', { name: 'Move left' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Testing', 'In Progress', 'In Review', 'Done',
    ]);
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Testing', 'In Progress', 'In Review', 'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the end columns cannot be moved past the end', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for Ready to Work' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Column actions for Done' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move right' })).toBeDisabled();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no column menu', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('column-name')).toHaveText(DEFAULTS);
    await expect(page.getByRole('button', { name: /^Column actions for/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/columns.spec.ts`
Expected: FAIL — no "Column actions for In Testing" button.

- [x] **Step 3: Write the menu**

Create `components/board/column-menu.tsx`. Same primitives and the same dialog shape as `card-menu.tsx`; the trigger sits in the column header:

```tsx
'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StateColumn } from '@/lib/board-state';

export function ColumnMenu({
  column,
  isFirst,
  isLast,
  onRename,
  onAddAfter,
  onMove,
  onDelete,
}: {
  column: StateColumn;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onAddAfter: (name: string) => void;
  onMove: (direction: 'left' | 'right') => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<'rename' | 'add' | null>(null);
  const [name, setName] = useState(column.name);
  const [added, setAdded] = useState('');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Column actions for ${column.name}`}
          disabled={column.pending}
          className="rounded-[var(--radius-control)] px-1.5 text-muted hover:bg-ink/10 hover:text-ink disabled:hidden"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={() => onMove('left')}>
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={() => onMove('right')}>
            Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen('add')}>Add column right</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Rename column</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (next.length === 0) return;
              onRename(next);
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`rename-column-${column.id}`}>
              Column name
            </label>
            <input
              id={`rename-column-${column.id}`}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Save changes
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'add'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Add column</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = added.trim();
              if (next.length === 0) return;
              onAddAfter(next);
              setAdded('');
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`add-column-${column.id}`}>
              Column name
            </label>
            <input
              id={`add-column-${column.id}`}
              value={added}
              maxLength={60}
              onChange={(event) => setAdded(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Add column
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

Adding a column re-interpolates every hue, because `flowHue` takes the total. That is the signature behaviour from the design brief and needs no extra code — it falls out of rendering from `orderedColumns(state)`.

**Two corrections, made while executing this task.**

`onDelete` is typed `(() => void) | null` rather than `() => void`, and the Delete item renders only
when it is non-null. The plan asked for a no-op stub here and for Task 14 to hide the item on a
one-column board; a stub would have shipped a destructive menu item that silently does nothing for one
commit, which breaks the rule that every commit leaves the app working. Null expresses both "not wired
yet" and "not offered on the last column", so Task 14 only has to pass a function.

The trigger is a 24px square, matching `card-menu.tsx`. Unlike that one it is always visible rather
than revealed on hover: there are a handful of columns, not dozens of cards, and hiding the only way
to manage a column would make it undiscoverable. The `<h2>` keeps `data-testid="column-name"` and gains
`min-w-0 flex-1 truncate` so a long name cannot push the trigger out of the header.

- [x] **Step 4: Render it in the column header**

In `board-column.tsx`, wrap the `<h2>` and the menu in a flex row so the trigger sits at the header's right edge. Keep `data-testid="column-name"` on the `<h2>` itself — `e2e/board-view.spec.ts` reads its text and would pick up the `⋯` if the id moved to the wrapper.

- [x] **Step 5: Wire the canvas**

In `board-canvas.tsx`, using the same `run` helper Task 12 introduced:

```tsx
const renameColumnTo = (column: StateColumn, name: string) =>
  run(
    { type: 'column.rename', columnId: column.id, name },
    () => renameColumn({ columnId: column.id, name }),
    'That column could not be renamed. Try again.',
  );

const moveColumnBy = (column: StateColumn, direction: 'left' | 'right') => {
  const index = columns.findIndex((c) => c.id === column.id);
  const [before, after] =
    direction === 'left'
      ? [columns[index - 2] ?? null, columns[index - 1] ?? null]
      : [columns[index + 1] ?? null, columns[index + 2] ?? null];

  if (!after && !before) return;

  return run(
    { type: 'column.move', columnId: column.id, rank: rankBetween(before?.rank ?? null, after?.rank ?? null) },
    () =>
      moveColumn({
        columnId: column.id,
        beforeColumnId: before?.id ?? null,
        afterColumnId: after?.id ?? null,
      }),
    'That column could not be moved. Try again.',
  );
};

const addColumnAfter = (column: StateColumn, name: string) => {
  const index = columns.findIndex((c) => c.id === column.id);
  const tempId = `tmp-${crypto.randomUUID()}`;
  const rank = rankBetween(column.rank, columns[index + 1]?.rank ?? null);

  dispatch({ type: 'column.create', column: { id: tempId, name, rank, pending: true } });
  setError(null);

  startTransition(async () => {
    const result = await addColumn({ boardId: board.id, name, afterColumnId: column.id });
    if (!result.ok) {
      dispatch({ type: 'column.delete', columnId: tempId, targetColumnId: null, ranks: [] });
      setError('That column could not be added. Try again.');
      return;
    }
    dispatch({ type: 'column.settle', tempId, id: result.data.id, rank: result.data.rank });
  });
};
```

- [x] **Step 6: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/columns.spec.ts e2e/board-view.spec.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board e2e/columns.spec.ts
git commit -m "feat: rename, add and reorder a column from its menu"
```

---

### Task 14: Deleting a column into a named target

**Files:**
- Create: `components/board/delete-column-dialog.tsx`
- Modify: `components/board/column-menu.tsx`, `components/board/board-column.tsx`, `components/board/board-canvas.tsx`
- Modify: `e2e/columns.spec.ts`

**Interfaces:**
- Consumes: `deleteColumn` from `@/lib/actions/columns`; `ranksAfter` from `@/lib/rank`.
- Produces:
  ```ts
  export function DeleteColumnDialog(props: {
    column: StateColumn;
    others: StateColumn[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (targetColumnId: string) => void;
  }): JSX.Element;
  ```

The target defaults to the neighbour on the left, falling back to the neighbour on the right for the first column. **The dialog asks even when the column is empty** — a dialog that sometimes appears is worse than one that always does, and the answer is simply unused.

- [x] **Step 1: Write the failing test**

Append to `e2e/columns.spec.ts`:

```ts
test('deleting a column moves its cards into the named target', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Rehomed', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByLabel('Move its cards to').selectOption({ label: 'Ready to Work' });
    await page.getByRole('button', { name: 'Delete column' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Testing', 'In Review', 'Done',
    ]);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Rehomed']);

    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work', 'In Testing', 'In Review', 'Done',
    ]);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Rehomed']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('arriving cards land below the ones already there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Already here', rank: 'a0' });
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Arriving', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByLabel('Move its cards to').selectOption({ label: 'Ready to Work' });
    await page.getByRole('button', { name: 'Delete column' }).click();

    await page.reload();
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Already here', 'Arriving']);
  } finally {
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/columns.spec.ts`
Expected: FAIL — "Delete…" opens nothing.

- [x] **Step 3: Write the dialog**

Create `components/board/delete-column-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { StateColumn } from '@/lib/board-state';

export function DeleteColumnDialog({
  column,
  others,
  open,
  onOpenChange,
  onConfirm,
}: {
  column: StateColumn;
  others: StateColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetColumnId: string) => void;
}) {
  const [target, setTarget] = useState(others[0]?.id ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete {column.name}</DialogTitle>
        <p className="mt-2 text-sm text-muted">
          Its cards move to another column. Deleting the column cannot be undone.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!target) return;
            onConfirm(target);
            onOpenChange(false);
          }}
        >
          <label className="block text-sm text-muted" htmlFor={`target-${column.id}`}>
            Move its cards to
          </label>
          <select
            id={`target-${column.id}`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
          >
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
          >
            Delete column
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`others` is passed already ordered with the left neighbour first, so `others[0]` is the default the spec asks for. Compute it in `board-column.tsx` as `[left, ...everythingElse]`.

The `⋯` menu's Delete item is hidden entirely when the board has one column — the server returns `LAST_COLUMN`, but a control that can only fail should not be offered.

**One correction, made while executing this task.** `BoardColumn`'s `columns` prop widened from
`{ id, name }[]` to `StateColumn[]`. The dialog's `others` needs the same objects the canvas already
holds, and a `StateColumn[]` still satisfies the card menu's narrower `{ id, name }[]` by structural
typing, so nothing downstream changed. The dialog's open state lives in `board-column.tsx` rather than
in `ColumnMenu`, which keeps the menu ignorant of its siblings.

- [x] **Step 4: Wire the canvas**

```tsx
const removeColumn = (column: StateColumn, targetColumnId: string) => {
  const moving = cardsIn(state, column.id);
  const last = cardsIn(state, targetColumnId).at(-1);

  return run(
    {
      type: 'column.delete',
      columnId: column.id,
      targetColumnId,
      ranks: ranksAfter(last?.rank ?? null, moving.length),
    },
    () => deleteColumn({ columnId: column.id, targetColumnId }),
    'That column could not be deleted. Try again.',
  );
};
```

The inverse of `column.delete` restores the column and moves every card back, which Task 9 already implements and tested. Nothing extra is needed here for rollback.

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/columns.spec.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board e2e/columns.spec.ts
git commit -m "feat: delete a column into a target that keeps its cards"
```

---

### Section D gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, output observed.
      typecheck clean; `pnpm build` clean; eslint 0 errors and the 2 pre-existing `_pending` warnings
      in `lib/board-state.ts`; vitest 164 passed across 16 files; playwright 46 passed, exit 0.
- [x] Adding a sixth column re-interpolates the whole spectrum — confirmed by eye in a browser, not only by the passing test. Captured a five-column board, added "Blocked" through the menu, and captured it again at the same viewport: every column right of the insertion shifts hue, so the rule still runs one unbroken 225°→145° band over six columns instead of five.
- [x] A column holding cards cannot be deleted without naming a target, and the cards arrive below the target's existing ones. The dialog has no path that submits without a target, and `arriving cards land below the ones already there` seeds both cards at rank `a0`, so the asserted order can only come from the re-rank the delete performs.
- [x] The Delete item is not offered on a board with one column. Checked in a browser on a board reduced to one column: the menu offers Rename, a disabled Move left, a disabled Move right and Add column right, and no Delete item at all.
- [ ] Screenshots of a six-column board, both themes, attached to the PR. Captured in both themes and
      described in the PR body, but **not attached** — images cannot be uploaded to GitHub from the
      CLI, so this stays a manual step.
- [x] Open the PR. Stop. Start Section E in a fresh session. — PR #46.

---

## Section E — Drag and drop

**Branch:** `feat/canvas-dnd`

**Invoke the `frontend-design` skill before Task 17's implementation step**, for the drag and settle motion.

### Task 15: Prove dnd-kit v1 runs on React 19 — a throwaway spike

The spec records that `@dnd-kit/core` 6.3.1 declares `react >=16.8.0` and has **not been run against React 19.2.8 in this repository**, and that a permitted peer range is not evidence. Nothing in Section E is built until a card has been observed moving between two containers. Everything this task creates is deleted before it commits.

**Files:**
- Modify: `package.json` (dependencies only)
- Create then **delete**: `app/design/dnd-probe/page.tsx`

- [x] **Step 1: Install**

```bash
pnpm add @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
```

Pinned exactly, as `next`, `zod` and `fractional-indexing` already are in this repository.

- [x] **Step 2: Write the probe**

Create `app/design/dnd-probe/page.tsx` — a throwaway, under the existing `/design` route group so it inherits a layout:

```tsx
'use client';

import { DndContext, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';

function Item({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded border border-line bg-surface p-3"
    >
      {id}
    </div>
  );
}

function Box({ id, items }: { id: string; items: string[] }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="min-h-40 w-60 space-y-2 border border-line p-2">
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <Item key={item} id={item} />
        ))}
      </SortableContext>
    </div>
  );
}

export default function DndProbe() {
  const [boxes, setBoxes] = useState<Record<string, string[]>>({ A: ['a1', 'a2'], B: [] });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (!over) return;
        const from = Object.keys(boxes).find((key) => boxes[key].includes(String(active.id)));
        const to = boxes[String(over.id)] ? String(over.id) : Object.keys(boxes).find((key) => boxes[key].includes(String(over.id)));
        if (!from || !to || from === to) return;
        setBoxes((current) => ({
          ...current,
          [from]: current[from].filter((item) => item !== String(active.id)),
          [to]: [...current[to], String(active.id)],
        }));
      }}
    >
      <div className="flex gap-4 p-8">
        {Object.entries(boxes).map(([id, items]) => (
          <Box key={id} id={id} items={items} />
        ))}
      </div>
    </DndContext>
  );
}
```

- [x] **Step 3: Run it and observe**

```bash
pnpm dev
```

Open `http://localhost:3000/design/dnd-probe` and drag `a1` from box A into box B with the mouse. Then check the browser console for React errors or warnings.

**Record what you actually saw**, not what you expected. Three outcomes:

- **It works, console clean** — proceed to Step 4.
- **It works but warns** (a `ref`, `defaultProps` or lifecycle warning under React 19) — note the exact text in the PR body and proceed. A warning is not a blocker; an unrecorded warning is.
- **It does not work** — stop. Do not proceed to Task 16. Try `@dnd-kit/react@0.5.0` + `@dnd-kit/helpers@0.5.0` in the same probe, whose API is `DragDropProvider` with a `move()` helper rather than `DndContext`. Report which one works, and raise the stack-table change in `CLAUDE.md` before writing any of Task 16 — `CLAUDE.md` names the v1 packages, and changing that is a decision to be taken, not assumed.

**Observed, 2026-08-31, on React 19.2.8 / Next 16.3.3 with `@dnd-kit/core@6.3.1`,
`@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`.** Outcome: **it works, console clean.** No
change to `CLAUDE.md`'s stack table is needed and `@dnd-kit/react` was not tried.

The drag was driven through Chromium with real pointer events — press, cross the 5px activation
distance in steps, move, release — rather than by hand, because the Chrome the devtools MCP uses had
its profile locked by an earlier session. Same DOM events either way.

- **Cross-container drop works.** Box A `['a1','a2']` and B `[]` became A `['a2']` and B `['a1']`.
- **Console clean.** Two messages, both benign and both present on every page of this app: React's
  "Download the React DevTools" info line, and `[HMR] connected`. No React 19 warning about refs,
  `defaultProps` or lifecycles. No errors, no `pageerror`.
- **Sortable transforms are applied and animated.** Dragging `a1` down over `a2` inside one list gave
  the active item `transform: translate3d(0px, 63px, 0px)` and the sibling
  `transition: transform 200ms; transform: translate3d(0px, -58px, 0px)`.
- **Accessibility is intact out of the box.** The item carries `aria-roledescription="sortable"` and an
  `aria-describedby` pointing at dnd-kit's generated description, and its live region announced
  "Draggable item a1 was moved over droppable area B."

**One finding that changes Task 16 and 17:** the active item gets **no** transform while it is over a
*different* container — mid-drag its inline style was `""` on the A→B drag, against a real
`translate3d` on the within-list drag above. So the sortable transform only translates an item within
its own `SortableContext`, and a card dragged across columns will not follow the cursor on that hook
output alone. `DragOverlay` is what makes it follow, and Task 17's shadow, `scale(1.02)` and 3° tilt
belong on the overlay rather than on the card in place. Budget for it there rather than discovering it
mid-task.

- [x] **Step 4: Stop the server and delete the probe**

```bash
rm -rf app/design/dnd-probe
```

Stop `pnpm dev`. `CLAUDE.md`: anything you open, you close; clean up temporary files.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add package.json pnpm-lock.yaml
git commit -m "chore: add dnd-kit, proven against React 19"
```

The commit body records what the probe showed, including any warning text.

---

### Task 16: Dragging a card, optimistically

**Files:**
- Modify: `lib/board-state.ts`, `lib/board-state.test.ts`
- Modify: `components/board/board-canvas.tsx`, `components/board/board-column.tsx`, `components/board/board-card.tsx`
- Create: `e2e/board-dnd.spec.ts`

**Interfaces:**
- Consumes: `DndContext`, `PointerSensor`, `KeyboardSensor`, `useDroppable`, `useSensor`, `useSensors`, `closestCorners` from `@dnd-kit/core`; `SortableContext`, `useSortable`, `verticalListSortingStrategy`, `sortableKeyboardCoordinates` from `@dnd-kit/sortable`; `CSS` from `@dnd-kit/utilities`.
- Produces:
  ```ts
  // lib/board-state.ts
  export function dropTarget(state: BoardState, activeId: string, overId: string):
    { toColumnId: string; beforeCardId: string | null; afterCardId: string | null } | null;
  ```
  Kept pure and in the state module so the hardest part of the drag is unit-testable without a browser. `onDragEnd` becomes three lines that call it.

- [x] **Step 1: Write the failing test for `dropTarget`**

Append to `lib/board-state.test.ts`:

```ts
describe('dropTarget', () => {
  test('dropping on a column with nothing in it appends to it', () => {
    expect(dropTarget(base(), 'card-a', 'col-2')).toEqual({
      toColumnId: 'col-2', beforeCardId: null, afterCardId: null,
    });
  });

  test('dropping on a card puts the dragged card above it', () => {
    expect(dropTarget(base(), 'card-b', 'card-a')).toEqual({
      toColumnId: 'col-1', beforeCardId: null, afterCardId: 'card-a',
    });
  });

  // The dragged card is removed from the target list first, so it is never its
  // own neighbour — which would ask the server to rank a card against itself.
  test('never returns the dragged card as its own neighbour', () => {
    const state: BoardState = {
      columns: base().columns,
      cards: [
        { id: 'k1', columnId: 'col-1', title: '1', rank: 'b0', createdAt: '1' },
        { id: 'k2', columnId: 'col-1', title: '2', rank: 'b1', createdAt: '2' },
        { id: 'k3', columnId: 'col-1', title: '3', rank: 'b2', createdAt: '3' },
      ],
    };

    const target = dropTarget(state, 'k2', 'k3');

    expect(target).toEqual({ toColumnId: 'col-1', beforeCardId: 'k1', afterCardId: 'k3' });
  });

  test('dropping a card onto a column that already holds cards appends below them', () => {
    const state = boardReducer(base(), {
      type: 'card.move', cardId: 'card-b', toColumnId: 'col-2', rank: 'c0',
    });

    expect(dropTarget(state, 'card-a', 'col-2')).toEqual({
      toColumnId: 'col-2', beforeCardId: 'card-b', afterCardId: null,
    });
  });

  test('returns null when the drop target is neither a card nor a column', () => {
    expect(dropTarget(base(), 'card-a', 'nowhere')).toBeNull();
  });

  test('returns null when a card is dropped on itself', () => {
    expect(dropTarget(base(), 'card-a', 'card-a')).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/board-state.test.ts`
Expected: FAIL — `dropTarget` is not exported.

- [x] **Step 3: Write `dropTarget`**

Append to `lib/board-state.ts`:

```ts
export function dropTarget(
  state: BoardState,
  activeId: string,
  overId: string,
): { toColumnId: string; beforeCardId: string | null; afterCardId: string | null } | null {
  if (activeId === overId) return null;

  const overCard = state.cards.find((card) => card.id === overId);
  const toColumnId = overCard?.columnId ?? state.columns.find((c) => c.id === overId)?.id;
  if (!toColumnId) return null;

  const siblings = cardsIn(state, toColumnId).filter((card) => card.id !== activeId);
  const position = overCard ? siblings.findIndex((card) => card.id === overCard.id) : siblings.length;

  return {
    toColumnId,
    beforeCardId: siblings[position - 1]?.id ?? null,
    afterCardId: siblings[position]?.id ?? null,
  };
}
```

- [x] **Step 4: Run the unit tests and watch them pass**

Run: `pnpm test lib/board-state.test.ts`
Expected: PASS.

- [x] **Step 5: Write the failing e2e**

Create `e2e/board-dnd.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('drag a card into another column, and it stays there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Dragged', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Dragged' });
    await card.hover();
    await page.mouse.down();
    // Past the 5px activation distance first, so the sensor starts a drag
    // rather than a click, then into the target column.
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${inProgress.id}"]`).hover();
    await page.mouse.up();

    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Dragged']);

    await page.reload();
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Dragged']);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a click still opens nothing but does not move the card', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Clicked', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    // The 5px activation distance exists so a click reaches the card body,
    // which sub-project 5 makes open the modal.
    await page.locator('[data-card-id]').filter({ hasText: 'Clicked' }).click();

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Clicked']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer cannot drag', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Fixed', rank: 'a0' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${inProgress.id}"]`).hover();
    await page.mouse.up();

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Fixed']);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
```

- [x] **Step 6: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/board-dnd.spec.ts`
Expected: FAIL — the card does not move; nothing is draggable yet.

- [x] **Step 7: Make the card sortable**

In `board-card.tsx`:

```tsx
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: card.id,
  disabled: !canWrite || card.pending === true,
});
```

Spread `{...attributes} {...listeners}` on the `<article>`, set `ref={setNodeRef}`, and apply `style={{ transform: CSS.Transform.toString(transform), transition }}`. **Do not strip dnd-kit's accessibility props** — `attributes` carries `aria-roledescription` and the announcements `CLAUDE.md` requires.

The `⋯` trigger sits inside a draggable element, so give it `onPointerDown={(event) => event.stopPropagation()}` — otherwise the sensor swallows the press and the menu never opens.

- [x] **Step 8: Make the column droppable**

In `board-column.tsx`, wrap the card list in a `SortableContext` and make the scrollable body the droppable:

```tsx
const { setNodeRef } = useDroppable({ id: column.id });
```

```tsx
<SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
```

The droppable ref goes on the scrolling `<div>`, not the `<section>`, so the whole empty area below the cards is a drop target.

- [x] **Step 9: Wire the context and the move**

In `board-canvas.tsx`:

```tsx
const sensors = useSensors(
  // ~5px so a click still reaches the card body, which sub-project 5 uses.
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);

function onDragEnd({ active, over }: DragEndEvent) {
  if (!over || !canWrite) return;

  const target = dropTarget(state, String(active.id), String(over.id));
  if (!target) return;

  const before = target.beforeCardId
    ? state.cards.find((card) => card.id === target.beforeCardId)
    : null;
  const after = target.afterCardId
    ? state.cards.find((card) => card.id === target.afterCardId)
    : null;

  run(
    {
      type: 'card.move',
      cardId: String(active.id),
      toColumnId: target.toColumnId,
      rank: rankBetween(before?.rank ?? null, after?.rank ?? null),
    },
    () => moveCard({ cardId: String(active.id), ...target }),
    'That card could not be moved. Try again.',
  );
}
```

Wrap the board in `<DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>`.

The optimistic rank and the server's rank are computed independently from the same neighbour pair, so they order identically even when the strings differ — the same property Task 12 relies on.

**Two corrections to Step 5's e2e, both found by running it.**

The drag test moved to the target column immediately after crossing the activation distance, and the
drop was silently ignored. dnd-kit had not started the drag yet, so the `pointermove` landed on a
context that was not dragging. Confirmed by reading dnd-kit's own live region mid-drag: it said
"was moved over droppable area `<the card's own id>`" rather than the column's. The test now waits for
the card to carry dnd-kit's `translate3d` transform — a real "the drag is running" signal — before
moving to the target, rather than sleeping.

Then the same reload race Tasks 11, 12 and 14 hit: the optimistic assertion passed and `page.reload()`
aborted the in-flight `moveCard`. It waits on `written(page)` first. **Both bugs were in the test, not
the implementation** — the optimistic move was correct from the first run.

- [x] **Step 10: Run the tests and watch them pass**

Run: `pnpm exec playwright test e2e/board-dnd.spec.ts e2e/cards.spec.ts e2e/columns.spec.ts`
Expected: PASS. If the drag test is flaky, the cause is almost always the activation distance — add an intermediate `page.mouse.move` step rather than raising the timeout.

- [x] **Step 11: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add lib/board-state.ts lib/board-state.test.ts components/board e2e/board-dnd.spec.ts
git commit -m "feat: drag a card between columns, optimistically"
```

---

### Task 17: The drag's motion

**Files:**
- Modify: `components/board/board-card.tsx`, `app/globals.css`

The one place the interface acknowledges physicality, per the design brief — and the only motion work in the sub-project.

- [x] **Step 1: Invoke the `frontend-design` skill.**

- [x] **Step 2: Write the implementation**

On the card, while `isDragging`: a real shadow, `scale(1.02)` and a 3° tilt, composed onto dnd-kit's own transform rather than replacing it:

```tsx
const style = {
  transform: isDragging
    ? `${CSS.Transform.toString(transform)} scale(1.02) rotate(3deg)`
    : CSS.Transform.toString(transform),
  transition,
};
```

The drop settle is 180ms `cubic-bezier(0.2, 0, 0, 1)` on **transform only** — never on layout properties. dnd-kit supplies `transition` during a sort; override its duration and easing through `useSortable`'s `transition` option rather than a CSS rule that would also catch the drag itself.

Cards arriving in a column fade in over 200ms with a 4px rise. Add a keyframe in `app/globals.css` and apply it to `<article>` on mount.

**Correction: this task needs a `DragOverlay`, which the plan does not mention.** Putting the tilt on
the card behind `isDragging` only works while the card is inside its own `SortableContext`. Measured on
the real board: dragging within a column gives the card `translate3d(0px, 20px, 0px)`, but with the
pointer over the next column its inline style is `""` and its box is still at `x: 12` while the pointer
is at `x: 468`. The card does not follow the cursor across columns, so the shadow, scale and tilt would
be invisible during exactly the drag they exist for. Task 15's spike predicted this and it is recorded
there.

So the overlay is what follows the cursor, and it carries the motion. The card left behind takes
`opacity-40`, which reads as the hole it came from rather than a second copy. The overlay is
`aria-hidden` and carries **neither** `data-card-id` nor `data-testid="card-title"` — a second element
with that testid would break `toHaveText([...])` in every existing spec. Verified: three seeded cards
give three `card-title` elements mid-drag, not four.

Observed with `emulateMedia`: `no-preference` gives the overlay
`transform: scale(1.02) rotate(3deg)`, `reduce` gives it no transform while the card still follows the
pointer. `dropAnimation={null}` because the reducer has already moved the card by the time the overlay
would animate home, so the default animation flies it to the wrong place.

- [x] **Step 3: Respect `prefers-reduced-motion`**

No tilt, no rise. In `globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .card-enter { animation: none; }
}
```

and drop the `rotate`/`scale` when the query matches, read once with `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')` so it is not sampled on every render.

- [x] **Step 4: Verify by eye and by audit**

```bash
pnpm dev
```

Drag a card and watch the tilt and the settle. Then set the OS reduced-motion preference (macOS: System Settings → Accessibility → Display → Reduce motion) and confirm the tilt and the rise are gone while the card still moves. Stop the dev server.

- [x] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board/board-card.tsx app/globals.css
git commit -m "feat: the drag tilt, the settle, and the reduced-motion path"
```

---

### Section E gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, output observed.
      typecheck clean; `pnpm build` clean; eslint 0 errors and the 2 pre-existing `_pending` warnings
      in `lib/board-state.ts`; vitest 170 passed across 16 files; playwright 49 passed of 49, exit 0.
      **Read the exit code, not the summary line.** `playwright test | tail -n` reports the exit status
      of `tail`, so a failing suite looks like a passing one; three failures hid behind an "exited with
      code 0" that way during this section. Redirect to a file and echo `$?`.
- [x] Task 15's probe outcome is recorded in the PR body, including any React 19 console warning, and `app/design/dnd-probe/` is gone. There were no React warnings — only the DevTools info line and `[HMR] connected`. `app/design/` holds `layout.tsx`, `page.tsx` and `theme-toggle.tsx` and nothing else.
- [x] A card dragged across columns survives a reload, and **exactly one `cards` row changed** — confirmed with a `select` against the dev branch, not inferred from the UI. Three cards seeded, all rows selected before and after: exactly one differed on `column_id` or `rank`, it was the dragged one, and its `column_id` was the target column's.
- [x] **A rejected move puts the card back and says so in the status strip.** Forced, not hoped for: `moveCard` was temporarily made to return `{ ok: false, error: 'INVALID' }`. The card was dragged to In Testing, and afterwards Ready to Work held `["Rejected"]`, In Testing held `[]`, and the strip read "That card could not be moved. Try again." The change is reverted — `git diff` on `lib/actions/cards.ts` is empty.
- [x] Keyboard drag works: tab to a card, space, arrow keys, space. dnd-kit's announcements are audible to a screen reader and its `attributes` were not stripped. Focus, Space, ArrowRight, Space moved a card to the next column and it survived a reload. The focused element carries `aria-roledescription="sortable"`, and the live region announced the pick-up, each move, the drop, and "Dragging was cancelled" on Escape.
      **One limitation, found here and worth knowing:** `sortableKeyboardCoordinates` navigates between *sortable items*, so an **empty** column cannot be reached by keyboard — the arrow keys have nothing there to land on. **Move to** in the card menu is the pointer-free path that does reach it, which is also what Section F relies on at 360px.
- [x] A click on a card body does not move it — the 5px activation distance is intact. `e2e/board-dnd.spec.ts` clicks a card and asserts it is still in its column.
- [ ] Screenshots or a capture of a drag in progress attached to the PR. Captured mid-drag in both
      motion settings and described in the PR body, but **not attached** — images cannot be uploaded
      to GitHub from the CLI.
- [x] Open the PR. Stop. Start Section F in a fresh session. — PR #48.

---

## Section F — The board at 360px

**Branch:** `feat/canvas-responsive`

The spec's interpretation, restated because it is what this section implements: *"horizontal scroll is dropped rather than shrunk"* is read as **do not shrink the columns**. Every column stays mounted; below 700px the board becomes a scroll-snap container at one column per screen, and the switcher scrolls between them. No `matchMedia`-driven second tree, no width-conditional components, and drag keeps working inside the visible column. Cross-column moves at that width go through **Move to**, which Task 12 already shipped at every width.

### Task 18: Scroll-snap collapse and the column switcher

**Files:**
- Create: `components/board/column-switcher.tsx`
- Modify: `components/board/board-canvas.tsx`, `components/board/board-column.tsx`
- Create: `e2e/board-responsive.spec.ts`

**Interfaces:**
- Consumes: `orderedColumns` from `@/lib/board-state`.
- Produces:
  ```ts
  export function ColumnSwitcher(props: {
    columns: StateColumn[];
    activeId: string | null;
    onSelect: (columnId: string) => void;
  }): JSX.Element;
  ```

- [x] **Step 1: Write the failing test**

Create `e2e/board-responsive.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

test.use({ viewport: { width: 360, height: 720 } });

test.afterAll(async () => {
  await closeSeedPool();
});

test('one column fills the viewport at 360px', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);

  try {
    await page.goto(`/boards/${boardId}`);

    const width = await page
      .locator(`[data-column-id="${ready.id}"]`)
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(320);
    expect(width).toBeLessThanOrEqual(360);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the switcher reaches a column that is off screen', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [, , , , done] = await boardColumns(boardId);
  await seedCard(done.id, { boardId, createdById: userId, title: 'Finished', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('tab', { name: 'Done' }).click();

    await expect(
      page.locator(`[data-column-id="${done.id}"]`).getByTestId('card-title'),
    ).toBeInViewport();
  } finally {
    await removeSeededUser(userId);
  }
});

// CLAUDE.md locks body scroll on the board route. The snap container scrolls;
// the page itself must not.
test('the page itself never scrolls sideways', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the switcher is gone on a wide viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByRole('tablist')).toBeHidden();
  } finally {
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test e2e/board-responsive.spec.ts`
Expected: FAIL — the column is 312px wide at every viewport and there is no tablist.
Observed: exit 1, 2 failed of 4 — the width assertion got 312, and the tablist
never appeared. The other two passed already: the page did not overflow
sideways before this section either, and `toBeHidden` is satisfied by an
element that is absent.

- [x] **Step 3: Write the switcher**

Create `components/board/column-switcher.tsx`:

```tsx
'use client';

import type { StateColumn } from '@/lib/board-state';

export function ColumnSwitcher({
  columns,
  activeId,
  onSelect,
}: {
  columns: StateColumn[];
  activeId: string | null;
  onSelect: (columnId: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Columns"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 min-[700px]:hidden"
    >
      {columns.map((column) => (
        <button
          key={column.id}
          role="tab"
          type="button"
          aria-selected={column.id === activeId}
          onClick={() => onSelect(column.id)}
          className="shrink-0 rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted aria-selected:bg-ink/10 aria-selected:text-ink"
        >
          {column.name}
        </button>
      ))}
    </div>
  );
}
```

- [x] **Step 4: Make the board snap**

In `board-column.tsx`, the `<section>` becomes full-width below 700px and 312px above it, and a snap target:

```tsx
className="flex h-full w-screen shrink-0 snap-start flex-col min-[700px]:w-[312px] min-[700px]:snap-align-none"
```

In `board-canvas.tsx`, the scroll container gains snapping below 700px only:

```tsx
<div className="flex h-full min-w-max snap-x snap-mandatory min-[700px]:snap-none">
```

**Corrected while implementing.** That div is not the scroll container — `<main>`
carries `overflow-x-auto`, and snapping only applies to the element that
scrolls. The switcher also has to sit outside the scrolling element or it
scrolls away with the columns. So `<main>` became `flex h-full flex-col`
holding the switcher and a scrolling
`min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto min-[700px]:snap-none`
div, which wraps the existing `flex h-full min-w-max` row.

- [x] **Step 5: Track and drive the active column**

In `board-canvas.tsx`, hold a ref per column, scroll on select, and track what is on screen so the tab follows a manual swipe rather than only a click:

```tsx
const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
const columnRefs = useRef(new Map<string, HTMLElement>());

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      const id = visible?.target.getAttribute('data-column-id');
      if (id) setActiveColumnId(id);
    },
    { threshold: 0.6 },
  );

  for (const element of columnRefs.current.values()) observer.observe(element);
  return () => observer.disconnect();
}, [columns.length]);

const showColumn = (columnId: string) =>
  columnRefs.current.get(columnId)?.scrollIntoView({ behavior: 'smooth', inline: 'start' });
```

Render `<ColumnSwitcher columns={columns} activeId={activeColumnId} onSelect={showColumn} />` above the scroll container. It hides itself with `min-[700px]:hidden`, so there is one tree at every width.

`scrollIntoView` with `behavior: 'smooth'` must also honour reduced motion — pass `'auto'` when the same `matchMedia` check Task 17 added returns true.

**Corrected while implementing.** `entries.find((entry) => entry.isIntersecting)`
leaves the tab on a column nobody can see. A callback only carries the columns
whose visibility *changed*: crossing the breakpoint from 1280 back down to 360
reports the four columns that left, none of them intersecting, so the id set
arbitrarily while the board was wide survives. Caught in the browser — the
switcher read "In Progress" over a visible "Ready to Work". The observer now
keeps each column's ratio in a `Map` across callbacks and takes the largest,
with `threshold: [0.6, 1]` so the settled column reports 1 and wins.

- [x] **Step 6: Run the tests and watch them pass**

Run: `pnpm exec playwright test`
Expected: PASS, the whole suite. Section F changes layout, so every earlier board spec is a regression test for it.

- [x] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add components/board e2e/board-responsive.spec.ts
git commit -m "feat: one column at a time below 700px, with a switcher"
```

---

### Section F gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, output observed.
      typecheck clean; eslint 0 errors and the 2 pre-existing `_pending` warnings in
      `lib/board-state.ts`; vitest 170 passed across 16 files; playwright **55 passed of 55
      collected, exit 0** — 49 before this section, plus this section's 6. Read from a
      redirected log and `echo $?`, not from a pipeline's summary line.
- [x] The board is usable at 360px **in a real browser**, not only in Playwright: one column fills the viewport, the switcher reaches every column, and nothing overflows the page sideways.
      Chrome at an emulated 360x720: every column measured 360px wide at offsets 0, 360,
      720, 1080, 1440; `documentElement.scrollWidth === clientWidth`; clicking the **Done**
      tab put its card on screen at left 25, and the tab followed a manual scroll to
      In Testing without a click.
- [x] Dragging a card still works at 360px within the visible column, and **Move to** is how it crosses columns.
      Both are now in `e2e/board-responsive.spec.ts`. Two findings behind them, neither a
      defect: dropping over a card inserts *before* it (`dropTarget`), so the reordering
      gesture is dragging the lower card up — the reverse asserts nothing and fails at
      1280 too; and at 360px the Move-to submenu collision-flips to the left, where Radix
      keeps it open only while the recorded direction of travel matches the side it opened
      on (`isPointerMovingToSubmenu` against `pointerDirRef`, which defaults to `right`).
      A teleporting `.click()` records no direction and the submenu closes before the
      click lands; a pointer path — which is what a person produces — keeps it open. The
      test moves the mouse in steps for that reason. `collisionPadding` on the parent menu
      cannot avoid the flip: Radix wraps `shift` in `limitShift`, so the menu will not
      detach from its trigger, measured unmoved even at 400px.
- [x] The wide board is unchanged — 312px columns, no snapping, no switcher.
      At a real 1280px window: all five columns 312px, `scroll-snap-type: none`,
      `scroll-snap-align: none`, the tablist `display: none`, no sideways page overflow.
- [ ] Screenshots at 360px and at 1280px, both themes, attached to the PR.
      Captured at 360x720 and 1280x800 in both themes and described in the PR body, but
      **not attached** — images cannot be uploaded to GitHub from the CLI.
- [ ] Open the PR. Stop.

---

## Verification — the whole sub-project

Copied from `docs/specs/board-canvas.md`. Tick these only against observed output, and close them in the final section's PR or a short `docs/` follow-up, as sub-project 3 did.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass locally.
- [ ] Deleting a board that holds columns and cards succeeds and leaves no rows in any of the three tables, with the referential action confirmed in `pg_constraint` rather than only in `schema.ts`.
- [ ] Deleting a column that holds cards, without naming a target, is refused by the database and not only by `deleteColumn`.
- [ ] A card dragged to another column is in that column after a reload, and exactly one `cards` row changed.
- [ ] A rejected move puts the card back where it was and says so in the status strip — forced, not hoped for.
- [ ] A `viewer` sees a board with no create buttons, no `⋯` menus, and cannot drag; and the actions refuse a `viewer` even when called directly.
- [ ] The board is usable at 360px in a real browser.
- [ ] `docker compose up --build` still reaches a healthy app container with the new migration applied — confirmed with `\dt` against the container's Postgres, not on `db:migrate`'s success line.

## What this plan deliberately does not build

Restated from the spec so it is not rediscovered as a gap mid-implementation:

- **The card modal.** A card body is inert in this sub-project. Description, due date and comments are sub-project 5.
- **Any warm colour.** There is no way to set a due date yet, so the overdue strip has nothing to signal.
- **Realtime.** Every action here is a candidate `publish()` call site in sub-project 6 and none of them make one.
- **Column drag.** Deferred against its cost, not rejected. The ranks and `moveColumn`'s signature already support it.
- **A card count in the column header.** Raised in the spec's open decisions; decide it during Section D's design pass rather than adding it silently.
