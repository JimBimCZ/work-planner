# Labels — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member defines a small set of labels on a board, puts them on cards, and filters the board down to the cards carrying all of a chosen set.

**Architecture:** A `labels` table per board and a `card_labels` join table, both cascading. `lib/actions/labels.ts` holds all four writes in the house action shape. The board's existing query carries each card's label ids, so the client already holds everything the filter needs; the filter itself lives in the URL, never in board state. Four new Pusher events keep an open board honest about a vocabulary that changed under it.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript strict, drizzle-orm 0.45.2 + drizzle-kit, Zod 4.5.4, Postgres (Neon `dev` branch locally), Vitest, Playwright, Pusher Channels, Tailwind v4.

**Spec:** `docs/specs/labels.md` — read it before Task A1 and keep it open; this plan argues from it.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Verified API surfaces.** `IndexBuilderOn.on()` accepts a `SQL` expression in drizzle-orm 0.45.2 (`node_modules/drizzle-orm/pg-core/indexes.d.ts:42`), which is what makes the case-folded unique index in Task A1 real. `uniqueIndex` is exported from `drizzle-orm/pg-core` (`indexes.d.ts:78`) but is **not yet imported** in `lib/db/schema.ts` — add it. `primaryKey({ columns: [...] })` has its precedent at `lib/db/schema.ts:92`. Zod is 4.5.4. Do not substitute remembered signatures for these.
- **Action shape, in this order:** `auth()` → `safeParse` → resolve the board from the row → `assertBoardAccess` → transaction → publish after the transaction commits → return a discriminated `{ ok }` object. Never throw for an expected failure.
- **Never trust an id from the client for authorisation** — and that includes label ids. `setCardLabels` must refuse a label belonging to another board.
- **`lib/permissions.ts` and `lib/events.ts` are server-only.** A `'use client'` file importing any *value* from either pulls the pg pool or the Pusher SDK into the browser bundle, and only `pnpm build` catches it — typecheck, lint and test all pass. `import type` is erased and is safe.
- **`LABEL_NAME_MAX = 32` and `LABELS_PER_BOARD = 50`**, defined once in `lib/labels.ts`. The second is load-bearing: it is what keeps `card.labelled`'s payload (50 ids × 36 bytes ≈ 1.8KB) clear of `PAYLOAD_CEILING`. Neither is a check constraint — both are tunable product limits, and `CLAUDE.md` reserves database constraints for invariants.
- **No colour anywhere.** No `colour` column, no hue on a chip, no new token. `CLAUDE.md`'s three colour roles stand; the card face uses the existing 12px mono muted face. See `docs/specs/labels.md` "Non-goals" before arguing with this.
- **Copy:** active voice, sentence case, no filler. Errors say what happened and what to do, and never apologise.
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
| `lib/db/schema.ts` | Add `labels`, `cardLabels`, their relations, and `cards.cardLabels` |
| `lib/db/migrations/0005_*.sql` | Generated, never hand-edited |
| `lib/labels.ts` | `boardLabels` read, and the two caps |
| `lib/labels.test.ts` | Ordering and board scoping |
| `lib/actions/labels.ts` | All four writes |
| `lib/events.ts` | The four event names: added in Section A, bound in Section D |
| `lib/actions/labels.test.ts` | Guard order, error codes, rows written, publish-after-commit |
| `lib/boards.ts` | The board query carries each card's label ids |
| `lib/board-state.ts` | `StateCard.labelIds`, `BoardState.labels`, `matchesFilter` |
| `components/board/board-card.tsx` | The mono label line under the due date |
| `components/board/card-labels.tsx` | `'use client'` — the card modal's picker |
| `components/board/label-filter.tsx` | `'use client'` — the filter popover and label management |
| `e2e/schema.spec.ts` | The database invariants this adds |
| `e2e/labels.spec.ts` | The flows, grown across sections B, C and D |

---

# Section A — schema, reads and actions

No UI, no events. Branch `feat/labels-actions` from `main`.

### Task A1: The `labels` and `card_labels` tables

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0005_*.sql` (generated)
- Modify: `e2e/schema.spec.ts`

**Interfaces:**
- Produces: `labels` and `cardLabels` tables, exported from `lib/db/schema.ts`; `cards.cardLabels` as a `many` relation so the board query can pull assignments in one round trip.

- [ ] **Step 1: Write the failing test**

Add to `e2e/schema.spec.ts`. These are database invariants, which is why they live here and not in Vitest — the fold and the cascades are Postgres's behaviour, not Zod's:

```ts
test('a board cannot hold two labels whose names differ only in case', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Vocabulary');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
      'label-lower',
      boardId,
      'bug',
    ]);
    await expect(
      pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
        'label-upper',
        boardId,
        'Bug',
      ]),
    ).rejects.toThrow();
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a label takes it off every card that carried it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascading labels');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
      'label-doomed',
      boardId,
      'chore',
    ]);
    await pool.query('insert into card_labels (card_id, label_id) values ($1, $2)', [
      cardId,
      'label-doomed',
    ]);
    await pool.query('delete from labels where id = $1', ['label-doomed']);

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from card_labels where card_id = $1',
      [cardId],
    );
    expect(rows[0].n, 'the assignment should have gone with the label').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: FAIL — `relation "labels" does not exist`.

- [ ] **Step 3: Add the tables**

In `lib/db/schema.ts`, add `uniqueIndex` to the existing `drizzle-orm/pg-core` import, then, after the `cards` table:

```ts
export const labels = pgTable(
  'labels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // lower(): 'Bug' and 'bug' must not become two filters. The same fold
    // inviteMember applies to an address, for the same reason.
    uniqueIndex('labels_board_id_name_key').on(t.boardId, sql`lower(${t.name})`),
  ],
);

export const cardLabels = pgTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.labelId] }),
    index('card_labels_label_id_idx').on(t.labelId),
  ],
);
```

Then the relations, beside the existing ones:

```ts
export const labelsRelations = relations(labels, ({ one, many }) => ({
  board: one(boards, { fields: [labels.boardId], references: [boards.id] }),
  cardLabels: many(cardLabels),
}));

export const cardLabelsRelations = relations(cardLabels, ({ one }) => ({
  card: one(cards, { fields: [cardLabels.cardId], references: [cards.id] }),
  label: one(labels, { fields: [cardLabels.labelId], references: [labels.id] }),
}));
```

and add `cardLabels: many(cardLabels)` to the existing `cardsRelations`. Without that line the board query in Task B1 cannot reach assignments and drizzle fails at runtime, not at compile time.

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm db:generate > /tmp/gen.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/gen.log
pnpm db:migrate > /tmp/migrate.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/migrate.log
```

Never hand-edit the generated SQL. Confirm the tables exist rather than trusting the success line — `CLAUDE.md` records a run that printed `migrations applied successfully!` against the wrong database:

```bash
psql "$DATABASE_URL_UNPOOLED" -c '\d labels' -c '\d card_labels'
```

Expect `labels_board_id_name_key` to be a unique index on `(board_id, lower(name))`, and `card_labels` to have a two-column primary key.

- [ ] **Step 5: Run the test to watch it pass**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

Expected: `EXIT=0`, with the count run equal to the count collected.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations e2e/schema.spec.ts
git commit -m "feat: add labels and card_labels, folded on name"
```

### Task A2: The read, and the two caps

**Files:**
- Create: `lib/labels.ts`, `lib/labels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LABEL_NAME_MAX = 32;
  export const LABELS_PER_BOARD = 50;
  export type BoardLabel = { id: string; name: string };
  export async function boardLabels(boardId: string): Promise<BoardLabel[]>;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/labels.test.ts`. The db is mocked the way `lib/members.test.ts` mocks it — this asserts the query's shape and ordering, not Postgres. The `where` and `orderBy` tests invoke the captured callbacks with stub column identifiers and stub operators, so a regression that drops the board scope or the case-fold fails the test rather than merely failing to be checked:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

type EqCall = ['eq', unknown, unknown];
type AscCall = ['asc', unknown];
type SqlExpr = { strings: readonly string[]; values: unknown[] };
type WhereHelpers = { eq: (column: unknown, value: unknown) => EqCall };
type OrderHelpers = {
  asc: (expr: unknown) => AscCall;
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => SqlExpr;
};
type Config = {
  columns: Record<string, boolean>;
  where: (cols: Record<string, string>, helpers: WhereHelpers) => unknown;
  orderBy: (cols: Record<string, string>, helpers: OrderHelpers) => unknown[];
};

const findMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: { labels: { findMany: (args: unknown) => findMany(args) } } },
}));

const { LABELS_PER_BOARD, LABEL_NAME_MAX, boardLabels } = await import('./labels');

// Stub column identifiers, the same role `table` plays in members.test.ts:
// the callback under test only needs to see *some* value per column name.
const cols = { boardId: 'boardId', name: 'name' };

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

test('the caps are the numbers the payload maths depends on', () => {
  expect(LABEL_NAME_MAX).toBe(32);
  // 50 ids at 36 bytes is roughly 1.8KB, well under PAYLOAD_CEILING's 8192.
  expect(LABELS_PER_BOARD).toBe(50);
});

test('reads only this board, and only id and name', async () => {
  await boardLabels('board-1');
  const [args] = findMany.mock.calls[0] as [Config];
  expect(args.columns).toEqual({ id: true, name: true });
  expect(findMany).toHaveBeenCalledTimes(1);

  const eq = vi.fn((column: unknown, value: unknown): EqCall => ['eq', column, value]);
  const clause = args.where(cols, { eq });
  expect(eq).toHaveBeenCalledWith('boardId', 'board-1');
  expect(clause).toEqual(['eq', 'boardId', 'board-1']);
});

test('orders case-folded by name, not the bare column', async () => {
  await boardLabels('board-1');
  const [args] = findMany.mock.calls[0] as [Config];

  const asc = vi.fn((expr: unknown): AscCall => ['asc', expr]);
  const sql = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]): SqlExpr => ({
      strings: [...strings],
      values,
    }),
  );
  const [orderExpr] = args.orderBy(cols, { asc, sql });

  expect(sql).toHaveBeenCalledTimes(1);
  expect(orderExpr).toEqual(['asc', { strings: ['lower(', ')'], values: ['name'] }]);
});

test('hands back what the query returned, unchanged', async () => {
  findMany.mockResolvedValue([
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'chore' },
  ]);
  await expect(boardLabels('board-1')).resolves.toEqual([
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'chore' },
  ]);
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/labels.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — cannot resolve `./labels`.

- [ ] **Step 3: Write it**

Create `lib/labels.ts`:

```ts
import { db } from '@/lib/db';

export const LABEL_NAME_MAX = 32;

// Not a check constraint: a tunable product limit, not an invariant. It is
// load-bearing rather than cosmetic — a card's label ids travel in a realtime
// payload, and 50 ids at 36 bytes stays far under PAYLOAD_CEILING.
export const LABELS_PER_BOARD = 50;

export type BoardLabel = { id: string; name: string };

export async function boardLabels(boardId: string): Promise<BoardLabel[]> {
  return db.query.labels.findMany({
    where: (label, { eq }) => eq(label.boardId, boardId),
    columns: { id: true, name: true },
    orderBy: (label, { asc, sql }) => [asc(sql`lower(${label.name})`)],
  });
}
```

Ordering folds case for the same reason the unique index does: `Bug` must sit beside `bug`, not before every lower-case name.

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/labels.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/labels.ts lib/labels.test.ts
git commit -m "feat: read a board's labels, case-folded"
```

### Task A3: Creating, renaming and deleting a label

**Files:**
- Create: `lib/actions/labels.ts`, `lib/actions/labels.test.ts`

**Interfaces:**
- Consumes: `LABELS_PER_BOARD`, `LABEL_NAME_MAX` from `lib/labels.ts`; `assertBoardAccess`, `boardAccessResult` from `lib/permissions.ts`; `touchBoard`, `Tx` from `lib/actions/scope.ts`.
- Produces:
  ```ts
  export async function createLabel(input: unknown): Promise<
    | { ok: true; data: { id: string } }
    | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'DUPLICATE' | 'LIMIT_REACHED' }
  >;
  export async function renameLabel(input: unknown): Promise<...>;
  export async function deleteLabel(input: unknown): Promise<...>;
  ```
  Each input carries `mutationId: string`. `createLabel` takes `{ boardId, name, mutationId }`; the other two take `{ labelId, ... }` and resolve the board from the row.

- [ ] **Step 1: Write the failing test**

Create `lib/actions/labels.test.ts`, modelled on `lib/actions/members.test.ts` — the same op-recording db double, so read that file first:

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

const publish = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
});

type Op = { kind: 'insert' | 'update' | 'delete'; table: string; values?: unknown };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

let labelRow: { id: string; boardId: string; name: string } | undefined;
let labelCount = 0;
let insertRejects: Error | undefined;
let updateRejects: Error | undefined;

const query = {
  labels: {
    findFirst: async () => labelRow,
    findMany: async () => Array.from({ length: labelCount }, (_, i) => ({ id: `l${i}` })),
  },
};

const writer = {
  query,
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      if (insertRejects) throw insertRejects;
      ops.push({ kind: 'insert', table: tableName(table), values });
      return { returning: async () => [{ id: 'label-new' }], onConflictDoNothing: async () => undefined };
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        if (updateRejects) throw updateRejects;
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

const { createLabel, deleteLabel, renameLabel } = await import('./labels');

const signedIn = { user: { id: 'user-1', email: 'dev@example.test' } };
const MUTATION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  ops.length = 0;
  labelRow = undefined;
  labelCount = 0;
  insertRejects = undefined;
  updateRejects = undefined;
  authMock.mockReset();
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  publish.mockReset();
});

describe('createLabel', () => {
  const input = { boardId: 'board-1', name: 'bug', mutationId: MUTATION_ID };

  test('refuses a request with no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(ops).toEqual([]);
  });

  test('refuses a name past the cap before it writes anything', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: 'x'.repeat(33) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(ops).toEqual([]);
  });

  test('refuses a blank name, including one that is only spaces', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('demands member on the board before it writes anything', async () => {
    authMock.mockResolvedValue(signedIn);
    await createLabel(input);
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'board-1', 'member');
  });

  test('refuses the fifty-first label', async () => {
    authMock.mockResolvedValue(signedIn);
    labelCount = 50;
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'LIMIT_REACHED' });
    expect(ops).toEqual([]);
  });

  // The database owns this, not a pre-read: two simultaneous creates would
  // both pass a check-then-insert.
  test('turns the unique violation into DUPLICATE', async () => {
    authMock.mockResolvedValue(signedIn);
    insertRejects = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(createLabel(input)).resolves.toEqual({ ok: false, error: 'DUPLICATE' });
  });

  test('stores the name trimmed, and announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(createLabel({ ...input, name: '  bug  ' })).resolves.toEqual({
      ok: true,
      data: { id: 'label-new' },
    });
    expect(ops).toEqual([
      { kind: 'insert', table: 'labels', values: { boardId: 'board-1', name: 'bug' } },
    ]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'label.created',
      id: 'label-new',
      name: 'bug',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });
});

describe('renameLabel', () => {
  test('answers NOT_FOUND for a label that is not there, without checking access', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(
      renameLabel({ labelId: 'nope', name: 'chore', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  // The client says which label, never which board: the row is what decides
  // whose permission is checked.
  test('checks the board named by the row, not by the caller', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-9', name: 'bug' };
    await renameLabel({ labelId: 'label-1', name: 'chore', mutationId: MUTATION_ID });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'board-9', 'member');
    expect(ops).toEqual([{ kind: 'update', table: 'labels', values: { name: 'chore' } }]);
    expect(publish).toHaveBeenCalledWith('board-9', {
      type: 'label.updated',
      id: 'label-1',
      name: 'chore',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  test('turns the unique violation into DUPLICATE', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    updateRejects = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(
      renameLabel({ labelId: 'label-1', name: 'Bug', mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: false, error: 'DUPLICATE' });
  });
});

describe('deleteLabel', () => {
  test('deletes the row and announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    await expect(deleteLabel({ labelId: 'label-1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(ops).toEqual([{ kind: 'delete', table: 'labels' }]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'label.deleted',
      id: 'label-1',
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  test('refuses a viewer', async () => {
    authMock.mockResolvedValue(signedIn);
    labelRow = { id: 'label-1', boardId: 'board-1', name: 'bug' };
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(deleteLabel({ labelId: 'label-1', mutationId: MUTATION_ID })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(ops).toEqual([]);
  });
});
```

Read `lib/permissions.ts` before writing that last test: `BoardAccessError`'s constructor argument and what `boardAccessResult` maps it to are what the expectation has to match. If the constructor takes a different shape, fix the test to match the source, not the source to match the test.

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/labels.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — cannot resolve `./labels`.

- [ ] **Step 3: Write the three actions**

Create `lib/actions/labels.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { labels } from '@/lib/db/schema';
import { publish } from '@/lib/events';
import { LABEL_NAME_MAX, LABELS_PER_BOARD } from '@/lib/labels';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

const id = z.string().min(1);
const mutationId = z.string().min(1);

// Trimmed before validation, not after: a pasted name brings its whitespace,
// and '   ' must fail the minimum rather than be stored as three spaces.
const labelName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1).max(LABEL_NAME_MAX),
);

const createSchema = z.object({ boardId: id, name: labelName, mutationId });
const renameSchema = z.object({ labelId: id, name: labelName, mutationId });
const deleteSchema = z.object({ labelId: id, mutationId });

// Postgres's unique_violation. The database owns uniqueness because a
// check-then-insert lets two simultaneous creates both pass the check.
const isDuplicate = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

async function labelScope(labelId: string) {
  const label = await db.query.labels.findFirst({
    where: (row, { eq: is }) => is(row.id, labelId),
    columns: { id: true, boardId: true, name: true },
  });
  return label ?? null;
}

export async function createLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, name } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // A guard, not an invariant: two simultaneous creates can both read 49 and
  // both succeed. Admitting a fifty-first label costs nothing — the payload
  // maths has an order of magnitude of headroom — and the alternatives are a
  // lock or a constraint, neither of which this limit is worth.
  const existing = await db.query.labels.findMany({
    where: (label, { eq: is }) => is(label.boardId, boardId),
    columns: { id: true },
  });
  if (existing.length >= LABELS_PER_BOARD) {
    return { ok: false, error: 'LIMIT_REACHED' } as const;
  }

  let created;
  try {
    [created] = await db.insert(labels).values({ boardId, name }).returning({ id: labels.id });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, error: 'DUPLICATE' } as const;
    throw error;
  }

  await publish(boardId, {
    type: 'label.created',
    id: created.id,
    name,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  revalidatePath('/boards');
  return { ok: true, data: { id: created.id } } as const;
}

export async function renameLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const label = await labelScope(parsed.data.labelId);
  if (!label) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, label.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const { name } = parsed.data;
  try {
    await db.update(labels).set({ name }).where(eq(labels.id, label.id));
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, error: 'DUPLICATE' } as const;
    throw error;
  }

  await publish(label.boardId, {
    type: 'label.updated',
    id: label.id,
    name,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function deleteLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const label = await labelScope(parsed.data.labelId);
  if (!label) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, label.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // card_labels cascades, so the assignments go with the row. That cascade is
  // asserted in e2e/schema.spec.ts rather than trusted.
  await db.delete(labels).where(eq(labels.id, label.id));

  await publish(label.boardId, {
    type: 'label.deleted',
    id: label.id,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

**The event union comes with this task, not with Section D.** Publishing from the start means no action is written twice, but `CLAUDE.md` forbids pushing a branch whose `pnpm typecheck` is red — so add the four members to `BoardEvent` in `lib/events.ts` now, as part of this step:

```ts
    | { type: 'label.created'; id: string; name: string }
    | { type: 'label.updated'; id: string; name: string }
    | { type: 'label.deleted'; id: string }
    | { type: 'card.labelled'; id: string; labelIds: string[] }
```

They are published from here and delivered from Section D; a published event nothing binds is exactly the failure `lib/events.test.ts` guards against, so **Section D's Task D1 must land before this feature is considered shipped**, and the Section A PR body says so.

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/actions/labels.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/labels.ts lib/actions/labels.test.ts
git commit -m "feat: create, rename and delete a board's labels"
```

### Task A4: Putting labels on a card

**Files:**
- Modify: `lib/actions/labels.ts`, `lib/actions/labels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function setCardLabels(input: unknown): Promise<
    | { ok: true }
    | { ok: false; error: 'UNAUTHENTICATED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' }
  >;
  ```
  Input `{ cardId, labelIds: string[], mutationId }`. The whole set, every time — there is no add or remove.

- [ ] **Step 1: Write the failing test**

Add to `lib/actions/labels.test.ts`. Extend the db double first — `setCardLabels` reads the card's board and the submitted labels:

```ts
let cardRow: { boardId: string } | undefined;
let submittedLabels: { id: string; boardId: string }[] = [];
```

add `cards: { findFirst: async () => cardRow }` to `query`, make `query.labels.findMany` return `submittedLabels` when it is asked for specific ids (keep the count behaviour for `createLabel` by returning `labelCount` entries when `submittedLabels` is empty), and reset both in `beforeEach`. Then:

```ts
describe('setCardLabels', () => {
  const input = { cardId: 'card-1', labelIds: ['l1', 'l2'], mutationId: MUTATION_ID };

  test('answers NOT_FOUND for a card that is not there', async () => {
    authMock.mockResolvedValue(signedIn);
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  // The whole reason this action re-reads the labels it was handed. Without
  // it, a member of board A staples board B's label onto a card by id.
  test('refuses a label belonging to another board', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [
      { id: 'l1', boardId: 'board-1' },
      { id: 'l2', boardId: 'board-2' },
    ];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'INVALID' });
    expect(ops).toEqual([]);
  });

  test('refuses an id that names no label at all', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [{ id: 'l1', boardId: 'board-1' }];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: false, error: 'INVALID' });
    expect(ops).toEqual([]);
  });

  test('replaces the whole set in one transaction, then announces it', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [
      { id: 'l1', boardId: 'board-1' },
      { id: 'l2', boardId: 'board-1' },
    ];
    await expect(setCardLabels(input)).resolves.toEqual({ ok: true });
    expect(ops).toEqual([
      { kind: 'delete', table: 'card_labels' },
      {
        kind: 'insert',
        table: 'card_labels',
        values: [
          { cardId: 'card-1', labelId: 'l1' },
          { cardId: 'card-1', labelId: 'l2' },
        ],
      },
      { kind: 'update', table: 'boards', values: { updatedAt: expect.any(Date) } },
    ]);
    expect(publish).toHaveBeenCalledWith('board-1', {
      type: 'card.labelled',
      id: 'card-1',
      labelIds: ['l1', 'l2'],
      mutationId: MUTATION_ID,
      actorId: 'user-1',
    });
  });

  // Clearing every label is a legal instruction, not an empty request.
  test('accepts an empty set and writes only the delete', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    submittedLabels = [];
    await expect(
      setCardLabels({ cardId: 'card-1', labelIds: [], mutationId: MUTATION_ID }),
    ).resolves.toEqual({ ok: true });
    expect(ops.filter((op) => op.table === 'card_labels')).toEqual([
      { kind: 'delete', table: 'card_labels' },
    ]);
    expect(publish).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({ type: 'card.labelled', labelIds: [] }),
    );
  });

  test('refuses more labels than a board can hold', async () => {
    authMock.mockResolvedValue(signedIn);
    cardRow = { boardId: 'board-1' };
    await expect(
      setCardLabels({
        cardId: 'card-1',
        labelIds: Array.from({ length: 51 }, (_, i) => `l${i}`),
        mutationId: MUTATION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/actions/labels.test.ts -t setCardLabels > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `setCardLabels is not a function`.

- [ ] **Step 3: Write it**

Add to `lib/actions/labels.ts` — note the extra imports (`inArray` from `drizzle-orm`, `cardLabels` from the schema, `boardIdForCard` and `touchBoard` from `./scope`):

```ts
const setSchema = z.object({
  cardId: id,
  // Deduplicated by the set, and capped at the board's own maximum: a longer
  // list can only be a client bug or an attempt to grow the payload.
  labelIds: z.array(id).max(LABELS_PER_BOARD),
  mutationId,
});

export async function setCardLabels(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { cardId } = parsed.data;
  const labelIds = [...new Set(parsed.data.labelIds)];

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Every submitted id is re-read and checked against this card's own board.
  // An id from another board would otherwise be written verbatim, which leaks
  // that board's vocabulary and poisons its counts.
  if (labelIds.length > 0) {
    const found = await db.query.labels.findMany({
      where: (label, { inArray: isIn }) => isIn(label.id, labelIds),
      columns: { id: true, boardId: true },
    });
    const mine = found.filter((label) => label.boardId === boardId);
    if (mine.length !== labelIds.length) return { ok: false, error: 'INVALID' } as const;
  }

  await db.transaction(async (tx) => {
    await tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
    if (labelIds.length > 0) {
      await tx.insert(cardLabels).values(labelIds.map((labelId) => ({ cardId, labelId })));
    }
    await touchBoard(tx, boardId);
  });

  await publish(boardId, {
    type: 'card.labelled',
    id: cardId,
    labelIds,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

Delete-then-insert rather than a diff: the set is small, it is one round trip either way inside the transaction, and a diff would have to reason about which rows are new — complexity with nothing to buy.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec vitest run lib/actions/labels.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
```

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
```

Expected: `EXIT=0` with 18 tests, `LINT=0`, `TYPECHECK=0`. If typecheck is red on a `publish` call, the union members from Task A3 Step 3 are missing.

- [ ] **Step 5: Commit and open the Section A pull request**

```bash
git add lib/actions/labels.ts lib/actions/labels.test.ts docs/plans/labels.md
git commit -m "feat: replace a card's labels in one action"
git push -u origin feat/labels-actions
```

PR base `main`. The body carries the gate output, the `\d labels` result from Task A1 verbatim, and states plainly that the four events are **published but not yet delivered** — no client binds them until Section D, and `lib/events.test.ts` is not extended to cover them until then either. Then stop and hand back.

---

# Section B — the card, end to end

The board carries labels and the card modal edits them. No filtering yet. Branch `feat/labels-card` from `main` once Section A has landed.

### Task B1: Labels reach the client

**Files:**
- Modify: `lib/boards.ts`, `lib/board-state.ts`, `lib/board-state.test.ts`

**Interfaces:**
- Produces: `StateCard` gains `labelIds: string[]`; `BoardState` gains `labels: BoardLabel[]`; `BoardCardRow` gains `cardLabels: { labelId: string }[]`; `BoardWithCards` gains `labels: BoardLabel[]`.
- Consumes: `BoardLabel` from `lib/labels.ts` — **`import type`, always**. `lib/board-state.ts` is imported by `'use client'` components and `lib/labels.ts` imports `lib/db`, so a value import here puts the pg pool in the browser bundle and only `pnpm build` says so.

- [ ] **Step 1: Write the failing test**

Add to `lib/board-state.test.ts`, beside the existing `toBoardState` tests:

```ts
test('a card carries its label ids, in the order the query returned them', () => {
  const state = toBoardState({
    id: 'board-1',
    name: 'Roadmap',
    labels: [{ id: 'l1', name: 'bug' }],
    columns: [
      {
        id: 'col-1',
        name: 'Ready to Work',
        rank: 'a0',
        cards: [
          {
            id: 'card-1',
            columnId: 'col-1',
            title: 'Fix the rank tie-break',
            rank: 'a0',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            dueDate: null,
            cardLabels: [{ labelId: 'l1' }],
          },
        ],
      },
    ],
  });

  expect(state.cards[0].labelIds).toEqual(['l1']);
  expect(state.labels).toEqual([{ id: 'l1', name: 'bug' }]);
});

test('a card with no labels carries an empty array, never undefined', () => {
  const state = toBoardState({
    id: 'board-1',
    name: 'Roadmap',
    labels: [],
    columns: [
      {
        id: 'col-1',
        name: 'Ready to Work',
        rank: 'a0',
        cards: [
          {
            id: 'card-1',
            columnId: 'col-1',
            title: 'Untagged',
            rank: 'a0',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            dueDate: null,
            cardLabels: [],
          },
        ],
      },
    ],
  });

  expect(state.cards[0].labelIds).toEqual([]);
});
```

The existing `toBoardState` tests in this file will stop compiling, because their fixtures lack `labels` and `cardLabels`. Adding those two keys to each is part of this step — the failures are where you notice, not a surprise.

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/board-state.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/unit.log
```

Expected: FAIL — `labelIds` is `undefined`.

- [ ] **Step 3: Carry them through**

In `lib/boards.ts`, extend the types and the query:

```ts
export type BoardCardRow = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: Date;
  dueDate: Date | null;
  cardLabels: { labelId: string }[];
};

export type BoardWithCards = {
  id: string;
  name: string;
  labels: BoardLabel[];
  columns: BoardColumnRow[];
};
```

and inside `getBoardWithColumns`, on the nested `cards`, add beside its `columns` and `orderBy`:

```ts
            with: { cardLabels: { columns: { labelId: true } } },
```

and on the board itself, beside `columns`:

```ts
      labels: {
        columns: { id: true, name: true },
        orderBy: (label, { asc, sql }) => [asc(sql`lower(${label.name})`)],
      },
```

One query, not two — the board is already being loaded, and the reconnect catch-up calls this same function, so it inherits labels for free.

In `lib/board-state.ts`:

```ts
export type StateCard = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: string;
  dueDate: string | null;
  labelIds: string[];
  pending?: boolean;
};

export type BoardState = { columns: StateColumn[]; cards: StateCard[]; labels: BoardLabel[] };
```

and in `toBoardState`, `labels: board.labels` on the state, and on each card:

```ts
        labelIds: card.cardLabels.map((assignment) => assignment.labelId),
```

Everywhere else that builds a `StateCard` — an optimistic `card.create` in `board-canvas.tsx`, and the `card.created` realtime handler — now needs `labelIds: []`. A new card carries no labels, and the field is an empty array rather than optional so nothing downstream has to ask whether it exists.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -5 /tmp/tc.log
```

Expected: both `=0`. Typecheck is what finds every remaining `StateCard` literal.

- [ ] **Step 5: Commit**

```bash
git add lib/boards.ts lib/board-state.ts lib/board-state.test.ts components/board
git commit -m "feat: carry each card's labels into board state"
```

### Task B2: The label line on the card face

**Files:**
- Modify: `components/board/board-card.tsx`
- Create: `components/board/board-card.test.tsx`

**Interfaces:**
- Consumes: `StateCard.labelIds`, `BoardState.labels`.
- Produces: `BoardCard` gains a `labels: BoardLabel[]` prop — the board's whole set, not this card's, so one lookup map serves every card.

- [ ] **Step 1: Write the failing test**

Create `components/board/board-card.test.tsx`, rendering to static markup the way `members-dialog.test.tsx` does:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }));

const { BoardCard } = await import('./board-card');

const card = {
  id: 'card-1',
  columnId: 'col-1',
  title: 'Fix the rank tie-break',
  rank: 'a0',
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds: ['l1', 'l2'],
};

const labels = [
  { id: 'l1', name: 'bug' },
  { id: 'l2', name: 'blocked' },
  { id: 'l3', name: 'chore' },
];

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <BoardCard
      card={card}
      boardId="board-1"
      canWrite
      columns={[]}
      labels={labels}
      onRename={() => {}}
      onDelete={() => {}}
      onMoveTo={() => {}}
      {...props}
    />,
  );

describe('the label line', () => {
  test('names this card labels, and no others', () => {
    const html = render();
    expect(html).toContain('bug');
    expect(html).toContain('blocked');
    expect(html).not.toContain('chore');
  });

  test('renders nothing at all for a card with no labels', () => {
    const html = render({ card: { ...card, labelIds: [] } });
    expect(html).toContain('Fix the rank tie-break');
    expect(html).not.toContain('data-testid="card-labels"');
  });

  // A label deleted by someone else can still be named by a card this client
  // has not caught up on. Dropping it beats rendering 'undefined'.
  test('ignores an id the board no longer has a label for', () => {
    const html = render({ card: { ...card, labelIds: ['l1', 'gone'] } });
    expect(html).toContain('bug');
    expect(html).not.toContain('gone');
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run components/board/board-card.test.tsx > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — the markup contains no label names.

- [ ] **Step 3: Add the line**

In `components/board/board-card.tsx`, a component beside `DueDate` — named `LabelLine`, not `CardLabels`, because `components/board/card-labels.tsx` in Task B3 is the modal's picker and two components of one name in one folder is a trap:

```tsx
function LabelLine({ ids, labels }: { ids: string[]; labels: BoardLabel[] }) {
  // An id with no label is one this client has not caught up on — dropped
  // rather than rendered, and never a reason to hide the rest of the line.
  const names = ids
    .map((id) => labels.find((label) => label.id === id)?.name)
    .filter((name): name is string => name !== undefined);

  if (names.length === 0) return null;

  return (
    <p data-testid="card-labels" className="mt-1.5 truncate font-mono text-xs text-muted">
      {names.join(' · ')}
    </p>
  );
}
```

and render it under the due date:

```tsx
      {card.dueDate ? <DueDate value={card.dueDate} /> : null}
      <LabelLine ids={card.labelIds} labels={labels} />
```

`truncate` rather than wrapping: a card's height must not change with its label count, or a column reflows under a drag in progress. No colour — the muted mono face is the whole treatment, per `docs/specs/labels.md`.

Then thread `labels` from `BoardCanvas` through `BoardColumn` to `BoardCard`, taking it from `state.labels`.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
```

Expected: all `=0`.

- [ ] **Step 5: Commit**

```bash
git add components/board
git commit -m "feat: print a card's labels under its due date"
```

### Task B3: The picker in the card modal

**Files:**
- Create: `components/board/card-labels.tsx`
- Modify: `lib/cards.ts`, `components/board/card-body.tsx`, `e2e/labels.spec.ts` (create)

**Interfaces:**
- Consumes: `setCardLabels` from `lib/actions/labels.ts`; `claim` from `useRealtime`.
- Produces:
  ```tsx
  export function CardLabels(props: {
    cardId: string;
    labels: BoardLabel[];
    selected: string[];
    canWrite: boolean;
    onChange: (labelIds: string[]) => void;
  }): React.ReactElement;
  ```
  `CardForView` gains `labelIds: string[]`, and `getCardForView` gains `with: { cardLabels: { columns: { labelId: true } } }`.

- [ ] **Step 1: Write the failing test**

Create `e2e/labels.spec.ts`. This is the first flow test for the feature, so it also establishes the file:

```ts
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

async function seedLabel(boardId: string, name: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ id: string }>(
      'insert into labels (id, board_id, name) values (gen_random_uuid()::text, $1, $2) returning id',
      [boardId, name],
    );
    return rows[0].id;
  } finally {
    await pool.end();
  }
}

test('a member puts a label on a card and the card face shows it', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Tagged');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });
  await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    const applied = written(page);
    await page.getByRole('checkbox', { name: 'bug' }).check();
    await applied;

    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-labels')).toHaveText('bug');
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees the labels and is offered no way to change them', async ({
  page,
  context,
  browser,
}) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();

  const boardId = await seedBoard(owner.userId, 'Read only');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });
  const labelId = await seedLabel(boardId, 'bug');

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('insert into card_labels (card_id, label_id) values ($1, $2)', [
    cardId,
    labelId,
  ]);
  await pool.end();

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByText('bug')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'bug' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: FAIL — no checkbox named `bug`.

- [ ] **Step 3: Write the picker**

Create `components/board/card-labels.tsx`:

```tsx
'use client';

import type { BoardLabel } from '@/lib/labels';

export function CardLabels({
  labels,
  selected,
  canWrite,
  onChange,
}: {
  labels: BoardLabel[];
  selected: string[];
  canWrite: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  if (labels.length === 0) {
    return <p className="text-sm text-muted">This board has no labels yet.</p>;
  }

  if (!canWrite) {
    const names = labels.filter((label) => selected.includes(label.id)).map((label) => label.name);
    return (
      <p className="font-mono text-xs text-muted">{names.length > 0 ? names.join(' · ') : 'None'}</p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {labels.map((label) => (
        <li key={label.id}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(label.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, label.id]
                    : selected.filter((id) => id !== label.id),
                )
              }
            />
            {label.name}
          </label>
        </li>
      ))}
    </ul>
  );
}
```

In `lib/cards.ts`, add `labelIds: string[]` to `CardForView`, pull `with: { cardLabels: { columns: { labelId: true } } }` in `getCardForView`, and map it the way `toBoardState` does. The card page and the intercepted modal both need the board's label set too — read it with `boardLabels(card.boardId)` where the card is read, and pass it down.

In `components/board/card-body.tsx`, hold the selection and call the action optimistically, matching how the due date already behaves:

```tsx
  const [labelIds, setLabelIds] = useState(card.labelIds);

  function changeLabels(next: string[]) {
    const previous = labelIds;
    setLabelIds(next);
    startTransition(async () => {
      const result = await attempt(() =>
        setCardLabels({ cardId: card.id, labelIds: next, mutationId: claim() }),
      );
      if (!result.ok) {
        setLabelIds(previous);
        setError('Those labels could not be saved. Try again.');
      }
    });
  }
```

Render it under the due-date control, with a `Labels` heading in the same style as the section headings already there. `attempt` is not optional — `CLAUDE.md` records that an unwrapped server action rejection replaced the whole board with an error boundary.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `=0`. `pnpm build` matters here specifically: `card-labels.tsx` imports a type from `lib/labels.ts`, which imports `lib/db` — `import type` is erased and safe, a value import would put the pg pool in the browser bundle and only the build would notice.

- [ ] **Step 5: Commit and open the Section B pull request**

```bash
git add components/board lib/cards.ts e2e/labels.spec.ts docs/plans/labels.md
git commit -m "feat: choose a card's labels in the modal"
git push -u origin feat/labels-card
```

PR base `main`. The body carries the gate output including the build, a screenshot of a labelled card on the board and of the picker in the modal, and the note that filtering arrives in Section C. Then stop and hand back.

---

# Section C — filtering

The board narrows. Branch `feat/labels-filter` from `main` once Section B has landed.

### Task C1: The predicate

**Files:**
- Modify: `lib/board-state.ts`, `lib/board-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function matchesFilter(card: StateCard, labelIds: string[]): boolean;
  export function parseLabelFilter(params: URLSearchParams, labels: BoardLabel[]): string[];
  ```

- [ ] **Step 1: Write the failing test**

Add to `lib/board-state.test.ts`:

```ts
const card = (labelIds: string[]): StateCard => ({
  id: 'card-1',
  columnId: 'col-1',
  title: 'Card',
  rank: 'a0',
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds,
});

describe('matchesFilter', () => {
  test('an empty filter matches everything, including an unlabelled card', () => {
    expect(matchesFilter(card([]), [])).toBe(true);
    expect(matchesFilter(card(['l1']), [])).toBe(true);
  });

  // AND, not OR: the job is narrowing a board too full to read.
  test('every selected label must be on the card', () => {
    expect(matchesFilter(card(['l1', 'l2']), ['l1', 'l2'])).toBe(true);
    expect(matchesFilter(card(['l1']), ['l1', 'l2'])).toBe(false);
  });

  test('a card may carry labels the filter did not ask for', () => {
    expect(matchesFilter(card(['l1', 'l2', 'l3']), ['l1'])).toBe(true);
  });

  test('an unlabelled card never survives a populated filter', () => {
    expect(matchesFilter(card([]), ['l1'])).toBe(false);
  });
});

describe('parseLabelFilter', () => {
  const labels = [
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'blocked' },
  ];

  test('reads every repeated label parameter', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=l2'), labels)).toEqual([
      'l1',
      'l2',
    ]);
  });

  // A deleted label, or one from another board, leaves a URL naming an id
  // this board does not have. Ignored, so the board renders unfiltered
  // rather than empty.
  test('drops an id the board has no label for', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=gone'), labels)).toEqual(['l1']);
  });

  test('deduplicates, so a repeated id cannot narrow twice', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=l1'), labels)).toEqual(['l1']);
  });

  test('no parameter at all is an empty filter', () => {
    expect(parseLabelFilter(new URLSearchParams(''), labels)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/board-state.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: FAIL — `matchesFilter is not a function`.

- [ ] **Step 3: Write them**

In `lib/board-state.ts`:

```ts
export function matchesFilter(card: StateCard, labelIds: string[]): boolean {
  return labelIds.every((id) => card.labelIds.includes(id));
}

// The filter lives in the URL, so it survives a reload and a reconnect's
// board.reseed — which replaces the whole reducer and would drop anything
// held there.
export function parseLabelFilter(params: URLSearchParams, labels: BoardLabel[]): string[] {
  const known = new Set(labels.map((label) => label.id));
  return [...new Set(params.getAll('label'))].filter((id) => known.has(id));
}
```

`every` over an empty array is `true`, which is exactly the empty-filter case and is why it needs no special branch.

- [ ] **Step 4: Run it to watch it pass**

```bash
pnpm exec vitest run lib/board-state.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/board-state.ts lib/board-state.test.ts
git commit -m "feat: match a card against an ANDed label filter"
```

### Task C2: The filter popover

**Files:**
- Create: `components/board/label-filter.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`

**Interfaces:**
- Consumes: `parseLabelFilter`; `createLabel`, `renameLabel`, `deleteLabel` from `lib/actions/labels.ts`; `useRealtime`'s `claim`.
- Produces:
  ```tsx
  export function LabelFilter(props: {
    labels: BoardLabel[];
    counts: Record<string, number>;
    boardId: string;
    canWrite: boolean;
  }): React.ReactElement;
  ```

- [ ] **Step 1: Write the failing test**

Add to `e2e/labels.spec.ts`:

```ts
test('the filter narrows the board and survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Filtered');
  const [first] = await boardColumns(boardId);
  const kept = await seedCard(first.id, { boardId, createdById: userId, title: 'Has bug' });
  await seedCard(first.id, { boardId, createdById: userId, title: 'Has nothing' });
  const labelId = await seedLabel(boardId, 'bug');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('insert into card_labels (card_id, label_id) values ($1, $2)', [kept, labelId]);
  await pool.end();

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Has nothing')).toBeVisible();

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('checkbox', { name: /bug/ }).check();

    await expect(page.getByText('Has bug')).toBeVisible();
    await expect(page.getByText('Has nothing')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`label=${labelId}`));

    await page.reload();
    await expect(page.getByText('Has bug')).toBeVisible();
    await expect(page.getByText('Has nothing')).toBeHidden();
  } finally {
    await removeSeededUser(userId);
  }
});
```

Check `seedCard`'s signature in `e2e/support/session.ts` before writing this: if it does not accept a `title`, add it there rather than working around it in the test.

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: FAIL — no button named `Filter`.

- [ ] **Step 3: Build the popover**

Create `components/board/label-filter.tsx`. It is a `'use client'` component; the trigger is a real `<button>` carrying `aria-expanded`, the list is real checkboxes, and toggling one rewrites the URL rather than any local state:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { BoardLabel } from '@/lib/labels';

export function LabelFilter({
  labels,
  counts,
  boardId,
  canWrite,
}: {
  labels: BoardLabel[];
  counts: Record<string, number>;
  boardId: string;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const active = new Set(params.getAll('label'));

  function toggle(labelId: string) {
    const next = new URLSearchParams(params);
    const selected = new Set(next.getAll('label'));
    next.delete('label');
    if (selected.has(labelId)) selected.delete(labelId);
    else selected.add(labelId);
    for (const id of selected) next.append('label', id);
    // replace, not push: a filter is a view of this board, not a place in
    // history to walk back through one label at a time.
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium"
      >
        Filter{active.size > 0 ? ` · ${active.size}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-lg">
          {labels.length === 0 ? (
            <p className="text-sm text-muted">No labels yet.</p>
          ) : (
            <ul className="space-y-2">
              {labels.map((label) => (
                <li key={label.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={active.has(label.id)}
                      onChange={() => toggle(label.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    <span className="font-mono text-xs text-muted">{counts[label.id] ?? 0}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

The count shown beside each label is computed by the caller from board state — the client already holds every card's `labelIds`, and a count query would be a second source of truth that can disagree with the board on screen.

Mount it in the board layout's `actions`, before `MembersButton`:

```tsx
<LabelFilter
  labels={board.labels}
  boardId={boardId}
  canWrite={atLeast(role, 'member')}
/>
```

`board.labels` comes free — the layout already calls `getBoardWithColumns`, which carries them since Task B1, and `role` is already resolved there for `NewCardButton`.

**Counts come the way `addCard` does.** A page cannot pass data up into its layout, and board state lives in the page's tree while the top bar lives in the layout; `components/board/board-actions.tsx` exists for exactly this and is the route `NewCardButton` takes. Extend that context rather than inventing a second one:

```ts
const BoardActionsContext = createContext<{
  addCard: Handler | null;
  register: (handler: Handler | null) => void;
  patchCard: PatchCard | null;
  registerPatchCard: (handler: PatchCard | null) => void;
  labelCounts: Record<string, number>;
  registerLabelCounts: (counts: Record<string, number>) => void;
} | null>(null);
```

`BoardCanvas` registers the counts it computes from `state.cards`; `LabelFilter` reads `labelCounts` from `useBoardActions()` and falls back to `0` for an unregistered label, so the popover renders correctly on the first paint before the canvas has registered anything. Note `registerLabelCounts` stores a plain object, so unlike `register` it does **not** need the updater-function wrapper that file's comment explains.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
```

Expected: all `=0`.

- [ ] **Step 5: Commit**

```bash
git add components/board "app/(app)/(board)/boards/[boardId]/layout.tsx"
git commit -m "feat: narrow the board to the labels in the URL"
```

### Task C3: What a filter does to a drag, and to an empty column

**Files:**
- Modify: `components/board/board-canvas.tsx`, `components/board/board-column.tsx`, `e2e/labels.spec.ts`

**Interfaces:**
- Consumes: `matchesFilter`, `parseLabelFilter`.

- [ ] **Step 1: Write the failing test**

Add to `e2e/labels.spec.ts`:

```ts
test('a filtered board does not let a card be dragged', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'No dragging');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId, title: 'Has bug' });
  const labelId = await seedLabel(boardId, 'bug');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('insert into card_labels (card_id, label_id) values ($1, $2)', [
    cardId,
    labelId,
  ]);
  await pool.end();

  try {
    await page.goto(`/boards/${boardId}`);
    const card = page.locator(`[data-card-id="${cardId}"]`);
    await expect(card).toHaveAttribute('tabindex', '0');

    await page.goto(`/boards/${boardId}?label=${labelId}`);
    // dnd-kit drops the draggable attributes when disabled, which is what
    // makes the card unreachable by pointer and by keyboard alike.
    await expect(page.locator(`[data-card-id="${cardId}"]`)).not.toHaveAttribute('tabindex', '0');
  } finally {
    await removeSeededUser(userId);
  }
});

test('a column emptied by a filter says so in its own words', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Nothing matches');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId, title: 'Unlabelled' });
  const labelId = await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Nothing here yet')).toHaveCount(4);

    await page.goto(`/boards/${boardId}?label=${labelId}`);
    await expect(page.getByText('Nothing here matches').first()).toBeVisible();
    await expect(page.getByText('Nothing here yet')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});
```

The count of 4 is the four empty columns of a five-column board whose first column holds one card. Check `e2e/board-view.spec.ts` for how the seeded columns are asserted elsewhere and match it.

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: FAIL — the card is still draggable, and the column still reads "Nothing here yet".

- [ ] **Step 3: Guard the drag, and fix the copy**

In `components/board/board-canvas.tsx`, derive the filter and pass it down:

```tsx
  const params = useSearchParams();
  const filter = parseLabelFilter(params, state.labels);
  const filtering = filter.length > 0;
```

Filter the cards where a column's cards are read, and hand `filtering` to `BoardColumn` and on to `BoardCard`, where it joins the existing `disabled` condition:

```tsx
    disabled: !canWrite || card.pending === true || filtering,
```

**This is the whole reason the guard exists.** `moveCard` takes `beforeCardId` and `afterCardId`; neighbours read from a filtered list put the card's new rank between two cards the user cannot see, and the drop looks correct until the filter clears. Reading them from the unfiltered list instead makes the drop position on screen a lie. Neither is acceptable, so a filtered board does not drag — the `⋯` menu's "Move to column" still works, so nothing becomes unreachable.

In `components/board/board-column.tsx`, the empty state takes the filter into account:

```tsx
        {cards.length === 0 ? (
          <p className="...">{filtering ? 'Nothing here matches' : 'Nothing here yet'}</p>
        ) : null}
```

"Nothing here yet" under a filter is simply false, and `CLAUDE.md`'s copy rule is that an empty state is an invitation rather than an apology — "Nothing here matches" says what happened without either.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/e2e.log
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
```

Expected: all `=0`, and the e2e count run equal to the count collected — compare `pnpm exec playwright test --list` if anything looks short.

- [ ] **Step 5: Commit**

```bash
git add components/board e2e/labels.spec.ts
git commit -m "fix: never drag a card whose neighbours are hidden"
```

### Task C4: Managing the set from the popover

**Files:**
- Modify: `components/board/label-filter.tsx`, `e2e/labels.spec.ts`

**Interfaces:**
- Consumes: `createLabel`, `renameLabel`, `deleteLabel`; `attempt` from `lib/attempt.ts`; `claim` from `useRealtime`.

- [ ] **Step 1: Write the failing test**

Add to `e2e/labels.spec.ts`:

```ts
test('a member creates a label from the filter, and deletes it again', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Vocabulary');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('New label').fill('chore');
    const created = written(page);
    await page.getByRole('button', { name: 'Add label' }).click();
    await created;
    await expect(page.getByRole('checkbox', { name: /chore/ })).toBeVisible();

    const removed = written(page);
    await page.getByRole('button', { name: 'Delete chore' }).click();
    await removed;
    await expect(page.getByRole('checkbox', { name: /chore/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer is offered no way to change the set', async ({ page, context, browser }) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();
  const boardId = await seedBoard(owner.userId, 'Read only vocabulary');
  await seedLabel(boardId, 'bug');

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('checkbox', { name: /bug/ })).toBeVisible();
    await expect(page.getByLabel('New label')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete bug' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec playwright test e2e/labels.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
```

Expected: FAIL — no field labelled `New label`.

- [ ] **Step 3: Add management to the popover's foot**

Below the list in `label-filter.tsx`, behind `canWrite`, a create row and a delete control per label:

```tsx
      {canWrite && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await attempt(() =>
                createLabel({ boardId, name, mutationId: claim() }),
              );
              if (!result.ok) {
                setError(
                  result.error === 'DUPLICATE'
                    ? 'This board already has that label.'
                    : result.error === 'LIMIT_REACHED'
                      ? 'This board is at fifty labels. Delete one first.'
                      : 'That label could not be added. Try again.',
                );
                return;
              }
              setName('');
              router.refresh();
            });
          }}
          className="mt-3 flex gap-2 border-t border-line pt-3"
        >
          <input
            aria-label="New label"
            value={name}
            maxLength={LABEL_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1 text-sm"
          />
          <button type="submit" disabled={pending} className="shrink-0 text-sm font-medium">
            Add label
          </button>
        </form>
      )}
```

and, inside each list item behind the same flag, a delete button labelled `Delete {label.name}` styled `text-time-over` — warm is legal here because this is a destructive control inside an open popover the user is looking at, which is exactly the transient case `CLAUDE.md` carves out. Nothing warm comes to rest on the board.

Errors render in the popover, under the form, in `text-time-over`. A failed action must not close the popover — the same lesson `fix: keep a failed members action inside the dialog` records.

`LABEL_NAME_MAX` is imported as a value from `lib/labels.ts`, which imports `lib/db` — so **import the constant into a server component and pass it as a prop, or move the two constants to a module that imports nothing.** Moving them is cleaner: put `LABEL_NAME_MAX` and `LABELS_PER_BOARD` in `lib/labels-limits.ts`, re-export them from `lib/labels.ts` so Section A's imports keep working, and have the client import the limits module. Only `pnpm build` catches this class of mistake.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/e2e.log
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `=0`. The build is the one that proves the pg pool stayed out of the browser bundle.

- [ ] **Step 5: Commit and open the Section C pull request**

```bash
git add components/board e2e/labels.spec.ts lib/labels-limits.ts lib/labels.ts docs/plans/labels.md
git commit -m "feat: manage a board's labels from the filter"
git push -u origin feat/labels-filter
```

PR base `main`. The body carries the gate output, screenshots of the popover open and of a narrowed board, and the note that a filtered board does not drag — with the reason, because a reviewer will otherwise read it as a regression. Then stop and hand back.

---

# Section D — realtime

The four events published since Section A finally get delivered. Branch `feat/labels-realtime` from `main` once Section C has landed.

### Task D1: Binding what Section A already publishes

**Files:**
- Modify: `components/board/realtime.tsx`, `lib/events.test.ts`, `lib/board-state.ts`, `lib/board-state.test.ts`, `components/board/board-canvas.tsx`

**Interfaces:**
- Produces: four new `BoardAction` members —
  ```ts
  | { type: 'label.create'; label: BoardLabel }
  | { type: 'label.rename'; labelId: string; name: string }
  | { type: 'label.delete'; labelId: string }
  | { type: 'card.labels'; cardId: string; labelIds: string[] }
  ```

- [ ] **Step 1: Write the failing test**

Extend the existing every-event-is-bound assertion in `lib/events.test.ts` — it reads `realtime.tsx` and is the guard `CLAUDE.md` describes:

```ts
    'member.added', 'member.updated', 'member.removed',
    'label.created', 'label.updated', 'label.deleted', 'card.labelled',
```

and add the reducer's side to `lib/board-state.test.ts`:

```ts
test('a deleted label leaves every card that carried it', () => {
  const before: BoardState = {
    columns: [],
    labels: [{ id: 'l1', name: 'bug' }],
    cards: [card(['l1', 'l2'])],
  };
  const after = boardReducer(before, { type: 'label.delete', labelId: 'l1' });

  expect(after.labels).toEqual([]);
  expect(after.cards[0].labelIds).toEqual(['l2']);
});

test('a renamed label repaints every card without touching one', () => {
  const before: BoardState = {
    columns: [],
    labels: [{ id: 'l1', name: 'bug' }],
    cards: [card(['l1'])],
  };
  const after = boardReducer(before, { type: 'label.rename', labelId: 'l1', name: 'defect' });

  expect(after.labels).toEqual([{ id: 'l1', name: 'defect' }]);
  expect(after.cards[0]).toBe(before.cards[0]);
});

test('card.labels replaces the whole set', () => {
  const before: BoardState = { columns: [], labels: [], cards: [card(['l1'])] };
  const after = boardReducer(before, {
    type: 'card.labels',
    cardId: 'card-1',
    labelIds: ['l2', 'l3'],
  });

  expect(after.cards[0].labelIds).toEqual(['l2', 'l3']);
});
```

`toBe` in the rename test is deliberate: the card object must be the same reference, which is what proves a rename repaints from `state.labels` rather than rewriting every card.

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm exec vitest run lib/events.test.ts lib/board-state.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/unit.log
```

Expected: FAIL — `label.created is published but never delivered`.

- [ ] **Step 3: Bind them and apply them**

Add the four names to `EVENT_NAMES` in `components/board/realtime.tsx`.

Add the four actions to `BoardAction` and to `boardReducer` in `lib/board-state.ts`:

```ts
    case 'label.create':
      return { ...state, labels: [...state.labels, action.label] };

    case 'label.rename':
      return {
        ...state,
        labels: state.labels.map((label) =>
          label.id === action.labelId ? { ...label, name: action.name } : label,
        ),
      };

    // The row is gone, so every assignment to it is gone too — the same
    // cascade the database performs, applied to the copy on screen.
    case 'label.delete':
      return {
        ...state,
        labels: state.labels.filter((label) => label.id !== action.labelId),
        cards: state.cards.map((card) =>
          card.labelIds.includes(action.labelId)
            ? { ...card, labelIds: card.labelIds.filter((id) => id !== action.labelId) }
            : card,
        ),
      };

    case 'card.labels':
      return mapCard(state, action.cardId, (card) => ({ ...card, labelIds: action.labelIds }));
```

Then map the four events to those actions in the canvas's realtime handler, beside the card and column cases already there.

- [ ] **Step 4: Run the gate**

```bash
pnpm exec vitest run > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/unit.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TYPECHECK=$?"; tail -3 /tmp/tc.log
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -5 /tmp/build.log
```

Expected: all `=0`.

- [ ] **Step 5: Commit**

```bash
git add components/board lib/board-state.ts lib/board-state.test.ts lib/events.test.ts
git commit -m "feat: apply a label change while the board is open"
```

### Task D2: Two live clients, and the Section D pull request

**Files:**
- Modify: `e2e/labels.spec.ts`, `CLAUDE.md`, `docs/plans/labels.md`

- [ ] **Step 1: Write the failing test**

Add to `e2e/labels.spec.ts`, behind the same credentials guard `e2e/realtime.spec.ts` uses — copy that guard rather than inventing a second convention, and scope it to a `test.describe` so the rest of this file still runs without Pusher:

```ts
const configured = Boolean(
  process.env.PUSHER_APP_ID &&
    process.env.PUSHER_SECRET &&
    process.env.NEXT_PUBLIC_PUSHER_KEY &&
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
);

test.describe('a label that changes while the board is open', () => {
  test.skip(!configured, 'Pusher credentials are not configured');

  test('a label applied by someone else appears on the card face', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const owner = await seedSession(ownerContext);
    const member = await seedSession(memberContext);
    const boardId = await seedBoard(owner.userId, 'Live labels');
    await seedMember(boardId, member.userId, 'member');
    const [first] = await boardColumns(boardId);
    const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });
    await seedLabel(boardId, 'bug');

    try {
      const watcher = await memberContext.newPage();
      await watcher.goto(`/boards/${boardId}`);
      await expect(watcher.getByTestId('card-labels')).toHaveCount(0);

      const actor = await ownerContext.newPage();
      await actor.goto(`/boards/${boardId}/cards/${cardId}`);
      await actor.getByRole('checkbox', { name: 'bug' }).check();

      await expect(watcher.getByTestId('card-labels')).toHaveText('bug');
    } finally {
      await removeSeededUser(member.userId);
      await removeSeededUser(owner.userId);
      await ownerContext.close();
      await memberContext.close();
    }
  });
});
```

- [ ] **Step 2: Run the whole suite**

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/e2e.log
pnpm exec playwright test --list > /tmp/list.log 2>&1; tail -2 /tmp/list.log
```

Expected: `EXIT=0`, and the count run equal to the count collected. Say in the PR whether the live test ran or skipped — a skipped realtime test is indistinguishable from a passing one in the summary line.

- [ ] **Step 3: Update the documentation this sub-project invalidates**

- `CLAUDE.md`, "Data model": `labels` and `card_labels`, both cascades, and the two caps with the payload reason for `LABELS_PER_BOARD`.
- `CLAUDE.md`, "Realtime": "all fifteen" becomes nineteen, with the four names added to the list.
- `CLAUDE.md`, "Layout": `lib/labels.ts` and `lib/actions/labels.ts`.
- `CLAUDE.md`, "Design": one line recording that labels are deliberately colourless, pointing at `docs/specs/labels.md`, so the three-role rule is not quietly broken by a later session.
- `CLAUDE.md`, "Open decisions": labels/tags resolved; attachments remains, still carrying its blob-store conflict.

- [ ] **Step 4: Verify by hand, then screenshot**

Two accounts, two browsers: apply a label in one and watch it appear on the other's card face without a reload; delete a label in one and watch it leave the other's cards. Screenshot the popover open, a narrowed board, and a labelled card into `docs/screenshots/labels-section-d/`. Close everything you opened.

- [ ] **Step 5: Commit and open the Section D pull request**

```bash
git add e2e/labels.spec.ts CLAUDE.md docs/plans/labels.md docs/screenshots/labels-section-d
git commit -m "docs: record nineteen events and the labels that exist"
git push -u origin feat/labels-realtime
```

PR base `main`. The body states whether the live test ran or skipped, and carries the hand-verification from Step 4. Then run `/superpowers:review` over the whole sub-project before considering it finished.
