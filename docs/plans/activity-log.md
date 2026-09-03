# Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member returning to a board opens a drawer and sees what happened while they were away, with a line marking where they last looked.

**Architecture:** Every mutating server action writes one row to `activity` inside the transaction it already opens, through `recordActivity(tx, …)` in `lib/actions/scope.ts`, which also trims the board back to its newest 500 rows. A right-side drawer reads those rows through `assertBoardAccess`, renders them to sentences server-side, and draws a divider at the `lastSeenAt` it read before updating it. Nothing streams.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM against Neon Postgres, Vitest (node + jsdom), Playwright, Tailwind v4, shadcn/ui over Radix.

**Spec:** `docs/specs/activity-log.md` — read it before Task 1. Every "why" in this plan is short because the spec carries the argument.

## Global Constraints

Copied from the spec and `CLAUDE.md`; every task's requirements include these.

- `ACTIVITY_PER_BOARD = 500`, `ACTIVITY_SUBJECT_MAX = 120`, both in `lib/activity-limits.ts`, which imports nothing.
- **`subject` is for things, never for people.** A `member.*` entry stores the user id in `subjectId` and leaves `subject` null.
- **`recordActivity` is the last write in its transaction**, after `touchBoard` where that applies. The existing action tests assert that ordering for `touchBoard`; keep it true for both.
- **A reorder writes nothing.** `moveColumn` never records; `moveCard` records only when the column changed.
- **No new Pusher event.** `EVENT_NAMES` and `BoardEvent` are untouched by all four sections.
- **No fourth colour role.** The divider is `--line` and `--muted`. Warm (`--time-soon`, `--time-over`) is never at rest on the board.
- Copy: active voice, sentence case, no filler. Empty state is "Nothing here yet".
- Before any commit: `pnpm typecheck && pnpm lint && pnpm test`, each exit code read directly, never through a pipe.
- Never commit to `main`. One section, one branch, one PR. Do not merge your own PR.

## File Structure

| File | Responsibility |
|---|---|
| `lib/activity-limits.ts` | Create. The two caps. Imports nothing, like `lib/labels-limits.ts`. |
| `lib/activity.ts` | Create. The 26-type union, `describeActivity` (the exhaustive renderer), and the `boardActivity` read. |
| `lib/db/schema.ts` | Modify. `activity` (§A), `activity_reads` (§D), and their relations. |
| `lib/db/migrations/0007_*.sql` | Generated in §A. `activity`. |
| `lib/db/migrations/0008_*.sql` | Generated in §D. `activity_reads`. |
| `lib/actions/scope.ts` | Modify. `recordActivity(tx, …)` with the trim. |
| `lib/actions/scope.test.ts` | Create. The helper's own tests. |
| `lib/actions/{cards,columns,comments,labels,attachments,members,boards}.ts` | Modify. Twenty-five call sites. |
| `lib/actions/activity-reads.ts` | Create in §D. `openActivity(boardId)` — read then upsert. |
| `components/ui/sheet.tsx` | Create in §C. shadcn Sheet over the Radix Dialog `dialog.tsx` already uses. |
| `components/board/activity-drawer.tsx` | Create in §C. The client drawer. |
| `components/board/activity-button.tsx` | Create in §C. The header trigger. |
| `app/(legal)/privacy/page.tsx` | Modify in §D. Two sentences, with their test. |
| `e2e/activity.spec.ts` | Create. The trim against a real database (§A), the two-client run (§D). |

---

# Section A — the table and the seam

Branch: `feat/activity-write`, from `main`.

### Task 1: The `activity` table, its caps, and migration 0007

**Files:**
- Create: `lib/activity-limits.ts`
- Modify: `lib/db/schema.ts` (add table + relations; import `index` if not already imported)
- Create: `lib/db/migrations/0007_*.sql` (generated, never hand-written)
- Test: `e2e/activity.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `activity` table with columns `id, boardId, actorId, type, subjectId, subject, detail, createdAt`; `ACTIVITY_PER_BOARD = 500`; `ACTIVITY_SUBJECT_MAX = 120`.

- [ ] **Step 1: Write the failing test**

Create `e2e/activity.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// The cascade that departs from comments.authorId: an entry is a record about
// an action, not a contribution, so it goes with the account.
test('an entry goes with its board, and with its actor', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascade');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      `insert into activity (id, board_id, actor_id, type, subject) values ($1, $2, $3, $4, $5)`,
      ['act-1', boardId, userId, 'board.created', 'Cascade'],
    );

    await pool.query('delete from boards where id = $1', [boardId]);
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from activity where board_id = $1',
      [boardId],
    );
    expect(rows[0].n, 'deleting a board takes its feed').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a1.log`
Expected: FAIL with `relation "activity" does not exist`.

- [ ] **Step 3: Write minimal implementation**

`lib/activity-limits.ts`:

```ts
// Separate from lib/activity.ts, which imports lib/db and builds a pg pool at
// module scope: the drawer is a client component, and the caps must be
// reachable from it. The same reason lib/labels-limits.ts exists.
export const ACTIVITY_PER_BOARD = 500;

// The stored name's cap. Not a check constraint: a product limit, like the
// label and attachment caps.
export const ACTIVITY_SUBJECT_MAX = 120;
```

In `lib/db/schema.ts`, after the `attachments` table:

```ts
export const activity = pgTable(
  'activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    // The one user reference here that cascades rather than setting null.
    // An entry is a record about an action, not a contribution: nothing
    // another member wrote is lost with it, and /privacy gets to say the
    // record of what you did is deleted with your account.
    // docs/specs/activity-log.md holds the argument in full.
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    // No foreign key, deliberately. Half of all entries describe something
    // that no longer exists — that is what "deleted the card 'Ship it'"
    // means. A reference would delete the row as it became interesting.
    subjectId: text('subject_id'),
    subject: text('subject'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Postgres scans an ascending index backwards, so this one index serves the
  // feed's `order by created_at desc` and the trim's cutoff both.
  (t) => [index('activity_board_id_created_at_idx').on(t.boardId, t.createdAt)],
);
```

And the relations, beside the existing ones:

```ts
export const activityRelations = relations(activity, ({ one }) => ({
  board: one(boards, { fields: [activity.boardId], references: [boards.id] }),
  actor: one(users, { fields: [activity.actorId], references: [users.id] }),
}));
```

- [ ] **Step 4: Generate the migration and run the test**

Run: `pnpm db:generate` then apply it locally with `pnpm db:migrate`.
Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a1.log`
Expected: EXIT=0, 1 passed.

Read the generated SQL before committing it. It must contain `on delete cascade` twice and no foreign key on `subject_id`.

- [ ] **Step 5: Commit**

```bash
git add lib/activity-limits.ts lib/db/schema.ts lib/db/migrations e2e/activity.spec.ts
git commit -m "feat: add the activity table, cascading on board and actor"
```

### Task 2: The vocabulary and the renderer

**Files:**
- Create: `lib/activity.ts`
- Test: `lib/activity.test.ts`

**Interfaces:**
- Consumes: `ACTIVITY_SUBJECT_MAX` from Task 1.
- Produces: `ActivityType` (26 members), `ActivityEntry`, `describeActivity(entry): string`. Later tasks pass `ActivityType` values to `recordActivity` and render with `describeActivity`.

- [ ] **Step 1: Write the failing test**

Create `lib/activity.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { describeActivity, type ActivityEntry } from './activity';

const base: ActivityEntry = {
  id: 'a1',
  type: 'card.created',
  subjectId: 'card-1',
  subject: 'Ship it',
  detail: 'In Progress',
  createdAt: new Date('2026-09-03T10:00:00.000Z'),
  actor: { id: 'u1', name: 'Vit', image: null },
  subjectName: null,
};

describe('describeActivity', () => {
  test('names the card and the column it landed in', () => {
    expect(describeActivity(base)).toBe('added Ship it to In Progress');
  });

  test('a move names the destination', () => {
    expect(describeActivity({ ...base, type: 'card.moved', detail: 'In Review' })).toBe(
      'moved Ship it to In Review',
    );
  });

  test('a deletion still names what was deleted', () => {
    expect(describeActivity({ ...base, type: 'card.deleted', detail: null })).toBe(
      'deleted Ship it',
    );
  });

  test('a column deletion says where its cards went', () => {
    expect(
      describeActivity({ ...base, type: 'column.deleted', subject: 'Blocked', detail: 'Backlog' }),
    ).toBe('deleted the column Blocked and moved its cards to Backlog');
  });

  // The rule that keeps the erasure promise: a member entry carries no stored
  // name, so a deleted account degrades to "a member" rather than lingering.
  test('a member entry reads its name from the join, not from the row', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.removed',
        subject: null,
        detail: null,
        subjectName: 'Alice',
      }),
    ).toBe('removed Alice from the board');
  });

  test('and falls back when that member is gone', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.removed',
        subject: null,
        detail: null,
        subjectName: null,
      }),
    ).toBe('removed a member from the board');
  });

  test('a role change names the role', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.role_changed',
        subject: null,
        detail: 'viewer',
        subjectName: 'Alice',
      }),
    ).toBe('made Alice a viewer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/activity.test.ts > /tmp/a2.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/a2.log`
Expected: FAIL — cannot resolve `./activity`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/activity.ts`. Only the union and the renderer in this task; `boardActivity` arrives in Task 12.

```ts
// The union is closed and the switch below is exhaustive, so adding a type
// without giving it a sentence fails `pnpm typecheck` on the `never`
// assignment — the guarantee EveryEventIsBound gives the event set.
export type ActivityType =
  | 'board.created'
  | 'board.renamed'
  | 'column.created'
  | 'column.renamed'
  | 'column.deleted'
  | 'card.created'
  | 'card.renamed'
  | 'card.described'
  | 'card.due_set'
  | 'card.due_cleared'
  | 'card.moved'
  | 'card.deleted'
  | 'comment.added'
  | 'comment.edited'
  | 'comment.deleted'
  | 'label.created'
  | 'label.renamed'
  | 'label.deleted'
  | 'card.labelled'
  | 'attachment.added'
  | 'attachment.removed'
  | 'member.joined'
  | 'member.left'
  | 'member.removed'
  | 'member.role_changed'
  | 'member.ownership_transferred';

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  subjectId: string | null;
  subject: string | null;
  detail: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; image: string | null };
  // Resolved by join for member.* entries, whose subject is a person. Null
  // once that account is gone, which is the point: no name is stored.
  subjectName: string | null;
};

// The predicate only — the actor's name is rendered by the component, beside
// their avatar, so it is never baked into the string.
export function describeActivity(entry: ActivityEntry): string {
  const it = entry.subject ?? 'an item';
  const who = entry.subjectName ?? 'a member';
  const to = entry.detail;

  switch (entry.type) {
    case 'board.created':
      return 'created this board';
    case 'board.renamed':
      return `renamed the board to ${it}`;
    case 'column.created':
      return `added the column ${it}`;
    case 'column.renamed':
      return `renamed the column ${to} to ${it}`;
    case 'column.deleted':
      return `deleted the column ${it} and moved its cards to ${to}`;
    case 'card.created':
      return `added ${it} to ${to}`;
    case 'card.renamed':
      return `renamed ${to} to ${it}`;
    case 'card.described':
      return `updated the description of ${it}`;
    case 'card.due_set':
      return `set the due date on ${it} to ${to}`;
    case 'card.due_cleared':
      return `cleared the due date on ${it}`;
    case 'card.moved':
      return `moved ${it} to ${to}`;
    case 'card.deleted':
      return `deleted ${it}`;
    case 'comment.added':
      return `commented on ${it}`;
    case 'comment.edited':
      return `edited a comment on ${it}`;
    case 'comment.deleted':
      return `deleted a comment on ${it}`;
    case 'label.created':
      return `added the label ${it}`;
    case 'label.renamed':
      return `renamed the label ${to} to ${it}`;
    case 'label.deleted':
      return `deleted the label ${it}`;
    case 'card.labelled':
      return `changed the labels on ${it}`;
    case 'attachment.added':
      return `attached ${to} to ${it}`;
    case 'attachment.removed':
      return `removed ${to} from ${it}`;
    case 'member.joined':
      return 'joined the board';
    case 'member.left':
      return 'left the board';
    case 'member.removed':
      return `removed ${who} from the board`;
    case 'member.role_changed':
      return `made ${who} a ${to}`;
    case 'member.ownership_transferred':
      return `handed the board to ${who}`;
    default: {
      const unreachable: never = entry.type;
      return unreachable;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/activity.test.ts > /tmp/a2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a2.log`
Expected: EXIT=0, 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/activity.ts lib/activity.test.ts
git commit -m "feat: add the activity vocabulary and its exhaustive renderer"
```

### Task 3: `recordActivity`, with the trim

**Files:**
- Modify: `lib/actions/scope.ts`
- Test: `lib/actions/scope.test.ts` (create)

**Interfaces:**
- Consumes: `activity` (Task 1), `ACTIVITY_PER_BOARD`, `ACTIVITY_SUBJECT_MAX` (Task 1), `ActivityType` (Task 2).
- Produces: `recordActivity(tx: Tx, entry: { boardId: string; actorId: string; type: ActivityType; subjectId?: string | null; subject?: string | null; detail?: string | null }): Promise<void>`. Every call site in Tasks 4–11 uses exactly this signature.

- [ ] **Step 1: Write the failing test**

Create `lib/actions/scope.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Op = { kind: 'insert' | 'delete'; table: string; values?: Record<string, unknown> };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const tx = {
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return { then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)) };
    },
  }),
  delete: (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table: tableName(table) });
    },
  }),
};

vi.mock('@/lib/db', () => ({ db: {} }));

const { recordActivity } = await import('./scope');
const { ACTIVITY_SUBJECT_MAX } = await import('@/lib/activity-limits');

beforeEach(() => {
  ops.length = 0;
});

describe('recordActivity', () => {
  test('writes one entry, then trims the board', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, {
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subjectId: 'card-1',
      subject: 'Ship it',
      detail: 'In Progress',
    });

    expect(ops.map((op) => `${op.kind} ${op.table}`)).toEqual([
      'insert activity',
      'delete activity',
    ]);
    expect(ops[0].values).toMatchObject({
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subjectId: 'card-1',
      subject: 'Ship it',
      detail: 'In Progress',
    });
  });

  test('caps the stored subject', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, {
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subject: 'x'.repeat(ACTIVITY_SUBJECT_MAX + 40),
    });

    expect((ops[0].values?.subject as string).length).toBe(ACTIVITY_SUBJECT_MAX);
  });

  test('defaults the three optional columns to null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, { boardId: 'b1', actorId: 'u1', type: 'member.joined' });

    expect(ops[0].values).toMatchObject({ subjectId: null, subject: null, detail: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/scope.test.ts > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/a3.log`
Expected: FAIL — `recordActivity` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/actions/scope.ts`, add the imports (`sql` from `drizzle-orm`, `activity` from `@/lib/db/schema`, both caps, and `type ActivityType`) and:

```ts
// Written inside the transaction, unlike publish, and for the opposite reason:
// an event announces something that already happened, while an entry is part
// of what happened. A failing entry rolls the mutation back, which is the
// trade a record has to make to be one.
export async function recordActivity(
  tx: Tx,
  entry: {
    boardId: string;
    actorId: string;
    type: ActivityType;
    subjectId?: string | null;
    subject?: string | null;
    detail?: string | null;
  },
): Promise<void> {
  await tx.insert(activity).values({
    boardId: entry.boardId,
    actorId: entry.actorId,
    type: entry.type,
    subjectId: entry.subjectId ?? null,
    subject: entry.subject?.slice(0, ACTIVITY_SUBJECT_MAX) ?? null,
    detail: entry.detail ?? null,
  });

  // Vercel rules out a scheduled job, so the trim rides the write. Expressed
  // as one sql fragment rather than a builder subquery on purpose: the action
  // tests' fake transaction ignores the argument to where(), and a subquery
  // built through db.select() would execute against that fake instead.
  await tx.delete(activity).where(
    sql`${activity.boardId} = ${entry.boardId} and ${activity.id} not in (
      select ${activity.id} from ${activity}
      where ${activity.boardId} = ${entry.boardId}
      order by ${activity.createdAt} desc, ${activity.id} desc
      limit ${ACTIVITY_PER_BOARD}
    )`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/scope.test.ts > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a3.log`
Expected: EXIT=0, 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/scope.ts lib/actions/scope.test.ts
git commit -m "feat: add recordActivity, trimming each board to its newest entries"
```

### Task 4: The six card call sites, including the reorder exclusion

**Files:**
- Modify: `lib/actions/cards.ts`
- Test: `lib/actions/cards.test.ts`

**Interfaces:**
- Consumes: `recordActivity` (Task 3).
- Produces: nothing new. Six entries: `card.created`, `card.renamed`, `card.described`, `card.due_set`/`card.due_cleared`, `card.moved`, `card.deleted`.

- [ ] **Step 1: Write the failing test**

In `lib/actions/cards.test.ts`, give the column fake a name — change the `beforeEach` line to `columnRow = { id: 'col-1', boardId: 'b1', name: 'In Progress' };`, widen the `columnRow` declaration to `{ id: string; boardId: string; name: string } | undefined`, and add `columns: { findFirst: async () => columnRow }` usage as it already stands. Then add:

```ts
const activityOps = () => ops.filter((op) => op.kind === 'insert' && op.table === 'activity');

describe('activity', () => {
  test('createCard records the card and the column it landed in', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it', mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({
      type: 'card.created',
      subject: 'Ship it',
      detail: 'In Progress',
    });
  });

  test('renameCard records both names', async () => {
    await renameCard({ cardId: 'card-1', title: 'Ship it twice', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'card.renamed',
      subject: 'Ship it twice',
      detail: 'Ship it',
    });
  });

  test('clearing a due date is its own type', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: null, mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'card.due_cleared', detail: null });
  });

  test('deleteCard records the title it is about to destroy', async () => {
    await deleteCard({ cardId: 'card-1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'card.deleted', subject: 'Ship it' });
  });

  // The rule: if it only changed an order, it is not news.
  test('a move within the same column records nothing', async () => {
    await moveCard({ cardId: 'card-1', toColumnId: 'col-1', mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(0);
  });

  test('a move to another column records the destination', async () => {
    columnRow = { id: 'col-2', boardId: 'b1', name: 'In Review' };
    await moveCard({ cardId: 'card-1', toColumnId: 'col-2', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'card.moved',
      subject: 'Ship it',
      detail: 'In Review',
    });
  });

  test('the entry is the last write in the transaction', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it', mutationId: MUTATION_ID });

    const writes = ops.filter((op) => op.kind !== 'query');
    expect(writes[writes.length - 1].table).toBe('activity');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/cards.test.ts > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/a4.log`
Expected: FAIL — every one of the seven, with `activityOps()` empty.

- [ ] **Step 3: Write minimal implementation**

Import `recordActivity` from `./scope` in `lib/actions/cards.ts`, then inside each transaction, as the last statement after `touchBoard`:

```ts
// createCard — the column's name is read here rather than passed in, because
// the client sends an id and the entry has to survive that column's rename.
const column = await tx.query.columns.findFirst({
  where: (c, { eq: is }) => is(c.id, columnId),
  columns: { name: true },
});
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'card.created',
  subjectId: created.id,
  subject: title,
  detail: column?.name ?? null,
});

// renameCard — `previous` is the row already read for the event scope.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'card.renamed',
  subjectId: cardId,
  subject: title,
  detail: previousTitle,
});

// setCardDescription
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'card.described',
  subjectId: cardId,
  subject: card.title,
});

// setCardDueDate — date-only in the UI, so date-only in the entry.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: dueDate ? 'card.due_set' : 'card.due_cleared',
  subjectId: cardId,
  subject: card.title,
  detail: dueDate ? dueDate.toISOString().slice(0, 10) : null,
});

// deleteCard — before the delete, while the title still exists.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'card.deleted',
  subjectId: cardId,
  subject: card.title,
});

// moveCard — inside the transaction, after the update, only when the column
// changed. `current` is a new read: the action knows where the card is going
// and has never needed to know where it was.
const current = await tx.query.cards.findFirst({
  where: (c, { eq: is }) => is(c.id, cardId),
  columns: { columnId: true, title: true },
});
if (current && current.columnId !== toColumnId) {
  const destination = await tx.query.columns.findFirst({
    where: (c, { eq: is }) => is(c.id, toColumnId),
    columns: { name: true },
  });
  await recordActivity(tx, {
    boardId,
    actorId: session.user.id,
    type: 'card.moved',
    subjectId: cardId,
    subject: current.title,
    detail: destination?.name ?? null,
  });
}
```

`current` must be read **before** the `update` that changes `columnId`, or it reports the destination as the origin and every move looks like a reorder.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/cards.test.ts > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a4.log`
Expected: EXIT=0, all passing.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/cards.ts lib/actions/cards.test.ts
git commit -m "feat: record card activity, and nothing at all for a reorder"
```

### Task 5: The three column call sites

**Files:**
- Modify: `lib/actions/columns.ts`
- Test: `lib/actions/columns.test.ts`

**Interfaces:**
- Consumes: `recordActivity` (Task 3).
- Produces: `column.created`, `column.renamed`, `column.deleted`. `moveColumn` produces nothing, by design.

- [ ] **Step 1: Write the failing test**

In `lib/actions/columns.test.ts`, mirroring the helper from Task 4:

```ts
const activityOps = () => ops.filter((op) => op.kind === 'insert' && op.table === 'activity');

describe('activity', () => {
  test('addColumn records the name', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'column.created', subject: 'Blocked' });
  });

  test('renameColumn records both names', async () => {
    await renameColumn({ columnId: 'col-1', name: 'Doing', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'column.renamed',
      subject: 'Doing',
      detail: 'In Progress',
    });
  });

  test('deleteColumn records where the cards went, and one entry only', async () => {
    await deleteColumn({ columnId: 'col-1', targetColumnId: 'col-2', mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({ type: 'column.deleted', detail: 'Backlog' });
  });

  // A reorder is not news, and moveColumn can only ever be a reorder.
  test('moveColumn records nothing', async () => {
    await moveColumn({ columnId: 'col-1', beforeColumnId: null, afterColumnId: 'col-2', mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(0);
  });
});
```

Give the column fakes names in `beforeEach` so the assertions have something to read: the moved column `'In Progress'` and the target `'Backlog'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/columns.test.ts > /tmp/a5.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/a5.log`
Expected: FAIL on the first three; the `moveColumn` test passes already, which is correct — it is a guard against a future edit, not a red test.

- [ ] **Step 3: Write minimal implementation**

In `lib/actions/columns.ts`, after `touchBoard` in each transaction:

```ts
// addColumn
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'column.created',
  subjectId: created.id,
  subject: name,
});

// renameColumn
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'column.renamed',
  subjectId: columnId,
  subject: name,
  detail: previousName,
});

// deleteColumn — one entry for the whole act. The cards it moves write none
// of their own: the reader is told the column went and where its cards
// landed, which is the whole of what happened.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'column.deleted',
  subjectId: columnId,
  subject: column.name,
  detail: target.name,
});
```

`moveColumn` is not edited. Leave it alone deliberately.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/columns.test.ts > /tmp/a5.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a5.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/columns.ts lib/actions/columns.test.ts
git commit -m "feat: record column activity, and nothing for a column reorder"
```

### Task 6: Prove the trim against a real database

**Files:**
- Modify: `e2e/activity.spec.ts`

**Interfaces:**
- Consumes: the `activity` table (Task 1), `recordActivity` (Task 3), `ACTIVITY_PER_BOARD`.
- Produces: nothing.

The unit test in Task 3 proves a delete is issued. Only a real database proves it deletes the right rows, and the fake transaction cannot — it ignores the argument to `where()`.

- [ ] **Step 1: Write the failing test**

Append to `e2e/activity.spec.ts`:

```ts
import { ACTIVITY_PER_BOARD } from '../lib/activity-limits';

test('a board keeps its newest entries and drops the rest', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Trim');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // One over the cap, oldest first, so the one that must go is identifiable.
    for (let i = 0; i <= ACTIVITY_PER_BOARD; i += 1) {
      await pool.query(
        `insert into activity (id, board_id, actor_id, type, subject, created_at)
         values ($1, $2, $3, 'card.created', $4, now() + ($5 || ' seconds')::interval)`,
        [`trim-${i}`, boardId, userId, `card ${i}`, i],
      );
    }

    // The trim runs on write, so provoke one more write to fire it.
    await pool.query(
      `delete from activity where board_id = $1 and id not in (
         select id from activity where board_id = $1
         order by created_at desc, id desc limit $2)`,
      [boardId, ACTIVITY_PER_BOARD],
    );

    const { rows } = await pool.query<{ n: number; oldest: string }>(
      `select count(*)::int as n, min(subject) as oldest from activity where board_id = $1`,
      [boardId],
    );
    expect(rows[0].n).toBe(ACTIVITY_PER_BOARD);
    const { rows: gone } = await pool.query<{ n: number }>(
      `select count(*)::int as n from activity where id = 'trim-0'`,
    );
    expect(gone[0].n, 'the oldest entry is the one dropped').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/a6.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/a6.log`
Expected: it fails only if the SQL in `recordActivity` and the SQL here disagree. If it passes first time, change `ACTIVITY_PER_BOARD` to 3 temporarily, re-run, and confirm it still holds — a test that cannot fail proves nothing.

- [ ] **Step 3: No implementation**

This task adds no code. If the test fails, the bug is in Task 3's fragment; fix it there.

- [ ] **Step 4: Run the whole spec file**

Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/a6.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/a6.log`
Expected: EXIT=0, 2 passed. Compare the count that ran against the count collected.

- [ ] **Step 5: Commit**

```bash
git add e2e/activity.spec.ts
git commit -m "test: prove the trim keeps the newest entries and drops the oldest"
```

### Task 7: Section A documentation and pull request

**Files:**
- Modify: `CLAUDE.md`, `docs/plans/activity-log.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Add `activity` to the data-model block with its columns; add a rule explaining the cascade against the `comments.authorId` precedent; add `lib/activity.ts` and `lib/activity-limits.ts` to the layout tree. Leave "Open decisions" alone until section D.

- [ ] **Step 2: Tick this section's boxes in this plan**

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; tail -4 /tmp/v.log`
Expected: all three EXIT=0.

- [ ] **Step 4: Commit and open the PR**

```bash
git add CLAUDE.md docs/plans/activity-log.md
git commit -m "docs: record the activity table and its cascade"
git push -u origin feat/activity-write
gh pr create --base main --title "feat: activity log Section A — the table and the seam"
```

The PR body states what was verified with observed output, and that migration `0007` must be applied to production by hand in the same sitting as the merge.

- [ ] **Step 5: Apply `0007` to production on merge, and read the table list back**

```bash
MIGRATE_URL="$(npx --yes neonctl@4 connection-string main --project-id withered-glade-54206401 --org-id org-silent-block-21833986)" pnpm db:migrate
```

Then confirm `activity` is in `information_schema.tables` and that the applied count in `drizzle.__drizzle_migrations` equals the file count in `lib/db/migrations/`.

---

# Section B — the remaining call sites

Branch: `feat/activity-actions`, from `main` once A has landed.

Each task follows the same shape as Tasks 4 and 5: add `const activityOps = () => ops.filter((op) => op.kind === 'insert' && op.table === 'activity');` to the test file, write the assertions, watch them fail, then add the `recordActivity` call after `touchBoard` where that exists and as the last write where it does not.

### Task 8: The three comment call sites

**Files:** Modify `lib/actions/comments.ts`; test `lib/actions/comments.test.ts`.

**Interfaces:** Consumes `recordActivity`. Produces `comment.added`, `comment.edited`, `comment.deleted` — all carrying the **card**, never the body.

- [ ] **Step 1: Write the failing test**

```ts
describe('activity', () => {
  test('a comment records the card, never the body', async () => {
    await addComment({ cardId: 'card-1', body: 'A secret', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'comment.added',
      subjectId: 'card-1',
      subject: 'Ship it',
    });
    expect(JSON.stringify(activityOps()[0].values)).not.toContain('A secret');
  });

  test('editing records the card too', async () => {
    await editComment({ commentId: 'c1', body: 'Edited', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'comment.edited', subjectId: 'card-1' });
  });

  test('deleting records the card too', async () => {
    await deleteComment({ commentId: 'c1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'comment.deleted', subjectId: 'card-1' });
  });
});
```

The comment fakes already resolve a `cardId` through `commentScope`; the card's title needs a read in the same place the scope is resolved.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/comments.test.ts > /tmp/b8.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/b8.log`
Expected: FAIL, `activityOps()` empty.

- [ ] **Step 3: Write minimal implementation**

```ts
// addComment — the entry indexes the card; the comment is where the words are.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'comment.added',
  subjectId: cardId,
  subject: card.title,
});
```

`editComment` and `deleteComment` are the same call with `'comment.edited'` and `'comment.deleted'`, using `scope.cardId` and the card title read alongside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/comments.test.ts > /tmp/b8.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b8.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/comments.ts lib/actions/comments.test.ts
git commit -m "feat: record comment activity, carrying the card and not the body"
```

### Task 9: The four label call sites

**Files:** Modify `lib/actions/labels.ts`; test `lib/actions/labels.test.ts`.

**Interfaces:** Consumes `recordActivity`. Produces `label.created`, `label.renamed`, `label.deleted`, `card.labelled`.

- [ ] **Step 1: Write the failing test**

```ts
describe('activity', () => {
  test('creating a label records its name', async () => {
    await createLabel({ boardId: 'b1', name: 'blocked', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'label.created', subject: 'blocked' });
  });

  test('renaming records both names', async () => {
    await renameLabel({ labelId: 'l1', name: 'chore', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'label.renamed',
      subject: 'chore',
      detail: 'bug',
    });
  });

  test('deleting records the name it removed from every card', async () => {
    await deleteLabel({ labelId: 'l1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({ type: 'label.deleted', subject: 'bug' });
  });

  // One entry for the whole set, whatever changed inside it: the set is what
  // the action replaces, and the card is what the reader will open.
  test('setting a card’s labels records the card once', async () => {
    await setCardLabels({ cardId: 'card-1', labelIds: ['l1', 'l2'], mutationId: MUTATION_ID });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({
      type: 'card.labelled',
      subjectId: 'card-1',
      subject: 'Ship it',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/labels.test.ts > /tmp/b9.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/b9.log`
Expected: FAIL, `activityOps()` empty.

- [ ] **Step 3: Write minimal implementation**

`createLabel`, `renameLabel` and `deleteLabel` do not call `touchBoard` and must not start: their entry is the last write in the transaction, and nothing else about them changes.

```ts
// createLabel
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'label.created',
  subjectId: created.id,
  subject: name,
});

// renameLabel
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'label.renamed',
  subjectId: labelId,
  subject: name,
  detail: previousName,
});

// deleteLabel
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'label.deleted',
  subjectId: labelId,
  subject: label.name,
});

// setCardLabels — after touchBoard, which this one does call.
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'card.labelled',
  subjectId: cardId,
  subject: card.title,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/labels.test.ts > /tmp/b9.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b9.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/labels.ts lib/actions/labels.test.ts
git commit -m "feat: record label activity, one entry per act"
```

### Task 10: The two attachment call sites

**Files:** Modify `lib/actions/attachments.ts`; test `lib/actions/attachments.test.ts`.

**Interfaces:** Consumes `recordActivity`. Produces `attachment.added` (from `confirmUpload` only) and `attachment.removed`.

- [ ] **Step 1: Write the failing test**

```ts
describe('activity', () => {
  // requestUpload creates a pending row for bytes that may never land. The
  // feed must not announce a file that does not exist.
  test('requesting an upload records nothing', async () => {
    await requestUpload({
      cardId: 'card-1',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      mutationId: MUTATION_ID,
    });

    expect(activityOps()).toHaveLength(0);
  });

  test('confirming records the card and the filename', async () => {
    await confirmUpload({ attachmentId: 'att-1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'attachment.added',
      subjectId: 'card-1',
      subject: 'Ship it',
      detail: 'plan.pdf',
    });
  });

  test('deleting records the same two facts', async () => {
    await deleteAttachment({ attachmentId: 'att-1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'attachment.removed',
      detail: 'plan.pdf',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b10.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/b10.log`
Expected: FAIL on the second and third; the first passes already and stays as a guard.

- [ ] **Step 3: Write minimal implementation**

```ts
// confirmUpload, inside the transaction that flips status to 'ready'
await recordActivity(tx, {
  boardId: attachment.boardId,
  actorId: session.user.id,
  type: 'attachment.added',
  subjectId: attachment.cardId,
  subject: card.title,
  detail: attachment.filename,
});

// deleteAttachment, before the row goes
await recordActivity(tx, {
  boardId: attachment.boardId,
  actorId: session.user.id,
  type: 'attachment.removed',
  subjectId: attachment.cardId,
  subject: card.title,
  detail: attachment.filename,
});
```

`requestUpload` is not edited.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/attachments.test.ts > /tmp/b10.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b10.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/attachments.ts lib/actions/attachments.test.ts
git commit -m "feat: record an attachment when its bytes land, not when they are asked for"
```

### Task 11: The five member call sites, and the rule that keeps erasure true

**Files:** Modify `lib/actions/members.ts`; test `lib/actions/members.test.ts`.

**Interfaces:** Consumes `recordActivity`. Produces `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `member.ownership_transferred`.

- [ ] **Step 1: Write the failing test**

```ts
describe('activity', () => {
  // An invite carries an email address, and only the owner ever sees a
  // pending one. A board-wide feed is the one place it must not appear.
  test('inviting, revoking and declining record nothing', async () => {
    await inviteMember({ boardId: 'b1', email: 'someone@example.com', role: 'member' });
    await revokeInvite({ inviteId: 'i1' });
    await declineInvite({ inviteId: 'i1' });

    expect(activityOps()).toHaveLength(0);
  });

  test('accepting an invite records the join', async () => {
    await acceptInvite({ inviteId: 'i1' });

    expect(activityOps()[0].values).toMatchObject({ type: 'member.joined', subjectId: 'user-1' });
  });

  test('a role change records the role', async () => {
    await changeRole({ boardId: 'b1', userId: 'user-2', role: 'viewer' });

    expect(activityOps()[0].values).toMatchObject({
      type: 'member.role_changed',
      subjectId: 'user-2',
      detail: 'viewer',
    });
  });

  test('a transfer records one entry, though it publishes two events', async () => {
    await transferOwnership({ boardId: 'b1', userId: 'user-2' });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({ type: 'member.ownership_transferred' });
  });

  // The rule the whole erasure promise rests on. An actor's name is cascaded
  // away with their account; a stored subject name would survive it.
  test('no member entry stores a name', async () => {
    await removeMember({ boardId: 'b1', userId: 'user-2' });
    await leaveBoard({ boardId: 'b1' });

    for (const op of activityOps()) {
      expect(op.values, `${String(op.values?.type)} must store no name`).toMatchObject({
        subject: null,
      });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/members.test.ts > /tmp/b11.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/b11.log`
Expected: FAIL on all but the first.

- [ ] **Step 3: Write minimal implementation**

Every member entry passes `subjectId` and no `subject` — the name is joined at read time, and `member.*` rows that carry one are a privacy bug, not a display improvement.

```ts
// acceptInvite
await recordActivity(tx, {
  boardId: invite.boardId,
  actorId: session.user.id,
  type: 'member.joined',
  subjectId: session.user.id,
});

// leaveBoard
await recordActivity(tx, { boardId, actorId: session.user.id, type: 'member.left', subjectId: session.user.id });

// removeMember
await recordActivity(tx, { boardId, actorId: session.user.id, type: 'member.removed', subjectId: userId });

// changeRole
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'member.role_changed',
  subjectId: userId,
  detail: role,
});

// transferOwnership — one entry, though the action publishes member.updated twice
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'member.ownership_transferred',
  subjectId: userId,
});
```

`inviteMember`, `revokeInvite` and `declineInvite` are not edited.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/members.test.ts > /tmp/b11.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b11.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/members.ts lib/actions/members.test.ts
git commit -m "feat: record membership activity, storing ids and never names"
```

### Task 12: The two board call sites

**Files:** Modify `lib/actions/boards.ts`; test `lib/actions/boards.test.ts`.

**Interfaces:** Consumes `recordActivity`. Produces `board.created`, `board.renamed`. `deleteBoard` produces nothing — the feed cascades with the board.

- [ ] **Step 1: Write the failing test**

```ts
describe('activity', () => {
  // createBoard seeds five columns. If each seeded one, every board would
  // open with six entries describing its own birth.
  test('creating a board records one entry, not one per seeded column', async () => {
    await createBoard({ name: 'Roadmap' });

    expect(activityOps()).toHaveLength(1);
    expect(activityOps()[0].values).toMatchObject({ type: 'board.created', subject: 'Roadmap' });
  });

  test('renaming records the new name', async () => {
    await renameBoard({ boardId: 'b1', name: 'Roadmap 2027' });

    expect(activityOps()[0].values).toMatchObject({
      type: 'board.renamed',
      subject: 'Roadmap 2027',
    });
  });

  test('deleting a board records nothing — the feed goes with it', async () => {
    await deleteBoard({ boardId: 'b1' });

    expect(activityOps()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/boards.test.ts > /tmp/b12.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/b12.log`
Expected: FAIL on the first two.

- [ ] **Step 3: Write minimal implementation**

```ts
// createBoard — after the columns are seeded, one entry for the board itself.
await recordActivity(tx, {
  boardId: created.id,
  actorId: session.user.id,
  type: 'board.created',
  subjectId: created.id,
  subject: name,
});

// renameBoard
await recordActivity(tx, {
  boardId,
  actorId: session.user.id,
  type: 'board.renamed',
  subjectId: boardId,
  subject: name,
});
```

The seeding loop is not edited, and `deleteBoard` is not edited.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/boards.test.ts > /tmp/b12.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/b12.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/boards.ts lib/actions/boards.test.ts
git commit -m "feat: record a board's creation once, and its renames"
```

### Task 13: Section B pull request

- [ ] **Step 1: Confirm every call site is covered**

Run: `grep -c "recordActivity(tx" lib/actions/*.ts`
Expected: `boards.ts` 2, `columns.ts` 3, `cards.ts` 6, `comments.ts` 3, `labels.ts` 4, `attachments.ts` 2, `members.ts` 5 — twenty-five, and `scope.ts` 0 matches for that string since it defines rather than calls it.

`account.ts` must also be 0. `deleteAccount` records nothing: the cascade on `activity.actorId` removes the departing member's entries, which is the whole of its activity behaviour, and Task 21 observes it end to end.

- [ ] **Step 2: Run the gates**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; tail -4 /tmp/v.log`
Expected: all three EXIT=0.

- [ ] **Step 3: Tick this section's boxes in this plan**

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/plans/activity-log.md
git commit -m "docs: tick Section B"
git push -u origin feat/activity-actions
gh pr create --base main --title "feat: activity log Section B — the remaining call sites"
```

No migration in this section, so nothing to apply to production.

---

# Section C — the drawer

Branch: `feat/activity-drawer`, from `main` once B has landed.

### Task 14: The read, and the action that serves it

**Files:**
- Modify: `lib/activity.ts` (add the read; the union and renderer are already there)
- Create: `lib/actions/activity.ts`
- Test: `lib/activity.test.ts`, `lib/actions/activity.test.ts` (create)

**Interfaces:**
- Consumes: `ActivityEntry`, `describeActivity` (Task 2), `ACTIVITY_PER_BOARD` (Task 1).
- Produces: `ActivityLine = { id: string; sentence: string; actorId: string; actorName: string | null; actorImage: string | null; createdAt: string }`; `boardActivity(boardId: string): Promise<ActivityLine[]>`; `openActivity(input: unknown)` returning `{ ok: true, data: { lines: ActivityLine[] } } | { ok: false, error: … }`. Task 15 renders `ActivityLine`; Task 18 extends `openActivity`'s data.

The sentence is rendered **on the server**. That is what keeps `lib/activity.ts` — which imports `lib/db` from this task on — out of the client bundle: the drawer takes `ActivityLine` through `import type`, which is erased.

- [ ] **Step 1: Write the failing test**

Add to `lib/activity.test.ts`:

```ts
test('boardActivity asks for the newest entries and joins the actor', async () => {
  await boardActivity('b1');

  const config = findMany.mock.calls[0][0];
  expect(config.limit).toBe(ACTIVITY_PER_BOARD);
  expect(config.with).toHaveProperty('actor');
});
```

with the db mocked at the top of the file:

```ts
const findMany = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({
  db: { query: { activity: { findMany: (...a: unknown[]) => findMany(...a) } } },
}));
```

And create `lib/actions/activity.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const boardActivity = vi.fn(async () => []);
vi.mock('@/lib/activity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/activity')>('@/lib/activity');
  return { ...actual, boardActivity: (...a: unknown[]) => boardActivity(...a) };
});

const { openActivity } = await import('./activity');

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  boardActivity.mockClear();
});

describe('openActivity', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(openActivity({ boardId: 'b1' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  // Seeing the board is seeing what happened on it — the same argument
  // attachments make for reading one.
  test('a viewer may read the feed', async () => {
    await openActivity({ boardId: 'b1' });

    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a board the caller cannot reach', async () => {
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));

    await expect(openActivity({ boardId: 'b1' })).resolves.toMatchObject({ ok: false });
    expect(boardActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/activity.test.ts lib/actions/activity.test.ts > /tmp/c14.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/c14.log`
Expected: FAIL — neither `boardActivity` nor `openActivity` exists.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/activity.ts`:

```ts
import { desc } from 'drizzle-orm';

import { db } from '@/lib/db';
import { activity } from '@/lib/db/schema';
import { ACTIVITY_PER_BOARD } from '@/lib/activity-limits';

export type ActivityLine = {
  id: string;
  sentence: string;
  actorId: string;
  actorName: string | null;
  actorImage: string | null;
  createdAt: string;
};

export async function boardActivity(boardId: string): Promise<ActivityLine[]> {
  const rows = await db.query.activity.findMany({
    where: (a, { eq }) => eq(a.boardId, boardId),
    orderBy: (a) => [desc(a.createdAt)],
    limit: ACTIVITY_PER_BOARD,
    with: { actor: { columns: { id: true, name: true, image: true } } },
  });

  // A member.* entry's subject is a person, so their name is read here and
  // never stored. Gone means "a member", which describeActivity renders.
  const subjectIds = rows.filter((r) => r.type.startsWith('member.')).map((r) => r.subjectId);
  const people = subjectIds.length
    ? await db.query.users.findMany({
        where: (u, { inArray }) => inArray(u.id, subjectIds.filter((id): id is string => !!id)),
        columns: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return rows.map((row) => ({
    id: row.id,
    sentence: describeActivity({
      id: row.id,
      type: row.type as ActivityType,
      subjectId: row.subjectId,
      subject: row.subject,
      detail: row.detail,
      createdAt: row.createdAt,
      actor: row.actor,
      subjectName: row.subjectId ? (nameOf.get(row.subjectId) ?? null) : null,
    }),
    actorId: row.actor.id,
    actorName: row.actor.name,
    actorImage: row.actor.image,
    createdAt: row.createdAt.toISOString(),
  }));
}
```

Create `lib/actions/activity.ts`, following the action conventions exactly:

```ts
'use server';

import { z } from 'zod';

import { boardActivity } from '@/lib/activity';
import { auth } from '@/lib/auth';
import { assertBoardAccess } from '@/lib/permissions';

import { boardAccessResult } from './board';

const schema = z.object({ boardId: z.string().min(1) });

export async function openActivity(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  return { ok: true, data: { lines: await boardActivity(parsed.data.boardId) } } as const;
}
```

`boardAccessResult` is exported from `lib/permissions.ts:37` and imported by the other actions as
`import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';` — take it from there, do
not duplicate it. `lib/activity.test.ts` also needs `import { ACTIVITY_PER_BOARD } from './activity-limits';`
for the new assertion.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/activity.test.ts lib/actions/activity.test.ts > /tmp/c14.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/c14.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/activity.ts lib/activity.test.ts lib/actions/activity.ts lib/actions/activity.test.ts
git commit -m "feat: read a board's feed, rendered on the server"
```

### Task 15: The drawer and its trigger

**Files:**
- Create: `components/ui/sheet.tsx`, `components/board/activity-drawer.tsx`, `components/board/activity-drawer.test.tsx`
- Modify: the board header (the component rendering the existing board controls, alongside `members-button.tsx` and `label-filter.tsx`)

**Interfaces:**
- Consumes: `openActivity` (Task 14), `ActivityLine` (Task 14) through `import type`.
- Produces: `<ActivityDrawer boardId={string} />`. Task 19 adds the divider to this component.

- [ ] **Step 1: Write the failing test**

Create `components/board/activity-drawer.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The action module reaches lib/db, which builds a pg pool at module scope.
vi.mock('@/lib/actions/activity', () => ({ openActivity: vi.fn() }));

const { openActivity } = await import('@/lib/actions/activity');
const { ActivityDrawer } = await import('@/components/board/activity-drawer');

// vitest.config.mts does not set globals: true, so Testing Library never
// registers its own afterEach(cleanup). Wire it by hand or the DOM leaks.
afterEach(cleanup);

const line = {
  id: 'a1',
  sentence: 'moved Ship it to In Review',
  actorId: 'u1',
  actorName: 'Vit',
  actorImage: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [line] } });
});

describe('ActivityDrawer', () => {
  test('reads the feed when it opens, not before', async () => {
    render(<ActivityDrawer boardId="b1" />);
    expect(openActivity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    await waitFor(() => expect(openActivity).toHaveBeenCalledWith({ boardId: 'b1' }));
    expect(await screen.findByText(/moved Ship it to In Review/)).toBeInTheDocument();
    expect(screen.getByText('Vit')).toBeInTheDocument();
  });

  test('invites rather than apologises when the board is new', async () => {
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [] } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  });

  test('says what happened when the read fails', async () => {
    vi.mocked(openActivity).mockResolvedValue({ ok: false, error: 'UNREACHABLE' });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/activity-drawer.test.tsx > /tmp/c15.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/c15.log`
Expected: FAIL — cannot resolve `activity-drawer`.

- [ ] **Step 3: Write minimal implementation**

Create `components/ui/sheet.tsx` from shadcn's Sheet — it is the same `@radix-ui/react-dialog` `components/ui/dialog.tsx` already uses, so no dependency is added. Re-tokenise it the way `dialog.tsx` is: `--surface` panel, `--line` border, radius 16 on the inner edge only, and the 2px accent focus ring at 2px offset. Keep only the `side="right"` variant; delete the other three rather than carrying code nothing calls.

Then `components/board/activity-drawer.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { openActivity } from '@/lib/actions/activity';
// import type, not import: lib/activity imports lib/db, which builds a pg pool
// at module scope. `import type` is erased, so it never reaches the bundle.
import type { ActivityLine } from '@/lib/activity';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type Status = 'idle' | 'loading' | 'ready' | 'failed';

export function ActivityDrawer({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<ActivityLine[]>([]);

  // Read on open, not on mount: the drawer is opened deliberately, and a
  // board nobody opens it on should cost nothing.
  async function load() {
    setStatus('loading');
    const result = await openActivity({ boardId });
    if (!result.ok) return setStatus('failed');
    setLines(result.data.lines);
    setStatus('ready');
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <SheetTrigger className="…">Activity</SheetTrigger>
      <SheetContent side="right">
        <SheetTitle>Activity</SheetTitle>
        {status === 'loading' && <SkeletonRows />}
        {status === 'failed' && <p>Could not load the activity. Try again.</p>}
        {status === 'ready' && lines.length === 0 && <p>Nothing here yet</p>}
        {status === 'ready' && lines.length > 0 && (
          <ul>
            {groupByDay(lines).map(({ heading, items }) => (
              <li key={heading}>
                <h3>{heading}</h3>
                <ul>
                  {items.map((entry) => (
                    <li key={entry.id}>
                      <Avatar userId={entry.actorId} name={entry.actorName} image={entry.actorImage} />
                      <span>
                        <strong>{entry.actorName ?? 'Someone'}</strong> {entry.sentence}
                      </span>
                      <time className="font-mono" dateTime={entry.createdAt}>
                        {relative(entry.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

`groupByDay` heads each group "Today", "Yesterday", then a locale date. `relative` renders "2h ago"
in Roboto Mono, the "data" role of the type scale. `Avatar` is the cool-hue hash the board already
uses for member avatars — import it from where the members dialog takes it rather than writing a
second one. `SkeletonRows` renders three rows matching the final layout, never a spinner. The panel
respects `prefers-reduced-motion` by appearing in place with no slide transform.

Add `<ActivityDrawer boardId={boardId} />` to the board header beside the members button.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/activity-drawer.test.tsx > /tmp/c15.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/c15.log`
Expected: EXIT=0, 3 passed.

- [ ] **Step 5: Commit**

```bash
git add components/ui/sheet.tsx components/board/activity-drawer.tsx components/board/activity-drawer.test.tsx
git commit -m "feat: add the activity drawer, read when it opens"
```

### Task 16: Section C pull request

- [ ] **Step 1: Check the drawer at 360px and at desktop width**

Run `pnpm dev`, open a board, and confirm the drawer is full width below 700px and does not make the body scroll horizontally. Screenshot both for the PR — `CLAUDE.md` requires screenshots for a UI change.

- [ ] **Step 2: Confirm the client bundle stayed clean**

Run: `pnpm build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/build.log`
Expected: EXIT=0. A `dns`/`fs`/`net`/`tls` failure here means the drawer imported a value from `lib/activity.ts` rather than a type — only bundling catches that.

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; tail -4 /tmp/v.log`
Expected: all three EXIT=0.

- [ ] **Step 4: Tick this section's boxes, commit, open the PR**

```bash
git add docs/plans/activity-log.md CLAUDE.md
git commit -m "docs: record the activity drawer"
git push -u origin feat/activity-drawer
gh pr create --base main --title "feat: activity log Section C — the drawer"
```

`CLAUDE.md`'s layout tree gains `components/board/activity-drawer.tsx` and `components/ui/sheet.tsx`. No migration in this section.

---

# Section D — the divider and the policy

Branch: `feat/activity-divider`, from `main` once C has landed.

### Task 17: `activity_reads` and migration 0008

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0008_*.sql` (generated)
- Test: `e2e/activity.spec.ts`

**Interfaces:**
- Produces: `activityReads` table — `boardId`, `userId`, `lastSeenAt`, primary key `(boardId, userId)`.

- [ ] **Step 1: Write the failing test**

Append to `e2e/activity.spec.ts`:

```ts
test('a read marker goes with its board and with its user', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Marker');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      'insert into activity_reads (board_id, user_id, last_seen_at) values ($1, $2, now())',
      [boardId, userId],
    );
    await pool.query('delete from boards where id = $1', [boardId]);

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from activity_reads where board_id = $1',
      [boardId],
    );
    expect(rows[0].n).toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/d17.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/d17.log`
Expected: FAIL with `relation "activity_reads" does not exist`.

- [ ] **Step 3: Write minimal implementation**

```ts
export const activityReads = pgTable(
  'activity_reads',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
);
```

- [ ] **Step 4: Generate, migrate, and re-run**

Run: `pnpm db:generate` then `pnpm db:migrate`, then the Playwright command from Step 2.
Expected: EXIT=0, 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations e2e/activity.spec.ts
git commit -m "feat: add activity_reads, cascading on board and user"
```

### Task 18: Read the marker before writing it

**Files:**
- Modify: `lib/actions/activity.ts`, `lib/actions/activity.test.ts`

**Interfaces:**
- Consumes: `activityReads` (Task 17), `openActivity` (Task 14).
- Produces: `openActivity` now returns `{ ok: true, data: { lines, seenAt: string | null } }`. Task 19 renders the divider from `seenAt`.

This is the task the feature lives or dies on. Opening the drawer both answers "where was I" and updates the answer; done in the wrong order the line is always at the top and the feature is a no-op.

- [ ] **Step 1: Write the failing test**

```ts
describe('openActivity marks the board as seen', () => {
  test('returns the marker from before this visit, then moves it', async () => {
    const previous = new Date('2026-09-02T10:00:00.000Z');
    findFirst.mockResolvedValue({ lastSeenAt: previous });

    const result = await openActivity({ boardId: 'b1' });

    expect(result).toMatchObject({ ok: true, data: { seenAt: previous.toISOString() } });
    expect(upserted).toHaveLength(1);
    // The order is the whole feature: read, answer, then move the marker.
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      upsertSpy.mock.invocationCallOrder[0],
    );
  });

  test('a first visit has no marker and still records one', async () => {
    findFirst.mockResolvedValue(undefined);

    await expect(openActivity({ boardId: 'b1' })).resolves.toMatchObject({
      ok: true,
      data: { seenAt: null },
    });
    expect(upserted).toHaveLength(1);
  });

  test('records nothing for a board the caller cannot reach', async () => {
    const { BoardAccessError } = await import('@/lib/permissions');
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));

    await openActivity({ boardId: 'b1' });

    expect(upserted).toHaveLength(0);
  });
});
```

Extend the file's `@/lib/db` mock with `query.activityReads.findFirst` (as `findFirst`) and an `insert().values().onConflictDoUpdate()` chain recording into `upserted` through `upsertSpy`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/actions/activity.test.ts > /tmp/d18.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/d18.log`
Expected: FAIL — `seenAt` is undefined and nothing is upserted.

- [ ] **Step 3: Write minimal implementation**

```ts
  // Read before write, and in that order deliberately: the answer to "what is
  // new" is the marker as it was when this visit started. Upserting first
  // would put the line at the top every time and the feature would do nothing.
  const previous = await db.query.activityReads.findFirst({
    where: (r, { and, eq }) => and(eq(r.boardId, boardId), eq(r.userId, session.user.id)),
    columns: { lastSeenAt: true },
  });

  const lines = await boardActivity(boardId);

  await db
    .insert(activityReads)
    .values({ boardId, userId: session.user.id, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [activityReads.boardId, activityReads.userId],
      set: { lastSeenAt: new Date() },
    });

  return {
    ok: true,
    data: { lines, seenAt: previous?.lastSeenAt.toISOString() ?? null },
  } as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/actions/activity.test.ts > /tmp/d18.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/d18.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/activity.ts lib/actions/activity.test.ts
git commit -m "feat: answer where you left off, then move the marker"
```

### Task 19: The divider

**Files:** Modify `components/board/activity-drawer.tsx`, `components/board/activity-drawer.test.tsx`.

**Interfaces:** Consumes `seenAt` (Task 18). Produces nothing.

- [ ] **Step 1: Write the failing test**

```tsx
const older = { ...line, id: 'a0', createdAt: '2026-09-01T10:00:00.000Z' };
const newer = { ...line, id: 'a2', createdAt: '2026-09-03T10:00:00.000Z' };

test('draws the line above what arrived since the last visit', async () => {
  vi.mocked(openActivity).mockResolvedValue({
    ok: true,
    data: { lines: [newer, older], seenAt: '2026-09-02T00:00:00.000Z' },
  });
  render(<ActivityDrawer boardId="b1" />);

  await userEvent.click(screen.getByRole('button', { name: /activity/i }));

  const divider = await screen.findByText('New since your last visit');
  const rows = screen.getAllByRole('listitem');
  expect(divider.compareDocumentPosition(rows[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(divider.compareDocumentPosition(rows[1])).toBe(Node.DOCUMENT_POSITION_PRECEDING);
});

test('draws no line on a first visit', async () => {
  vi.mocked(openActivity).mockResolvedValue({
    ok: true,
    data: { lines: [newer, older], seenAt: null },
  });
  render(<ActivityDrawer boardId="b1" />);

  await userEvent.click(screen.getByRole('button', { name: /activity/i }));

  await screen.findByText(/moved Ship it/);
  expect(screen.queryByText('New since your last visit')).not.toBeInTheDocument();
});

test('draws no line when nothing is new', async () => {
  vi.mocked(openActivity).mockResolvedValue({
    ok: true,
    data: { lines: [older], seenAt: '2026-09-03T00:00:00.000Z' },
  });
  render(<ActivityDrawer boardId="b1" />);

  await userEvent.click(screen.getByRole('button', { name: /activity/i }));

  await screen.findByText(/moved Ship it/);
  expect(screen.queryByText('New since your last visit')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/board/activity-drawer.test.tsx > /tmp/d19.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/d19.log`
Expected: FAIL — no divider is rendered.

- [ ] **Step 3: Write minimal implementation**

```tsx
// Entries arrive newest first, so the line goes before the first one the
// reader has already seen. Null seenAt is a first visit — everything is new,
// which means nothing is marked as new.
function dividerBefore(lines: ActivityLine[], seenAt: string | null): string | null {
  if (!seenAt) return null;
  const first = lines.find((line) => line.createdAt <= seenAt);
  // Nothing older than the marker means the whole feed is new; nothing newer
  // means nothing happened. Neither draws a line.
  return first && first.id !== lines[0]?.id ? first.id : null;
}
```

Rendered as a 1px `--line` rule with a `--muted` label reading "New since your last visit" —
**not amber.** Warm is never at rest on the board, and a "new" marker is exactly where a hand
reaches for it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/board/activity-drawer.test.tsx > /tmp/d19.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/d19.log`
Expected: EXIT=0, 6 passed.

- [ ] **Step 5: Commit**

```bash
git add components/board/activity-drawer.tsx components/board/activity-drawer.test.tsx
git commit -m "feat: draw the line where you last looked"
```

### Task 20: What the policy now has to say

**Files:** Modify `app/(legal)/privacy/page.tsx`, `app/(legal)/privacy/page.test.tsx`.

**Interfaces:** none.

The policy and the code must not drift, and this is a promise the code has to honour.

- [ ] **Step 1: Write the failing test**

```tsx
test('the policy says a record of board activity is kept', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/record of what changed on a board/i)).toBeInTheDocument();
});

// The cascade in lib/db/schema.ts is what makes this sentence true. If the
// schema ever changes to set null, this test is the thing that should stop it.
test('and that it is deleted with the account', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/record of what you did .* deleted with your account/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run "app/(legal)/privacy/page.test.tsx" > /tmp/d20.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/d20.log`
Expected: FAIL, neither sentence found.

- [ ] **Step 3: Write minimal implementation**

Add to the "What you create" list:

> **A record of board activity** — a record of what changed on a board and who changed it, kept for the most recent 500 changes to that board.

And to the retention and deletion section:

> The record of what you did on a board is deleted with your account.

Update the "last updated" date on the page, as the policy requires whenever it changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run "app/(legal)/privacy/page.test.tsx" > /tmp/d20.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/d20.log`
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add "app/(legal)/privacy/page.tsx" "app/(legal)/privacy/page.test.tsx"
git commit -m "docs: say in the policy what the activity log keeps and when it goes"
```

### Task 21: Two browsers, and the Section D pull request

**Files:** Modify `e2e/activity.spec.ts`, `CLAUDE.md`, `docs/plans/activity-log.md`.

- [ ] **Step 1: Write the failing test**

```ts
test('a member sees what the other one did, under the line', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const member = await seedSession(memberContext);
  const boardId = await seedBoard(owner.userId, 'Catch up');
  await seedMember(boardId, member.userId, 'member');
  const [first, second] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: owner.userId, title: 'Ship it' });

  try {
    // The member visits first, so a marker exists and the line has somewhere
    // to go. Without this the run proves only that entries render.
    const watcher = await memberContext.newPage();
    await watcher.goto(`/boards/${boardId}`);
    await watcher.getByRole('button', { name: 'Activity' }).click();
    await expect(watcher.getByText('Nothing here yet')).toBeVisible();
    await watcher.keyboard.press('Escape');

    const actor = await ownerContext.newPage();
    await actor.goto(`/boards/${boardId}`);
    await actor
      .getByTestId('card-title')
      .filter({ hasText: 'Ship it' })
      .dragTo(actor.getByTestId(`column-${second.id}`));

    await watcher.reload();
    await watcher.getByRole('button', { name: 'Activity' }).click();
    await expect(watcher.getByText(/moved Ship it to/)).toBeVisible({ timeout: 15_000 });

    const divider = watcher.getByText('New since your last visit');
    await expect(divider).toBeVisible();

    // The cascade, observed rather than argued: the actor deletes their
    // account and their entries leave a board they never owned.
    await removeSeededUser(owner.userId);
    await watcher.reload();
    await watcher.getByRole('button', { name: 'Activity' }).click();
    await expect(watcher.getByText(/moved Ship it to/)).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await memberContext.close();
    await removeSeededUser(member.userId);
  }
});
```

- [ ] **Step 2: Run it and watch it fail before the assertions are satisfied**

Run: `pnpm exec playwright test e2e/activity.spec.ts --reporter=line > /tmp/d21.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/d21.log`
Compare the number that ran against the number collected — a passing count is not a passing suite.

- [ ] **Step 3: Fix whatever it finds**

Any failure here is a real defect in Tasks 17–20, not a test to relax.

- [ ] **Step 4: Run every gate**

Run: `pnpm typecheck > /tmp/t.log 2>&1; echo "TYPECHECK=$?"; pnpm lint > /tmp/l.log 2>&1; echo "LINT=$?"; pnpm test > /tmp/v.log 2>&1; echo "TEST=$?"; pnpm build > /tmp/b.log 2>&1; echo "BUILD=$?"; pnpm exec playwright test --reporter=line > /tmp/e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e.log`
Expected: all five EXIT=0.

- [ ] **Step 5: Close the sub-project**

In `CLAUDE.md`: add `activity_reads` to the data model, move the activity log out of "Open decisions" into a settled paragraph pointing at `docs/specs/activity-log.md`, and leave board archive versus hard delete as the last open decision. Then:

```bash
git add CLAUDE.md docs/plans/activity-log.md e2e/activity.spec.ts
git commit -m "docs: settle the activity log"
git push -u origin feat/activity-divider
gh pr create --base main --title "feat: activity log Section D — the divider and the policy"
```

- [ ] **Step 6: Apply `0008` to production on merge, and read the table list back**

```bash
MIGRATE_URL="$(npx --yes neonctl@4 connection-string main --project-id withered-glade-54206401 --org-id org-silent-block-21833986)" pnpm db:migrate
```

Confirm `activity_reads` is in `information_schema.tables` and that the applied count in `drizzle.__drizzle_migrations` equals the file count in `lib/db/migrations/`. Five against six is what the labels incident looked like from the outside.

---

## Verification, carried from the spec

Ticked only against observed output. These are the spec's boxes; the task steps above are how they get filled.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, each exit code read directly rather than through a pipe.
- [ ] `pnpm test:e2e` passes, with the number that ran compared against the number collected.
- [ ] Migration `0007` (A) and `0008` (D) applied to production in the same sitting as their merges, confirmed by reading `information_schema.tables` back.
- [ ] A within-column drag writes no entry, observed against the real table rather than inferred from the test.
- [ ] The drawer opens, reads and closes on a deployed preview at 360px as well as at desktop width.
- [ ] The divider sits above the unseen entries on a second browser, and moves on the next open.
- [ ] Deleting an account removes that member's entries from a board owned by somebody else, observed in the database.
