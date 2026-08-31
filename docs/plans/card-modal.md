# Card Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card opens — as a modal over the board, or as a page from a link — carrying an editable title, description and due date, and a comment thread.

**Architecture:** An intercepting parallel route (`@card/(.)cards/[cardId]`) renders a modal over a still-mounted board; the canonical `cards/[cardId]` page under the same board segment serves cold loads. Both are thin server pages that read through one cached `lib/cards.ts` and render one client `CardBody`. Field edits reach the board's existing reducer through `BoardActionsProvider`, which the board layout already wraps both surfaces in.

**Tech Stack:** Next 16 App Router (parallel + intercepting routes), React 19, Drizzle ORM on Neon Postgres, Zod, Radix dialog via shadcn, Vitest, Playwright.

**Spec:** `docs/specs/card-modal.md` — read it alongside this plan; every task argues from it.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **TDD is red-green-refactor.** Write the test, run it, watch it fail for the stated reason, then write the minimal code. Never backfill a test.
- **Read the real exit code.** A pipeline exits with its *last* command's status, so `playwright test | tail` reports `tail`. Redirect to a file and `echo $?`:
  `pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/e2e.log`
  Compare the number that ran against the number collected.
- **Before any push:** `pnpm typecheck && pnpm lint && pnpm test`, output observed.
- **Every server action re-checks permission** through `lib/permissions.ts`. Never inline a membership query. Never trust a `boardId` from the client for authorisation — resolve it from the row.
- **Actions return a discriminated result**, never throw for expected failures: `{ ok: true, data }` / `{ ok: false, error: 'UNAUTHENTICATED' | 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' }`.
- **`lib/permissions.ts` is server-only**, and so is anything importing it. A `'use client'` file importing any *value* from it pulls `pg` into the browser bundle and the build dies on `dns`/`fs`/`net`/`tls`. `typecheck`, `lint` and `test` all pass on that code — only `pnpm build` catches it. Client components take derived booleans (`canWrite`, `canComment`) computed on the server. `import type` is erased and stays safe.
- **`publish()` is not called anywhere.** Realtime is sub-project 6. Every action here is a future call site and none of them make one.
- **No `any`**, no non-null assertions to silence the compiler, no `@ts-expect-error` without an explanation on the line above.
- **No unnecessary comments.** Comment the non-obvious decision, never what the code plainly says.
- **Copy:** active voice, sentence case, no filler. Errors say what happened and what to do, and never apologise. Empty states are invitations.
- **Zod caps:** description ≤ 10,000 characters; comment body ≤ 4,000, trimmed, non-empty. They exist so sub-project 6's payloads fit under Pusher's 10KB limit.
- **Due dates are calendar dates in a `timestamptz`:** store midnight UTC, format from UTC parts, compare against the viewer's local today.
- **One section, one branch, one PR.** Open it, then stop and start the next section in a fresh session.
- **Model:** implementation and per-task review on Sonnet; the final whole-branch review before each PR on Opus. Pass the model explicitly when dispatching.

## File structure

```
app/(app)/(board)/boards/[boardId]/
  layout.tsx                          MODIFY  accepts and renders the `card` slot
  @card/
    default.tsx                       CREATE  returns null; without it a hard load 404s
    (.)cards/[cardId]/page.tsx        CREATE  intercepted: CardBody inside a Dialog
  cards/[cardId]/page.tsx             CREATE  canonical: CardBody, full page

components/board/
  card-body.tsx                       CREATE  the one client surface both pages render
  card-modal.tsx                      CREATE  Dialog wrapper; closes by router.back()
  card-comments.tsx                   CREATE  list, composer, author-only controls
  card-due-date.tsx                   CREATE  the native date control
  board-actions.tsx                   MODIFY  gains patchCard beside addCard
  board-canvas.tsx                    MODIFY  registers patchCard; seeds dueDate
  board-card.tsx                      MODIFY  renders the due date on the card face

lib/
  cards.ts                            CREATE  getCardForView, cached per request
  due.ts                              CREATE  pure calendar-date rules; no I/O
  due.test.ts                         CREATE
  board-state.ts                      MODIFY  StateCard.dueDate, card.setDueDate, inverse
  actions/
    cards.ts                          MODIFY  setCardDescription, setCardDueDate
    comments.ts                       CREATE  addComment, editComment, deleteComment
    comments.test.ts                  CREATE
    scope.ts                          MODIFY  commentScope
  db/schema.ts                        MODIFY  comments table + relations

e2e/
  support/session.ts                  MODIFY  seedComment
  schema.spec.ts                      MODIFY  comment referential actions
  card-modal.spec.ts                  CREATE  intercept vs cold load, field editing
  card-comments.spec.ts               CREATE  comments, permissions, rollback

CLAUDE.md                             MODIFY  Layout section corrected in Section 3
```

---

## Section 1 — The routing spike

Branch: `spike/card-route-intercept`

One task. Its output is an **answer**, not code that survives. The spec puts it first because a broken intercept produces a full-page navigation and no error — there is nothing to notice unless you look for it deliberately.

### Task 1: Prove the intercept, the cold load, and the default

**Files:**
- Create (throwaway): `app/(app)/(board)/boards/[boardId]/@card/default.tsx`
- Create (throwaway): `app/(app)/(board)/boards/[boardId]/@card/(.)cards/[cardId]/page.tsx`
- Create (throwaway): `app/(app)/(board)/boards/[boardId]/cards/[cardId]/page.tsx`
- Modify (throwaway): `app/(app)/(board)/boards/[boardId]/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a written answer to three questions, recorded in the PR body and in this plan's Section 1 gate. No code survives the section.

- [ ] **Step 1: Add the slot to the layout**

In `app/(app)/(board)/boards/[boardId]/layout.tsx`, add `card` to the props and render it after the content div:

```tsx
export default async function BoardTitleLayout({
  children,
  card,
  params,
}: {
  children: React.ReactNode;
  card: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
```

and inside the returned tree, immediately after `<div className="min-h-0 flex-1">{children}</div>`:

```tsx
        {card}
```

- [ ] **Step 2: Write the three throwaway routes**

`app/(app)/(board)/boards/[boardId]/@card/default.tsx`:

```tsx
export default function Default() {
  return null;
}
```

`app/(app)/(board)/boards/[boardId]/@card/(.)cards/[cardId]/page.tsx`:

```tsx
export default async function InterceptedProbe({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  return (
    <div data-probe="intercepted" className="fixed inset-x-0 bottom-0 bg-surface p-4 text-ink">
      INTERCEPTED {cardId}
    </div>
  );
}
```

`app/(app)/(board)/boards/[boardId]/cards/[cardId]/page.tsx`:

```tsx
export default async function CanonicalProbe({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  return <div data-probe="canonical">CANONICAL {cardId}</div>;
}
```

- [ ] **Step 3: Run the three probes in a real browser**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
```

Seed a session and a board the way `e2e/support/session.ts` does, then check, **reading the DOM rather than trusting the screenshot**:

1. **Soft navigation.** From `/boards/<id>`, navigate to `/boards/<id>/cards/<cardId>` with a client-side link or `router.push`. Expect `[data-probe="intercepted"]` present, `[data-probe="canonical"]` absent, and the board canvas **still mounted** (`[data-column-id]` still in the DOM).
2. **Hard load.** Open `/boards/<id>/cards/<cardId>` in a fresh tab. Expect `[data-probe="canonical"]` present and `[data-probe="intercepted"]` absent.
3. **The default.** Delete `@card/default.tsx`, hard-load the plain `/boards/<id>`, and record what happens. The docs say an unmatched slot with no default renders a 404 — confirm that is what Next 16 actually does here. Restore the file.

Record the observed answer to each, verbatim, including anything surprising.

- [ ] **Step 4: Stop the server and delete every probe**

```bash
kill %1
rm -rf "app/(app)/(board)/boards/[boardId]/@card" "app/(app)/(board)/boards/[boardId]/cards"
git checkout -- "app/(app)/(board)/boards/[boardId]/layout.tsx"
git status --short   # expect: clean
```

- [ ] **Step 5: Verify and commit the findings only**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "EXIT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"
```

Write the answers into this plan's Section 1 gate, then:

```bash
git add docs/plans/card-modal.md
git commit -m "docs: record what the card route spike observed"
```

### Section 1 gate

- [ ] Soft navigation renders the intercepted probe and leaves the canvas mounted. Observed: _record here_
- [ ] A hard load renders the canonical probe and no modal. Observed: _record here_
- [ ] `@card/default.tsx` removed: what a hard load of the plain board does. Observed: _record here_
- [ ] `git status --short` is clean of probe files; `app/(app)/(board)/boards/[boardId]/` holds only `layout.tsx` and `page.tsx`.
- [ ] Open the PR with the findings as the body. Say plainly that no behaviour changed. Stop. Start Section 2 in a fresh session.

---

## Section 2 — The `comments` table

Branch: `feat/card-modal-schema`

Nothing user-visible. Landing the migration alone lets production be hand-migrated before the UI that needs it, exactly as sub-project 4's Section A did.

### Task 2: The table, its relations, and the fourth migration

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/schema.test.ts`
- Create: `lib/db/migrations/0003_*.sql` (generated, never hand-edited)

**Interfaces:**
- Consumes: `cards`, `users` from `lib/db/schema.ts`.
- Produces: `comments` table with columns `id`, `cardId`, `authorId` (nullable), `body`, `createdAt`, `updatedAt`; `commentsRelations` with `card` and `author`; `cardsRelations` gains `comments: many(comments)`.

- [ ] **Step 1: Write the failing test**

Append to `lib/db/schema.test.ts`:

```ts
describe('comments', () => {
  test('belongs to a card and cascades with it', () => {
    const config = getTableConfig(comments);
    const cardFk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'card_id'),
    );
    expect(cardFk?.onDelete).toBe('cascade');
  });

  // The published privacy policy says other people's boards keep your comments
  // when your account goes. A cascade here would make that sentence false.
  test('keeps the comment when its author is deleted', () => {
    const config = getTableConfig(comments);
    const authorFk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'author_id'),
    );
    expect(authorFk?.onDelete).toBe('set null');
    expect(config.columns.find((c) => c.name === 'author_id')?.notNull).toBe(false);
  });

  test('indexes the thread the way it is read', () => {
    const config = getTableConfig(comments);
    const names = config.indexes.map((i) => i.config.name);
    expect(names).toContain('comments_card_id_created_at_idx');
  });
});
```

Add `comments` to the schema import at the top of the file, matching how `cards` is already imported there.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/db/schema.test.ts > /tmp/schema.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/schema.log
```

Expected: FAIL — `comments` is not exported from `@/lib/db/schema`.

- [ ] **Step 3: Write the schema**

In `lib/db/schema.ts`, after the `cards` table:

```ts
export const comments = pgTable(
  'comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // Nullable and set null, not cascade: /privacy promises that boards owned
    // by other people keep your comments when your account is deleted.
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('comments_card_id_created_at_idx').on(t.cardId, t.createdAt)],
);
```

Then the relations, replacing the existing `cardsRelations`:

```ts
export const cardsRelations = relations(cards, ({ one, many }) => ({
  board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
  column: one(columns, { fields: [cards.columnId], references: [columns.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/db/schema.test.ts > /tmp/schema.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/schema.log
```

Expected: EXIT=0, three new tests passing.

- [ ] **Step 5: Generate the migration and read the SQL**

```bash
pnpm db:generate > /tmp/gen.log 2>&1; echo "EXIT=$?"
cat lib/db/migrations/0003_*.sql
```

**Read it, do not skim it.** Confirm by eye:
- `"card_id" ... ON DELETE cascade`
- `"author_id" text` with **no** `NOT NULL`, and `ON DELETE set null`
- `CREATE INDEX "comments_card_id_created_at_idx"`

If any of the three is wrong, fix `schema.ts` and regenerate. Never hand-edit generated SQL.

- [ ] **Step 6: Apply it to the dev branch and prove it landed**

```bash
pnpm db:migrate > /tmp/migrate.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/migrate.log
```

The success line is not proof. `psql` is not installed on this machine, so prove it with a throwaway script **at the repo root** — `pg` will not resolve from the scratchpad:

```bash
cat > ./check-comments.mjs <<'EOF'
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const pool = new Pool({ connectionString: env.DATABASE_URL });
const cols = await pool.query(
  `select column_name, is_nullable from information_schema.columns
   where table_name = 'comments' order by ordinal_position`);
console.table(cols.rows);
const fks = await pool.query(
  `select con.conname, con.confdeltype from pg_constraint con
   join pg_class rel on rel.oid = con.conrelid
   where con.contype = 'f' and rel.relname = 'comments'`);
console.table(fks.rows);   // expect confdeltype: card_id = c, author_id = n
await pool.end();
EOF
node ./check-comments.mjs
rm ./check-comments.mjs
```

Expected: `author_id` `is_nullable = YES`; `confdeltype` **c** for the card FK and **n** (set null) for the author FK.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/schema.test.ts lib/db/migrations
git commit -m "feat: add the comments table

authorId is nullable and sets null rather than cascading, because
/privacy already promises that boards owned by other people keep your
comments when your account is deleted."
```

### Task 3: Prove the referential actions against a real database

**Files:**
- Modify: `e2e/support/session.ts`
- Modify: `e2e/schema.spec.ts`

**Interfaces:**
- Consumes: `seedSession`, `seedBoard`, `boardColumns`, `seedCard`, `removeSeededUser`, `closeSeedPool` from `e2e/support/session.ts`.
- Produces: `seedComment(cardId, authorId, body?): Promise<string>` exported from `e2e/support/session.ts`.

- [ ] **Step 1: Write the seed helper**

Append to `e2e/support/session.ts`:

```ts
export async function seedComment(
  cardId: string,
  authorId: string,
  body = 'Seeded comment',
): Promise<string> {
  const commentId = crypto.randomUUID();
  await seedPool().query(
    'insert into comments (id, card_id, author_id, body) values ($1, $2, $3, $4)',
    [commentId, cardId, authorId, body],
  );
  return commentId;
}
```

- [ ] **Step 2: Write the failing test**

Append to `e2e/schema.spec.ts`:

```ts
test('deleting a card takes its comments with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Threaded');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });
  await seedComment(cardId, userId);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from cards where id = $1', [cardId]);
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from comments where card_id = $1',
      [cardId],
    );
    expect(rows[0].n).toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// The published privacy policy promises this exact behaviour: a board you do
// not own keeps your comments when your account goes.
test('deleting a user leaves their comments, authorless', async ({ context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Outliving');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });

  const commenter = await seedSession(context);
  await seedMember(boardId, commenter.userId, 'member');
  const commentId = await seedComment(cardId, commenter.userId, 'Still here');

  try {
    await removeSeededUser(commenter.userId);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query<{ author_id: string | null; body: string }>(
        'select author_id, body from comments where id = $1',
        [commentId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].author_id).toBeNull();
      expect(rows[0].body).toBe('Still here');
    } finally {
      await pool.end();
    }
  } finally {
    await removeSeededUser(owner.userId);
  }
});
```

Add `seedComment` and `seedMember` to the import list at the top of `e2e/schema.spec.ts`.

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: EXIT=1. If the migration has not been applied to the dev branch, the failure is `relation "comments" does not exist` — that is Task 2 Step 6 not done, not a test bug.

- [ ] **Step 4: Make them pass**

No implementation is needed: the schema from Task 2 is what these prove. Re-run after confirming the migration landed:

```bash
pnpm exec playwright test e2e/schema.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/e2e.log
```

Expected: EXIT=0, four tests in this file.

- [ ] **Step 5: Commit**

```bash
git add e2e/support/session.ts e2e/schema.spec.ts
git commit -m "test: prove the comment referential actions against a real database"
```

### Section 2 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, each exit code read from its own redirected log, and the count that ran compared against the count collected.
- [ ] The generated SQL was **read**: `author_id` has no `NOT NULL` and carries `ON DELETE set null`; `card_id` carries `ON DELETE cascade`.
- [ ] `information_schema` and `pg_constraint` on the dev branch agree with the SQL — `confdeltype` **n** for the author FK, **c** for the card FK.
- [ ] Both referential actions are proved by a real delete, not only by `schema.ts`.
- [ ] Nothing user-visible changed. Say so in the PR.
- [ ] **Production is migrated by hand before this merges**, not after. Vercel deploys from `main` and CI cannot gate it:
      `MIGRATE_URL="$(npx --yes neonctl@4 connection-string main --project-id withered-glade-54206401)" pnpm db:migrate`
- [ ] CI is green on the PR — that is what proves the migration applies to an empty database.
- [ ] Open the PR. Stop. Start Section 3 in a fresh session.

---

## Section 3 — The route pair and the card body

Branch: `feat/card-modal-routes`

The first visible change: a card opens. Title and description edit; due dates and comments arrive in Sections 4 and 5.

### Task 4: `lib/cards.ts` — one read, both entry points

**Files:**
- Create: `lib/cards.ts`
- Create: `lib/cards.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`; the `comments` relation from Task 2.
- Produces:
  - `type CardComment = { id: string; body: string; createdAt: Date; updatedAt: Date; author: { id: string; name: string | null; image: string | null } | null }`
  - `type CardForView = { id: string; boardId: string; columnId: string; title: string; description: string | null; dueDate: Date | null; comments: CardComment[] }`
  - `getCardForView(cardId: string): Promise<CardForView | null>`

- [ ] **Step 1: Write the failing test**

Create `lib/cards.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

let cardRow: unknown;
const findFirst = vi.fn(async (config: unknown) => {
  void config;
  return cardRow;
});

vi.mock('@/lib/db', () => ({
  db: { query: { cards: { findFirst: (config: unknown) => findFirst(config) } } },
}));

const { getCardForView } = await import('./cards');

type CommentsConfig = {
  orderBy: (
    comment: Record<string, unknown>,
    helpers: { asc: (column: unknown) => unknown },
  ) => unknown[];
};
type FindFirstConfig = { with: { comments: CommentsConfig } };

beforeEach(() => {
  cardRow = undefined;
  findFirst.mockClear();
});

describe('getCardForView', () => {
  test('returns null for a card that is not there', async () => {
    await expect(getCardForView('missing')).resolves.toBeNull();
  });

  test('reads the thread oldest first, which is how it is rendered', async () => {
    cardRow = { id: 'k1', boardId: 'b1', columnId: 'c1', title: 'Ship it', comments: [] };
    await getCardForView('k1');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;
    const asc = vi.fn();
    config.with.comments.orderBy({ createdAt: 'created_at', id: 'id' }, { asc });
    expect(asc).toHaveBeenNthCalledWith(1, 'created_at');
    // The tie-break, so two comments in the same millisecond keep a stable order.
    expect(asc).toHaveBeenNthCalledWith(2, 'id');
  });

  test('carries an authorless comment through rather than dropping it', async () => {
    cardRow = {
      id: 'k1',
      boardId: 'b1',
      columnId: 'c1',
      title: 'Ship it',
      description: null,
      dueDate: null,
      comments: [
        { id: 'm1', body: 'Still here', createdAt: new Date(0), updatedAt: new Date(0), author: null },
      ],
    };

    const card = await getCardForView('k1');
    expect(card?.comments[0].author).toBeNull();
    expect(card?.comments[0].body).toBe('Still here');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/cards.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/unit.log
```

Expected: FAIL — cannot resolve `./cards`.

- [ ] **Step 3: Write the implementation**

Create `lib/cards.ts`:

```ts
import { cache } from 'react';

import { db } from '@/lib/db';

export type CardComment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string | null; image: string | null } | null;
};

export type CardForView = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  comments: CardComment[];
};

// Both the intercepted slot and the canonical page read the card and both
// re-check access, because CLAUDE.md requires every entry point to verify
// rather than trust a parent. React's cache collapses the duplicate call.
export const getCardForView = cache(async (cardId: string): Promise<CardForView | null> => {
  const card = await db.query.cards.findFirst({
    where: (c, { eq }) => eq(c.id, cardId),
    columns: {
      id: true,
      boardId: true,
      columnId: true,
      title: true,
      description: true,
      dueDate: true,
    },
    with: {
      comments: {
        columns: { id: true, body: true, createdAt: true, updatedAt: true },
        orderBy: (comment, { asc }) => [asc(comment.createdAt), asc(comment.id)],
        with: { author: { columns: { id: true, name: true, image: true } } },
      },
    },
  });

  return card ?? null;
});
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/cards.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

Expected: EXIT=0, three tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cards.ts lib/cards.test.ts
git commit -m "feat: read a card and its thread for both entry points"
```

### Task 5: The routes, and opening a card from the board

**Files:**
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`
- Create: `app/(app)/(board)/boards/[boardId]/@card/default.tsx`
- Create: `app/(app)/(board)/boards/[boardId]/@card/(.)cards/[cardId]/page.tsx`
- Create: `app/(app)/(board)/boards/[boardId]/cards/[cardId]/page.tsx`
- Create: `components/board/card-modal.tsx`
- Create: `components/board/card-body.tsx`
- Modify: `components/board/board-card.tsx`
- Modify: `components/board/board-canvas.tsx`
- Create: `e2e/card-modal.spec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `getCardForView`, `CardForView` from Task 4; `assertBoardAccess`, `atLeast`, `BoardAccessError` from `@/lib/permissions`.
- Produces:
  - `CardModal({ children }: { children: React.ReactNode })` — client, wraps content in a `Dialog` and calls `router.back()` on close.
  - `CardBody({ card, canWrite, canComment }: { card: CardForView; canWrite: boolean; canComment: boolean })` — client. Task 10 adds `viewerId: string`.
  - `BoardCard` gains a required `boardId: string` prop.

- [ ] **Step 1: Write the failing test**

Create `e2e/card-modal.spec.ts`:

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

test('clicking a card opens it over a board that is still there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    await expect(page).toHaveURL(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    // The board is behind the modal, not replaced by it.
    await expect(page.locator(`[data-column-id="${ready.id}"]`)).toBeAttached();
  } finally {
    await removeSeededUser(userId);
  }
});

test('browser-back closes the card and leaves the board mounted', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(`/boards/${boardId}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('card-title')).toHaveText(['Ship it']);
  } finally {
    await removeSeededUser(userId);
  }
});

// The half that fails silently: a broken intercept looks like a working
// full-page navigation, so this asserts the absence of the dialog.
test('a cold load of the card URL renders a page, not a modal', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);

    await expect(page.getByRole('heading', { name: 'Ship it' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-column-id]')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

// The URL carries both ids. Pairing someone else's card with a board you can
// read must not open it.
test('a card id from another board is not found', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const mine = await seedBoard(userId, 'Mine');
  const other = await seedBoard(userId, 'Other');
  const [otherFirst] = await boardColumns(other);
  const strayId = await seedCard(otherFirst.id, { boardId: other, createdById: userId });

  try {
    const response = await page.goto(`/boards/${mine}/cards/${strayId}`);
    expect(response?.status()).toBe(404);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer opens a card and cannot edit its fields', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Ship it' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByRole('heading', { name: 'Ship it' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Card title' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/card-modal.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: EXIT=1 — clicking a card navigates nowhere, and the card URL 404s.

- [ ] **Step 3: Write the card body**

Create `components/board/card-body.tsx`. In this task it renders read-only; Task 6 makes the fields editable.

```tsx
'use client';

import type { CardForView } from '@/lib/cards';

export function CardBody({
  card,
  canWrite,
  canComment,
}: {
  card: CardForView;
  canWrite: boolean;
  canComment: boolean;
}) {
  void canWrite;
  void canComment;

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-sm font-medium leading-5 text-ink">{card.title}</h1>
      <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink">
        {card.description ?? <span className="text-muted">No description yet</span>}
      </p>
    </article>
  );
}
```

- [ ] **Step 4: Write the modal wrapper**

Create `components/board/card-modal.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';

import { Dialog, DialogContent } from '@/components/ui/dialog';

// Closing the card is a navigation, not a state change — which is what makes
// browser-back close it and forward reopen it.
export function CardModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent>{children}</DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the three route files**

`app/(app)/(board)/boards/[boardId]/@card/default.tsx` — required; an unmatched slot with no default renders a 404:

```tsx
export default function Default() {
  return null;
}
```

`app/(app)/(board)/boards/[boardId]/@card/(.)cards/[cardId]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';

import { CardBody } from '@/components/board/card-body';
import { CardModal } from '@/components/board/card-modal';
import { auth } from '@/lib/auth';
import { getCardForView } from '@/lib/cards';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const card = await getCardForView(cardId);
  // The URL carries both ids; a card that is not on this board is not found
  // here, whatever the caller can see elsewhere.
  if (!card || card.boardId !== boardId) notFound();

  let role;
  try {
    role = await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  return (
    <CardModal>
      <CardBody card={card} canWrite={atLeast(role, 'member')} canComment />
    </CardModal>
  );
}
```

`app/(app)/(board)/boards/[boardId]/cards/[cardId]/page.tsx` — the same checks, no dialog:

```tsx
import { notFound, redirect } from 'next/navigation';

import { CardBody } from '@/components/board/card-body';
import { auth } from '@/lib/auth';
import { getCardForView } from '@/lib/cards';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const card = await getCardForView(cardId);
  if (!card || card.boardId !== boardId) notFound();

  let role;
  try {
    role = await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <CardBody card={card} canWrite={atLeast(role, 'member')} canComment />
    </div>
  );
}
```

- [ ] **Step 6: Give the layout its slot**

In `app/(app)/(board)/boards/[boardId]/layout.tsx`, add `card` to the destructured props and its type, then render it after the content div:

```tsx
export default async function BoardTitleLayout({
  children,
  card,
  params,
}: {
  children: React.ReactNode;
  card: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
```

```tsx
        <div className="min-h-0 flex-1">{children}</div>
        {card}
```

- [ ] **Step 7: Make the card open**

In `components/board/board-card.tsx`, add a `boardId: string` prop and wrap the title in a link. The 5px drag activation is what keeps this from firing on a drag:

```tsx
import Link from 'next/link';
```

```tsx
      <h3
        data-testid="card-title"
        className={`text-sm font-medium leading-5 text-ink ${canWrite ? 'pr-6' : ''}`}
      >
        <Link href={`/boards/${boardId}/cards/${card.id}`} className="after:absolute after:inset-0">
          {card.title}
        </Link>
      </h3>
```

In `components/board/board-canvas.tsx`, pass `boardId={board.id}` wherever `BoardCard` is rendered — including inside the `DragOverlay`, or the overlay will not typecheck.

- [ ] **Step 8: Run the tests and watch them pass**

```bash
pnpm exec playwright test e2e/card-modal.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/e2e.log
```

Expected: EXIT=0, five tests. Then the whole suite, because `board-dnd.spec.ts` asserts a click does **not** move a card and now that click also navigates:

```bash
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

- [ ] **Step 9: Correct `CLAUDE.md`**

The Layout section currently shows `@card/(.)cards/[cardId]` against a canonical page at `/cards/[cardId]`, which cannot intercept. Update the tree to:

```
    (board)/
      boards/[boardId]/
        @card/(.)cards/[cardId]/  # intercepted — renders as modal over the board
        cards/[cardId]/           # canonical card page — the intercept target, and
                                  # what a shared link opens on a cold load
```

and change the prose below it so the canonical URL reads `/boards/[boardId]/cards/[cardId]`, noting that the marker counts route segments — neither slots nor route groups are segments — so keeping both at the same level is what makes `(.)` the documented case.

- [ ] **Step 10: Commit**

```bash
git add app components/board CLAUDE.md e2e/card-modal.spec.ts
git commit -m "feat: open a card as a modal, or as a page on a cold load

The canonical page moves under the board so the intercept is the
same-level case the Next docs document. CLAUDE.md's Layout tree named a
marker that could not reach the page it also named."
```

### Task 6: Title and description, committed on blur

**Files:**
- Modify: `lib/actions/cards.ts`
- Modify: `lib/actions/cards.test.ts`
- Modify: `components/board/board-actions.tsx`
- Modify: `components/board/board-canvas.tsx`
- Modify: `components/board/card-body.tsx`
- Modify: `e2e/card-modal.spec.ts`

**Interfaces:**
- Consumes: `renameCard` from `@/lib/actions/cards`; `useBoardActions` from `@/components/board/board-actions`.
- Produces:
  - `setCardDescription(input: unknown)` — `{ cardId: string; description: string }`, member.
  - `BoardActionsContext` gains `patchCard: ((cardId: string, patch: { title?: string; dueDate?: string | null }) => void) | null` and `registerPatchCard(handler: PatchCard | null): void`.

- [ ] **Step 1: Write the failing test**

Append to `lib/actions/cards.test.ts`, following the existing mock harness in that file:

```ts
describe('setCardDescription', () => {
  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(setCardDescription({ cardId: 'card-1', description: 'Why' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('authorises the board resolved from the card, at member', async () => {
    await setCardDescription({ cardId: 'card-1', description: 'Why' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'member');
  });

  test('writes the description and bumps the board', async () => {
    await setCardDescription({ cardId: 'card-1', description: '  Why  ' });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { description: 'Why' } });
    expect(ops.some((op) => op.table === 'boards')).toBe(true);
  });

  test('an empty description clears it rather than failing', async () => {
    const result = await setCardDescription({ cardId: 'card-1', description: '' });
    expect(result).toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { description: null } });
  });

  test('refuses a description past the cap', async () => {
    await expect(
      setCardDescription({ cardId: 'card-1', description: 'x'.repeat(10_001) }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });
});
```

Add `setCardDescription` to the import from `./cards` at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/actions/cards.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/unit.log
```

Expected: FAIL — `setCardDescription` is not exported.

- [ ] **Step 3: Write the action**

In `lib/actions/cards.ts`, add the schema beside the others:

```ts
const descriptionSchema = z.object({
  cardId: id,
  description: z.string().trim().max(10_000),
});
```

and the action, following the shape of `renameCard` exactly:

```ts
export async function setCardDescription(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = descriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // An emptied field is a cleared description, not a rejected one.
  const description = parsed.data.description === '' ? null : parsed.data.description;

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ description }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/actions/cards.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

- [ ] **Step 5: Give the actions context a card patch**

Replace the context type and provider body in `components/board/board-actions.tsx`:

```tsx
type Handler = () => void;
export type CardPatch = { title?: string; dueDate?: string | null };
type PatchCard = (cardId: string, patch: CardPatch) => void;

const BoardActionsContext = createContext<{
  addCard: Handler | null;
  register: (handler: Handler | null) => void;
  patchCard: PatchCard | null;
  registerPatchCard: (handler: PatchCard | null) => void;
} | null>(null);
```

Inside the provider, beside the existing `addCard` state:

```tsx
  const [patchCard, setPatchCard] = useState<PatchCard | null>(null);

  const registerPatchCard = useCallback(
    (handler: PatchCard | null) => setPatchCard(() => handler),
    [],
  );

  const value = useMemo(
    () => ({ addCard, register, patchCard, registerPatchCard }),
    [addCard, register, patchCard, registerPatchCard],
  );
```

The `setState(() => handler)` wrapper is not decoration — `setState` treats a bare function as an updater and would call it. The file already documents this for `addCard`.

- [ ] **Step 6: Register it from the canvas**

In `components/board/board-canvas.tsx`, take `registerPatchCard` from `useBoardActions()` and register beside the existing `addCard` effect:

```tsx
  // The modal is a sibling slot, not a child, so this context is the only place
  // the two trees meet. On the canonical card page nothing registers, and the
  // modal simply finds null.
  useEffect(() => {
    registerPatchCard((cardId, patch) => {
      if (patch.title !== undefined) dispatch({ type: 'card.rename', cardId, title: patch.title });
    });
    return () => registerPatchCard(null);
  }, [registerPatchCard]);
```

Section 4 extends this handler with `dueDate`.

- [ ] **Step 7: Make the fields editable**

Rewrite `components/board/card-body.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { renameCard, setCardDescription } from '@/lib/actions/cards';
import type { CardForView } from '@/lib/cards';

export function CardBody({
  card,
  canWrite,
  canComment,
}: {
  card: CardForView;
  canWrite: boolean;
  canComment: boolean;
}) {
  void canComment;

  const { patchCard } = useBoardActions();
  const [title, setTitle] = useState(card.title);
  const [savedTitle, setSavedTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [savedDescription, setSavedDescription] = useState(card.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const commitTitle = () => {
    const next = title.trim();
    if (next === savedTitle) return;
    if (!next) {
      setTitle(savedTitle);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameCard({ cardId: card.id, title: next });
      if (result.ok) {
        setSavedTitle(next);
        setTitle(next);
        patchCard?.(card.id, { title: next });
      } else {
        setTitle(savedTitle);
        setError('That card could not be renamed. Try again.');
      }
    });
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === savedDescription) return;
    setError(null);
    startTransition(async () => {
      const result = await setCardDescription({ cardId: card.id, description: next });
      if (result.ok) {
        setSavedDescription(next);
        setDescription(next);
      } else {
        setDescription(savedDescription);
        setError('That description could not be saved. Try again.');
      }
    });
  };

  if (!canWrite) {
    return (
      <article className="flex flex-col gap-4">
        <h1 className="text-sm font-medium leading-5 text-ink">{savedTitle}</h1>
        <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink">
          {savedDescription || <span className="text-muted">No description yet</span>}
        </p>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      <h1 className="sr-only">{savedTitle}</h1>
      <input
        aria-label="Card title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // The dialog also listens for Escape; reverting the field should
            // not also close the card out from under the person doing it.
            event.stopPropagation();
            setTitle(savedTitle);
          }
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-sm font-medium text-ink"
      />
      <textarea
        aria-label="Description"
        value={description}
        rows={6}
        placeholder="Add a description"
        onChange={(event) => setDescription(event.target.value)}
        onBlur={commitDescription}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDescription(savedDescription);
          }
        }}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-[15px] leading-6 text-ink"
      />
      <p role="status" aria-live="polite" className="min-h-5 text-xs text-time-over">
        {error}
      </p>
    </article>
  );
}
```

The read-only branch renders a real `<h1>`, which is what the viewer test asserts; the editable branch keeps one for the accessible name and hides it.

- [ ] **Step 8: Extend the e2e**

Append to `e2e/card-modal.spec.ts`:

```ts
test('a title edited in the modal changes the card behind it', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    const title = page.getByRole('textbox', { name: 'Card title' });
    await title.fill('Ship it twice');
    await title.blur();

    await page.goBack();
    await expect(page.getByTestId('card-title')).toHaveText(['Ship it twice']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a description survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    const description = page.getByRole('textbox', { name: 'Description' });
    await description.fill('Because the board is the product');
    await description.blur();
    await written(page);

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Because the board is the product',
    );
  } finally {
    await removeSeededUser(userId);
  }
});
```

Add `written` to the import from `./support/session`.

- [ ] **Step 9: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "EXIT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

- [ ] **Step 10: Commit**

```bash
git add lib/actions components/board e2e/card-modal.spec.ts
git commit -m "feat: edit a card's title and description from the modal"
```

### Section 3 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] **`pnpm build` passes.** This is the only check that catches a client component importing a value from `lib/permissions.ts`; the other three pass on that code.
- [ ] Clicking a card opens the modal **and the board is still mounted behind it** — asserted on `[data-column-id]`, not on a screenshot.
- [ ] A cold load renders the page and **no dialog**, checked in a real browser as well as in Playwright. This is the silent failure the spike existed for.
- [ ] Browser-back closes the modal and the board still shows its cards.
- [ ] A card id from another board 404s.
- [ ] A dragged card still does not open the modal — the 5px activation distance is intact, and `e2e/board-dnd.spec.ts` still passes unchanged.
- [ ] `CLAUDE.md`'s Layout section is corrected in this PR, not a later one.
- [ ] Screenshots of the modal and the canonical page, both themes, in the PR body.
- [ ] Open the PR. Stop. Start Section 4 in a fresh session.

---

## Section 4 — Due dates, end to end

Branch: `feat/card-due-dates`

The app's first warm colour. Due dates come after the modal because a card face that renders a value nothing can set is not demonstrable.

### Task 7: `lib/due.ts` — the calendar-date rules, and no I/O

**Files:**
- Create: `lib/due.ts`
- Create: `lib/due.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DueState = 'plain' | 'soon' | 'over'`
  - `daysUntilDue(due: Date, now: Date): number`
  - `dueState(due: Date, now: Date): DueState`
  - `dueLabel(due: Date, now: Date): string | null`
  - `toDateInputValue(due: Date): string` — `yyyy-mm-dd`
  - `fromDateInputValue(value: string): Date | null` — midnight UTC
  - `formatDue(due: Date, locale?: string): string`

- [ ] **Step 1: Write the failing test**

Create `lib/due.test.ts`. Every `now` is built with the **local** `Date` constructor and every `due` with `Date.UTC`, which is what makes these assertions hold in any timezone the suite happens to run in:

```ts
import { describe, expect, test } from 'vitest';

import {
  daysUntilDue,
  dueLabel,
  dueState,
  formatDue,
  fromDateInputValue,
  toDateInputValue,
} from './due';

const due = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const at = (y: number, m: number, d: number, hour = 12) => new Date(y, m - 1, d, hour);

describe('daysUntilDue', () => {
  test('counts calendar days, not elapsed time', () => {
    expect(daysUntilDue(due(2026, 9, 3), at(2026, 9, 1))).toBe(2);
    expect(daysUntilDue(due(2026, 8, 29), at(2026, 9, 1))).toBe(-3);
  });

  // The bug this whole module exists to prevent. A due date of today, read late
  // in the evening west of Greenwich, is 'today' — not yesterday. Comparing the
  // stored instant against the current instant would say otherwise.
  test('a date due today is today, even at 23:00', () => {
    expect(daysUntilDue(due(2026, 9, 1), at(2026, 9, 1, 23))).toBe(0);
  });

  test('and at 00:30', () => {
    expect(daysUntilDue(due(2026, 9, 1), at(2026, 9, 1, 0))).toBe(0);
  });
});

describe('dueState', () => {
  test('today and tomorrow are soon', () => {
    expect(dueState(due(2026, 9, 1), at(2026, 9, 1))).toBe('soon');
    expect(dueState(due(2026, 9, 2), at(2026, 9, 1))).toBe('soon');
  });

  test('the day after tomorrow is plain', () => {
    expect(dueState(due(2026, 9, 3), at(2026, 9, 1))).toBe('plain');
  });

  test('yesterday is over', () => {
    expect(dueState(due(2026, 8, 31), at(2026, 9, 1))).toBe('over');
  });
});

describe('dueLabel', () => {
  test('names how far past it is, and says nothing otherwise', () => {
    expect(dueLabel(due(2026, 8, 29), at(2026, 9, 1))).toBe('3d over');
    expect(dueLabel(due(2026, 8, 31), at(2026, 9, 1))).toBe('1d over');
    expect(dueLabel(due(2026, 9, 1), at(2026, 9, 1))).toBeNull();
    expect(dueLabel(due(2026, 9, 5), at(2026, 9, 1))).toBeNull();
  });
});

describe('the input round trip', () => {
  test('a date survives it unchanged', () => {
    expect(toDateInputValue(due(2026, 9, 1))).toBe('2026-09-01');
    expect(fromDateInputValue('2026-09-01')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  test('rejects anything that is not a plain calendar date', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('01/09/2026')).toBeNull();
    expect(fromDateInputValue('2026-13-01')).toBeNull();
  });
});

describe('formatDue', () => {
  test('formats from the UTC parts, not the runner timezone', () => {
    expect(formatDue(due(2026, 9, 1), 'en-GB')).toBe('1 Sep');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/due.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/unit.log
```

Expected: FAIL — cannot resolve `./due`.

- [ ] **Step 3: Write the implementation**

Create `lib/due.ts`:

```ts
export type DueState = 'plain' | 'soon' | 'over';

const DAY = 86_400_000;

// The column is a timestamptz, but the value is a calendar date stored at
// midnight UTC. Both sides are reduced to a day number before comparing:
// the due date from its UTC parts, and "now" from the viewer's local parts,
// because whether something is overdue is a question about the reader's day.
const utcDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY;

const localDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;

export function daysUntilDue(due: Date, now: Date): number {
  return utcDay(due) - localDay(now);
}

export function dueState(due: Date, now: Date): DueState {
  const days = daysUntilDue(due, now);
  if (days < 0) return 'over';
  return days <= 1 ? 'soon' : 'plain';
}

export function dueLabel(due: Date, now: Date): string | null {
  const days = daysUntilDue(due, now);
  return days < 0 ? `${-days}d over` : null;
}

export function toDateInputValue(due: Date): string {
  return due.toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const due = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime())) return null;
  // new Date rolls '2026-13-01' over into the next year rather than failing.
  return toDateInputValue(due) === value ? due : null;
}

export function formatDue(due: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(due);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/due.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

- [ ] **Step 5: Commit**

```bash
git add lib/due.ts lib/due.test.ts
git commit -m "feat: add the calendar-date rules for due dates"
```

### Task 8: Setting a due date, and painting it on the card

**Files:**
- Modify: `lib/actions/cards.ts`
- Modify: `lib/actions/cards.test.ts`
- Modify: `lib/boards.ts`
- Modify: `lib/board-state.ts`
- Modify: `lib/board-state.test.ts`
- Create: `components/board/card-due-date.tsx`
- Modify: `components/board/card-body.tsx`
- Modify: `components/board/board-card.tsx`
- Modify: `components/board/board-canvas.tsx`
- Modify: `e2e/card-modal.spec.ts`

**Interfaces:**
- Consumes: everything `lib/due.ts` produces.
- Produces:
  - `setCardDueDate(input: unknown)` — `{ cardId: string; dueDate: string | null }`, member.
  - `StateCard` gains `dueDate: string | null` (`yyyy-mm-dd`).
  - `BoardAction` gains `{ type: 'card.setDueDate'; cardId: string; dueDate: string | null }`.
  - `BoardCardRow` gains `dueDate: Date | null`.
  - `CardDueDate({ value, canWrite, onCommit }: { value: string | null; canWrite: boolean; onCommit: (value: string | null) => void })`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/actions/cards.test.ts`:

```ts
describe('setCardDueDate', () => {
  test('refuses a viewer', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(setCardDueDate({ cardId: 'card-1', dueDate: '2026-09-01' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('stores midnight UTC of the chosen day', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: '2026-09-01' });
    const write = ops.find((op) => op.kind === 'update' && op.table === 'cards');
    expect((write?.values as { dueDate: Date }).dueDate.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  test('null clears the date', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: null });
    expect(ops).toContainEqual({ kind: 'update', table: 'cards', values: { dueDate: null } });
  });

  test('refuses anything that is not a plain calendar date', async () => {
    await expect(setCardDueDate({ cardId: 'card-1', dueDate: '01/09/2026' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });
});
```

Append to `lib/board-state.test.ts`, matching the existing reducer test style in that file:

```ts
describe('card.setDueDate', () => {
  const seeded = {
    columns: [{ id: 'c1', name: 'Ready to Work', rank: 'a0' }],
    cards: [{ id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: '', dueDate: null }],
  };

  test('sets the date on the named card', () => {
    const next = boardReducer(seeded, {
      type: 'card.setDueDate',
      cardId: 'k1',
      dueDate: '2026-09-01',
    });
    expect(next.cards[0].dueDate).toBe('2026-09-01');
  });

  test('inverts back to what was there before, including null', () => {
    const undo = inverse(seeded, { type: 'card.setDueDate', cardId: 'k1', dueDate: '2026-09-01' });
    expect(undo).toEqual([{ type: 'card.setDueDate', cardId: 'k1', dueDate: null }]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm exec vitest run lib/actions/cards.test.ts lib/board-state.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/unit.log
```

Expected: FAIL — `setCardDueDate` is not exported, and `card.setDueDate` is not a `BoardAction`.

- [ ] **Step 3: Write the action**

In `lib/actions/cards.ts`, import the helper and add the schema and action:

```ts
import { fromDateInputValue } from '@/lib/due';
```

```ts
const dueDateSchema = z.object({ cardId: id, dueDate: z.string().nullable() });
```

```ts
export async function setCardDueDate(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = dueDateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  // A calendar date, not an instant: the client sends yyyy-mm-dd and the row
  // holds midnight UTC of that day.
  const dueDate = parsed.data.dueDate === null ? null : fromDateInputValue(parsed.data.dueDate);
  if (parsed.data.dueDate !== null && dueDate === null) {
    return { ok: false, error: 'INVALID' } as const;
  }

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ dueDate }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
```

- [ ] **Step 4: Extend the reducer**

In `lib/board-state.ts`: add `dueDate: string | null` to `StateCard`; add to `BoardAction`:

```ts
  | { type: 'card.setDueDate'; cardId: string; dueDate: string | null }
```

to `boardReducer`:

```ts
    case 'card.setDueDate':
      return mapCard(state, action.cardId, (card) => ({ ...card, dueDate: action.dueDate }));
```

and to `inverse`:

```ts
    case 'card.setDueDate': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.setDueDate', cardId: card.id, dueDate: card.dueDate }] : [];
    }
```

- [ ] **Step 5: Carry the date into the board read and the seed**

In `lib/boards.ts`, add `dueDate: Date | null` to `BoardCardRow` and `dueDate: true` to the cards `columns` selection in `getBoardWithColumns`.

In `components/board/board-canvas.tsx`, `seed()` maps it to the input form:

```ts
        dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
```

and every place that builds a `StateCard` optimistically — the create path — sets `dueDate: null`.

- [ ] **Step 6: Paint it on the card face**

In `components/board/board-card.tsx`, render the date under the title.

**The state must be computed after mount, not during render.** `dueState` depends on the viewer's local today, so a server render and a client render can disagree and React does not patch a mismatched attribute — the same failure that left dnd-kit's `aria-describedby` dangling in sub-project 4. The date *text* comes from UTC parts and is stable, so it renders on both sides; only the colour and the `Nd over` label wait for the client:

```tsx
import { useEffect, useState } from 'react';

import { dueLabel, dueState, formatDue, fromDateInputValue } from '@/lib/due';
```

```tsx
function DueDate({ value }: { value: string }) {
  const due = fromDateInputValue(value);
  const [now, setNow] = useState<Date | null>(null);

  // Server and client disagree about "today", so the warm state is decided
  // after mount. The date text itself comes from UTC parts and is stable.
  useEffect(() => setNow(new Date()), []);

  if (!due) return null;

  const state = now ? dueState(due, now) : 'plain';
  const label = now ? dueLabel(due, now) : null;
  const tone =
    state === 'over' ? 'text-time-over' : state === 'soon' ? 'text-time-soon' : 'text-muted';

  return (
    <p className={`mt-1.5 font-mono text-xs ${tone}`}>
      {formatDue(due)}
      {label ? ` · ${label}` : ''}
    </p>
  );
}
```

and inside the card, after the title:

```tsx
      {card.dueDate ? <DueDate value={card.dueDate} /> : null}
```

- [ ] **Step 7: Write the control**

Create `components/board/card-due-date.tsx`:

```tsx
'use client';

// A native date input: no dependency, keyboard-accessible without work, and
// formatted in the viewer's locale by the browser.
export function CardDueDate({
  value,
  canWrite,
  onCommit,
}: {
  value: string | null;
  canWrite: boolean;
  onCommit: (value: string | null) => void;
}) {
  if (!canWrite) {
    return value ? (
      <p className="font-mono text-xs text-muted">Due {value}</p>
    ) : null;
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Due
      <input
        type="date"
        aria-label="Due date"
        value={value ?? ''}
        onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
      />
    </label>
  );
}
```

A date input has no meaningful blur semantics — it commits when a date is picked — so this one writes on change rather than on blur.

- [ ] **Step 8: Wire it into the card body**

In `components/board/card-body.tsx`, add the state and handler beside the title and description:

```tsx
  const [dueDate, setDueDate] = useState(card.dueDate ? toDateInputValue(card.dueDate) : null);

  const commitDueDate = (next: string | null) => {
    const previous = dueDate;
    setDueDate(next);
    setError(null);
    startTransition(async () => {
      const result = await setCardDueDate({ cardId: card.id, dueDate: next });
      if (result.ok) {
        patchCard?.(card.id, { dueDate: next });
      } else {
        setDueDate(previous);
        setError('That due date could not be saved. Try again.');
      }
    });
  };
```

and render `<CardDueDate value={dueDate} canWrite={canWrite} onCommit={commitDueDate} />` in both the editable and read-only branches.

Then extend the canvas's `registerPatchCard` handler from Section 3:

```tsx
      if (patch.dueDate !== undefined) {
        dispatch({ type: 'card.setDueDate', cardId, dueDate: patch.dueDate });
      }
```

- [ ] **Step 9: Write the e2e, including the timezone proof**

Append to `e2e/card-modal.spec.ts`:

```ts
test('a due date set in the modal appears on the card face', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    await page.getByLabel('Due date').fill('2026-09-01');
    await written(page);

    await page.goBack();
    await expect(page.locator('[data-card-id]').filter({ hasText: 'Ship it' })).toContainText(
      '1 Sep',
    );
  } finally {
    await removeSeededUser(userId);
  }
});

// The one-day drift this module exists to prevent, proved in a browser that is
// actually west of Greenwich rather than in a unit test that reasons about it.
test.describe('west of Greenwich', () => {
  test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-GB' });

  test('a due date reads as the day it was set to', async ({ page, context }) => {
    const { userId } = await seedSession(context);
    const boardId = await seedBoard(userId, 'Roadmap');
    const [ready] = await boardColumns(boardId);
    const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

    try {
      await page.goto(`/boards/${boardId}/cards/${cardId}`);
      await page.getByLabel('Due date').fill('2026-09-01');
      await written(page);
      await page.reload();

      await expect(page.getByLabel('Due date')).toHaveValue('2026-09-01');
    } finally {
      await removeSeededUser(userId);
    }
  });
});
```

- [ ] **Step 10: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "EXIT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

- [ ] **Step 11: Commit**

```bash
git add lib components/board e2e/card-modal.spec.ts
git commit -m "feat: set a due date, and paint it on the card"
```

### Section 4 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test && pnpm build` all pass, exit codes read from redirected logs.
- [ ] An overdue card is rust and carries a mono `Nd over` label; a card due today or tomorrow is amber; one due later is `--muted`. Confirmed **by eye in a browser**, both themes, not only asserted.
- [ ] **No hydration warning in the console on a board with due dates.** Open one and read the console — the warm state is decided after mount precisely to avoid this, and it is the exact failure sub-project 4 shipped for three commits.
- [ ] A due date set as today still reads as today in a browser set to `America/Los_Angeles`.
- [ ] Clearing the date empties it rather than erroring.
- [ ] Nothing warm appears anywhere except a due date.
- [ ] Screenshots of a board with overdue, soon and plain cards, both themes, in the PR body.
- [ ] Open the PR. Stop. Start Section 5 in a fresh session.

---

## Section 5 — Comments

Branch: `feat/card-comments`

### Task 9: `commentScope` and the three comment actions

**Files:**
- Modify: `lib/actions/scope.ts`
- Create: `lib/actions/comments.ts`
- Create: `lib/actions/comments.test.ts`

**Interfaces:**
- Consumes: `assertBoardAccess`, `boardAccessResult`; `comments` from `@/lib/db/schema`.
- Produces:
  - `commentScope(commentId: string): Promise<{ boardId: string; authorId: string | null } | null>`
  - `addComment(input: unknown)` — `{ cardId: string; body: string }`, any member.
  - `editComment(input: unknown)` — `{ commentId: string; body: string }`, author only.
  - `deleteComment(input: unknown)` — `{ commentId: string }`, author only.
  - `addComment` returns `{ ok: true, data: { id: string } }`. The client keeps its own optimistic timestamp, so the server's is not sent back.

- [ ] **Step 1: Write the failing test**

Create `lib/actions/comments.test.ts`, copying the mock harness at the top of `lib/actions/cards.test.ts` and adding a `comments` row to it. The row must be shaped like the **query result** `commentScope` reads, not like the value it returns:

```ts
let commentRow: { authorId: string | null; card: { boardId: string } } | undefined;

const query = {
  cards: { findFirst: async () => cardRow },
  comments: { findFirst: async () => commentRow },
};
```

Reset it in `beforeEach` to `{ authorId: 'user-1', card: { boardId: 'b1' } }`, and set `cardRow` to `{ id: 'card-1', boardId: 'b1' }` so `boardIdForCard` resolves.

```ts
describe('addComment', () => {
  test('lets a viewer comment', async () => {
    // CLAUDE.md grants viewers read and comment. The floor here is 'viewer',
    // not 'member', and that is the whole difference from the card actions.
    await addComment({ cardId: 'card-1', body: 'Looks right' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a non-member', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    await expect(addComment({ cardId: 'card-1', body: 'Hello' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('trims the body and refuses an empty one', async () => {
    await expect(addComment({ cardId: 'card-1', body: '   ' })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  test('refuses a body past the cap', async () => {
    await expect(addComment({ cardId: 'card-1', body: 'x'.repeat(4_001) })).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });
});

describe('editComment', () => {
  test('checks membership before authorship', async () => {
    // Order matters: answering authorship first would tell someone with no
    // membership that the comment exists.
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('refuses everyone on a comment whose author was deleted', async () => {
    commentRow = { authorId: null, card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author edit', async () => {
    commentRow = { authorId: 'user-1', card: { boardId: 'b1' } };
    await expect(editComment({ commentId: 'm1', body: 'Edited' })).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'update', table: 'comments', values: { body: 'Edited' } });
  });
});

describe('deleteComment', () => {
  test('refuses a member who is not the author', async () => {
    commentRow = { authorId: 'someone-else', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('lets the author delete', async () => {
    commentRow = { authorId: 'user-1', card: { boardId: 'b1' } };
    await expect(deleteComment({ commentId: 'm1' })).resolves.toEqual({ ok: true });
    expect(ops).toContainEqual({ kind: 'delete', table: 'comments' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/actions/comments.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/unit.log
```

Expected: FAIL — cannot resolve `./comments`.

- [ ] **Step 3: Write the scope helper**

Append to `lib/actions/scope.ts`:

```ts
// One query for both facts an author-only check needs. The board answers "may
// you be here", the author answers "is it yours", and they are asked in that
// order.
export async function commentScope(
  commentId: string,
): Promise<{ boardId: string; authorId: string | null } | null> {
  const comment = await db.query.comments.findFirst({
    where: (c, { eq: is }) => is(c.id, commentId),
    columns: { authorId: true },
    with: { card: { columns: { boardId: true } } },
  });

  return comment ? { boardId: comment.card.boardId, authorId: comment.authorId } : null;
}
```

- [ ] **Step 4: Write the actions**

Create `lib/actions/comments.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { comments } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

import { boardIdForCard, commentScope, touchBoard } from './scope';

const id = z.string().min(1);
const body = z.string().trim().min(1).max(4_000);

const addSchema = z.object({ cardId: id, body });
const editSchema = z.object({ commentId: id, body });
const deleteSchema = z.object({ commentId: id });

export async function addComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  // A viewer may comment. This is the only write in the app with that floor.
  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({
        cardId: parsed.data.cardId,
        authorId: session.user.id,
        body: parsed.data.body,
      })
      .returning();

    await touchBoard(tx, boardId);
    return { id: row.id };
  });

  return { ok: true, data: created } as const;
}

export async function editComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const scope = await commentScope(parsed.data.commentId);
  if (!scope) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, scope.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (scope.authorId !== session.user.id) return { ok: false, error: 'FORBIDDEN' } as const;

  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ body: parsed.data.body })
      .where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
  });

  return { ok: true } as const;
}

export async function deleteComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const scope = await commentScope(parsed.data.commentId);
  if (!scope) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, scope.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (scope.authorId !== session.user.id) return { ok: false, error: 'FORBIDDEN' } as const;

  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
  });

  return { ok: true } as const;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm exec vitest run lib/actions/comments.test.ts > /tmp/unit.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/unit.log
```

- [ ] **Step 6: Commit**

```bash
git add lib/actions
git commit -m "feat: add the three comment actions

A viewer may comment; only the author may edit or delete. Membership is
checked before authorship so a non-member cannot learn the comment exists."
```

### Task 10: The thread, and an optimistic comment

**Files:**
- Create: `components/board/card-comments.tsx`
- Modify: `components/board/card-body.tsx`
- Create: `e2e/card-comments.spec.ts`

**Interfaces:**
- Consumes: `addComment` from Task 9; `CardComment` from `lib/cards.ts`.
- Produces: `CardComments({ cardId, comments, canComment, viewerId }: { cardId: string; comments: CardComment[]; canComment: boolean; viewerId: string })`.

`viewerId` is threaded from the session in both server pages and passed down; it is what the author-only controls in Task 11 compare against, and it never grants anything on its own — the actions re-check.

**This section keeps its own status strip**, rather than reporting into `CardBody`'s. A comment that failed to post belongs beside the composer that still holds its text, not at the top of a modal the person may have scrolled away from. The spec says the same.

- [ ] **Step 1: Write the failing test**

Create `e2e/card-comments.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedComment,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a comment appears immediately and survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await page.getByRole('textbox', { name: 'Add a comment' }).fill('This needs a test');
    await page.getByRole('button', { name: 'Comment' }).click();

    await expect(page.getByTestId('comment-body')).toHaveText(['This needs a test']);

    await written(page);
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveText(['This needs a test']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the thread reads oldest first', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId });
  await seedComment(cardId, userId, 'First');
  await seedComment(cardId, userId, 'Second');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByTestId('comment-body')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer can comment', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await page.getByRole('textbox', { name: 'Add a comment' }).fill('Reads fine to me');
    await page.getByRole('button', { name: 'Comment' }).click();
    await written(page);
    await page.reload();

    await expect(page.getByTestId('comment-body')).toHaveText(['Reads fine to me']);
    // ...and still cannot touch the fields.
    await expect(page.getByRole('textbox', { name: 'Card title' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/card-comments.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: EXIT=1 — there is no comment box.

- [ ] **Step 3: Write the thread**

Create `components/board/card-comments.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { addComment } from '@/lib/actions/comments';
import type { CardComment } from '@/lib/cards';

type Row = CardComment & { pending?: boolean };

export function CardComments({
  cardId,
  comments,
  canComment,
  viewerId,
}: {
  cardId: string;
  comments: CardComment[];
  canComment: boolean;
  viewerId: string;
}) {
  const [rows, setRows] = useState<Row[]>(comments);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const submit = () => {
    const body = draft.trim();
    if (!body) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Row = {
      id: tempId,
      body,
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: viewerId, name: null, image: null },
      pending: true,
    };

    setRows((current) => [...current, optimistic]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const result = await addComment({ cardId, body });
      if (result.ok) {
        setRows((current) =>
          current.map((row) =>
            row.id === tempId ? { ...row, id: result.data.id, pending: false } : row,
          ),
        );
      } else {
        setRows((current) => current.filter((row) => row.id !== tempId));
        setDraft(body);
        setError('That comment could not be added. Try again.');
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Comments</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No comments yet</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className={row.pending ? 'opacity-60' : ''}>
              <p className="font-mono text-xs text-muted">
                {row.author?.name ?? 'Deleted account'}
              </p>
              <p data-testid="comment-body" className="whitespace-pre-wrap text-sm text-ink">
                {row.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Add a comment"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />
          <button
            type="button"
            onClick={submit}
            disabled={draft.trim() === ''}
            className="self-start rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-5 text-xs text-time-over">
        {error}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Render it, and thread the viewer id**

In both `app/(app)/(board)/boards/[boardId]/@card/(.)cards/[cardId]/page.tsx` and `app/(app)/(board)/boards/[boardId]/cards/[cardId]/page.tsx`, pass the id already on the session:

```tsx
      <CardBody
        card={card}
        canWrite={atLeast(role, 'member')}
        canComment
        viewerId={session.user.id}
      />
```

In `components/board/card-body.tsx`, accept `viewerId: string` and render the thread at the end of both branches:

```tsx
      <CardComments
        cardId={card.id}
        comments={card.comments}
        canComment={canComment}
        viewerId={viewerId}
      />
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm exec playwright test e2e/card-comments.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/e2e.log
```

- [ ] **Step 6: Commit**

```bash
git add components/board app e2e/card-comments.spec.ts
git commit -m "feat: read and add comments on a card"
```

### Task 11: The author's own comment, edited and deleted

**Files:**
- Modify: `components/board/card-comments.tsx`
- Modify: `e2e/card-comments.spec.ts`

**Interfaces:**
- Consumes: `editComment`, `deleteComment` from Task 9.
- Produces: no new exports; `CardComments` grows the controls.

- [ ] **Step 1: Write the failing test**

Append to `e2e/card-comments.spec.ts`:

```ts
test("the author edits and deletes their own comment", async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId });
  await seedComment(cardId, userId, 'Typo here');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);

    await page.getByRole('button', { name: 'Edit comment' }).click();
    await page.getByRole('textbox', { name: 'Edit comment' }).fill('Fixed now');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await written(page);
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveText(['Fixed now']);

    await page.getByRole('button', { name: 'Delete comment' }).click();
    await written(page);
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test("a member is offered nothing on someone else's comment", async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId });
  await seedComment(cardId, owner.userId, 'Mine');

  await context.clearCookies();
  const other = await seedSession(context);
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByTestId('comment-body')).toHaveText(['Mine']);
    await expect(page.getByRole('button', { name: 'Edit comment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);
  } finally {
    await removeSeededUser(other.userId);
    await removeSeededUser(owner.userId);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/card-comments.spec.ts --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: EXIT=1 — there is no Edit comment button.

- [ ] **Step 3: Add the controls**

In `components/board/card-comments.tsx`, import the two actions and add editing state:

```tsx
import { addComment, deleteComment, editComment } from '@/lib/actions/comments';
```

```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const saveEdit = (row: Row) => {
    const body = editDraft.trim();
    if (!body || body === row.body) {
      setEditingId(null);
      return;
    }
    const previous = row.body;
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, body } : r)));
    setEditingId(null);
    setError(null);

    startTransition(async () => {
      const result = await editComment({ commentId: row.id, body });
      if (!result.ok) {
        setRows((current) => current.map((r) => (r.id === row.id ? { ...r, body: previous } : r)));
        setError('That comment could not be saved. Try again.');
      }
    });
  };

  const remove = (row: Row) => {
    const index = rows.findIndex((r) => r.id === row.id);
    setRows((current) => current.filter((r) => r.id !== row.id));
    setError(null);

    startTransition(async () => {
      const result = await deleteComment({ commentId: row.id });
      if (!result.ok) {
        setRows((current) => [...current.slice(0, index), row, ...current.slice(index)]);
        setError('That comment could not be deleted. Try again.');
      }
    });
  };
```

Inside the list item, offer the controls only to the author of a settled comment. This is presentation, not permission — the actions re-check:

```tsx
              {row.author?.id === viewerId && !row.pending ? (
                editingId === row.id ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <textarea
                      aria-label="Edit comment"
                      rows={3}
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(row)}
                      className="self-start rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Save changes
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-3">
                    <button
                      type="button"
                      aria-label="Edit comment"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditDraft(row.body);
                      }}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label="Delete comment"
                      onClick={() => remove(row)}
                      className="text-xs text-muted hover:text-time-over"
                    >
                      Delete
                    </button>
                  </div>
                )
              ) : null}
```

The copy rule holds: the button that says "Save changes" is the one whose success the strip would describe as changes saved.

- [ ] **Step 4: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "EXIT=$?"
pnpm test > /tmp/unit.log 2>&1; echo "EXIT=$?"
pnpm build > /tmp/build.log 2>&1; echo "EXIT=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/e2e.log
```

- [ ] **Step 5: Commit**

```bash
git add components/board e2e/card-comments.spec.ts
git commit -m "feat: let a comment's author edit and delete it"
```

### Section 5 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec playwright test` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] A `viewer` can add a comment and still cannot edit any card field — both halves checked in a browser.
- [ ] A member sees no Edit or Delete on someone else's comment, **and** calling `editComment` and `deleteComment` directly as that member returns `FORBIDDEN`. The UI hiding a control is not the permission.
- [ ] **A rejected comment rolls back and says so — forced, not hoped for.** Temporarily make `addComment` return `{ ok: false, error: 'INVALID' }`, add a comment, and confirm the row disappears, the draft comes back in the box, and the strip reads "That comment could not be added. Try again." Then revert and confirm `git diff` on `lib/actions/comments.ts` is empty.
- [ ] A comment whose author row is gone renders "Deleted account" and offers no controls to anyone.
- [ ] Screenshots of a thread, both themes, in the PR body.
- [ ] Open the PR. Stop.

---

## Verification — the whole sub-project

Copied from `docs/specs/card-modal.md`. Tick these only against observed output, and close them in the final section's PR or a short `docs/` follow-up, as sub-projects 3 and 4 did.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass locally, each exit code read from its own log.
- [ ] Deleting a card removes its comments; deleting a user does **not**, and leaves them authorless — confirmed in `pg_constraint` and by a real delete, not only in `schema.ts`.
- [ ] A cold load of a card URL renders a page, and a click renders a modal, checked in a real browser and not only in Playwright.
- [ ] Browser-back from the modal leaves the board mounted **with its optimistic state intact** — make a change on the board, open a card, go back, and confirm the change is still there.
- [ ] A rejected comment rolls back and says so, forced.
- [ ] A `viewer` can comment and cannot edit any card field, and the field actions refuse a `viewer` when called directly.
- [ ] A due date set as today still reads as today in a browser set to UTC-8.
- [ ] No hydration warning in the console on a board carrying due dates.
- [ ] `docker compose up --build` still reaches a healthy app container with the new migration applied — confirmed with `\dt` against the container's Postgres, not on `db:migrate`'s success line.
- [ ] Production was migrated by hand when Section 2 landed, before the code that needs the table merged.

## What this plan deliberately does not build

Restated from the spec so it is not rediscovered as a gap mid-implementation:

- **Realtime.** Every action here is a candidate `publish()` call site in sub-project 6 and none of them make one.
- **`@mentions`, markdown, rich text.** A comment is plain text.
- **An invite flow.** Sub-project 7. The author-only rules are tested by seeding a second member directly.
- **Account deletion UI.** `/privacy` says it happens by email; this sub-project only makes the schema able to honour that.
- **A fix for `cards.createdById` cascading from `users`.** Raised in the spec's open decisions, deliberately untouched here.
