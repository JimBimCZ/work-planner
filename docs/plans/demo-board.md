# Demo Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/` a real board a signed-out visitor can read and drag cards on, rendered from a
fixture in the repository, where nothing they do is written anywhere.

**Architecture:** A new `app/(demo)/` route group serves `/`. A signed-in visitor is redirected to
`/boards`; a signed-out one gets `BoardCanvas` fed by `lib/demo-board.ts` — the same component the
real board uses, given a `demo` flag that makes its one mutation funnel dispatch to the reducer and
return before calling a server action. No board row, no `assertBoardAccess` exception, no Pusher
connection, no anonymous write path.

**Tech Stack:** Next.js 16 App Router, React Server Components, TypeScript strict, Tailwind v4,
`@dnd-kit`, Vitest (`jsdom` per-file pragma), Playwright.

**Spec:** `docs/specs/demo-board.md` — read it before Task 1. Every "why" lives there; this plan
carries the "how".

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include these.

- **No anonymous write reaches the server.** No server action, route handler or `db` query is
  called on a visitor's behalf. Not "rejected" — never called.
- **`lib/permissions.ts` is not modified, and not imported by anything added here.** It imports
  `lib/db`, which opens a `pg` pool at module scope; a value import from a `'use client'` file
  passes typecheck, lint and test, and only `pnpm build` catches it.
- **`lib/demo-board.ts` imports nothing that reaches the database.** `BoardWithCards` comes from
  `lib/boards.ts` via `import type`, which is erased. A value import from that module is a build
  failure.
- **No schema change, no migration, no seed script, no board row, no env var.**
- **No new colour token, no new hue, no new gradient.** The accent (`--flow-mid`) is spent once,
  on the `Sign in` button.
- Copy is active voice, sentence case, no filler.
- Before any push: `pnpm typecheck && pnpm lint && pnpm test`, each exit code read directly, never
  through a pipe. `pnpm build` too, for every task that adds a client import.
- One section, one branch, one PR. Branch from `main`, never stack. Tick this plan's checkboxes in
  the same PR that does the work.
- Do not merge your own PR. Open it and stop.

## File Structure

| File | Responsibility | Section |
|---|---|---|
| `lib/demo-board.ts` | The fixture. Column, card, label and comment content; offsets resolved against `now`. Imports nothing that reaches the database. | A (board), C (card detail) |
| `lib/demo-board.test.ts` | Ordering, offsets, label integrity, and the year-later assertion that fails on a hardcoded date. | A, C |
| `app/(demo)/layout.tsx` | Fixed-viewport shell, no footer: providers and the top bar. | A |
| `app/(demo)/page.tsx` | `auth()` → `/boards` when signed in; otherwise resolves the fixture and renders the canvas. | A |
| `components/demo/demo-board.tsx` | `'use client'`. Owns the open-card state and renders `BoardCanvas` in demo mode. Keeps demo concerns out of the board components. | A (shell), C (dialog) |
| `components/demo/demo-card.tsx` | The read-only card dialog. | C |
| `components/board/realtime.tsx` | Gains `boardId: string \| null`; null never opens a socket. | A |
| `components/app/top-bar.tsx` | Four viewer props collapse into one optional `viewer`; absent means no account menu. | A |
| `components/board/board-card.tsx` | Gains `demo` (title is not a link) and `canDrag` (drag without write controls). | A, B, C |
| `components/board/board-column.tsx` | Passes both through. Pure plumbing. | A, B, C |
| `components/board/board-canvas.tsx` | Gains `demo`; `run()` short-circuits; `canDrag={canWrite \|\| demo}`. | A, B, C |
| `e2e/demo.spec.ts` | Signed-out end-to-end: renders, drags, reloads, opens a card. | A, B, C |
| `e2e/board-view.spec.ts` | `/` joins the footer-free list. | A |

---

## Section A — the board a stranger can see

Branch: `feat/demo-board-route`, from `main`.

Ships a static, legible demo board at `/`. Nothing drags yet — that is Section B — so a card is
rendered exactly as a viewer sees one today, minus the link.

### Task A1: The fixture

**Files:**
- Create: `lib/demo-board.ts`
- Test: `lib/demo-board.test.ts`

**Interfaces:**
- Consumes: `BoardWithCards` from `lib/boards.ts` (`import type` only); `previewOf` from
  `lib/cards-limits.ts`.
- Produces: `DEMO_BOARD_ID: string`, `DEMO_BOARD_NAME: string`,
  `demoBoard(now: Date): BoardWithCards`. Task A5 and every later section use all three.

- [ ] **Step 1: Write the failing test**

Create `lib/demo-board.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEMO_BOARD_NAME, demoBoard } from '@/lib/demo-board';
import { DESCRIPTION_PREVIEW_MAX } from '@/lib/cards-limits';
import { dueLabel, dueState } from '@/lib/due';

const NOW = new Date('2026-09-04T09:30:00.000Z');

const allCards = (now: Date) => demoBoard(now).columns.flatMap((column) => column.cards);
// CLAUDE.md bans non-null assertions, so the dates are narrowed by flatMap
// rather than filtered and asserted.
const allDue = (now: Date) => allCards(now).flatMap((card) => (card.dueDate ? [card.dueDate] : []));

describe('demoBoard', () => {
  test('is the five seeded columns, in rank order', () => {
    const board = demoBoard(NOW);
    expect(board.name).toBe(DEMO_BOARD_NAME);
    expect(board.columns.map((column) => column.name)).toEqual([
      'Ready to Work',
      'In Progress',
      'In Testing',
      'In Review',
      'Done',
    ]);
    const ranks = board.columns.map((column) => column.rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  test('orders the cards in every column by rank, ascending by code point', () => {
    for (const column of demoBoard(NOW).columns) {
      const ranks = column.cards.map((card) => card.rank);
      expect([...ranks].sort()).toEqual(ranks);
      expect(new Set(ranks).size).toBe(ranks.length);
    }
  });

  test('gives every card the column that holds it, and a unique id', () => {
    const board = demoBoard(NOW);
    for (const column of board.columns) {
      for (const card of column.cards) expect(card.columnId).toBe(column.id);
    }
    const ids = allCards(NOW).map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('assigns only labels the board actually carries', () => {
    const board = demoBoard(NOW);
    const known = new Set(board.labels.map((label) => label.id));
    const assigned = allCards(NOW).flatMap((card) => card.cardLabels.map((row) => row.labelId));
    expect(assigned.length).toBeGreaterThan(0);
    for (const labelId of assigned) expect(known.has(labelId)).toBe(true);
  });

  test('orders labels by name, the way the board read does', () => {
    const names = demoBoard(NOW).labels.map((label) => label.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  test('resolves due dates against now: one overdue, one due soon', () => {
    const states = allDue(NOW).map((due) => dueState(due, NOW));
    expect(states).toContain('over');
    expect(states).toContain('soon');
  });

  // The reason the fixture stores offsets rather than dates. A hardcoded
  // 2026 due date passes every test above and fails this one.
  test('still reads 3d over a year later', () => {
    const later = new Date('2027-09-04T09:30:00.000Z');
    const due = allDue(later);
    expect(due.map((date) => dueState(date, later))).toContain('over');
    expect(due.map((date) => dueLabel(date, later))).toContain('3d over');
  });

  test('caps a description preview at the same length Postgres would', () => {
    for (const card of allCards(NOW)) {
      expect(card.descriptionPreview?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_PREVIEW_MAX);
    }
    expect(allCards(NOW).some((card) => card.descriptionPreview !== null)).toBe(true);
  });

  test('carries an attachment count on exactly one card', () => {
    const withFiles = allCards(NOW).filter((card) => card.attachments.length > 0);
    expect(withFiles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run lib/demo-board.test.ts > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a1.log
```

Expected: FAIL — `Failed to resolve import "@/lib/demo-board"`.

- [ ] **Step 3: Write the fixture**

Create `lib/demo-board.ts`:

```ts
// The demo board's content, and the only place it lives. There is no board
// row: /boards/[boardId] reads Postgres, and / reads this file.
//
// It imports nothing that reaches the database, in the manner of
// lib/labels-limits.ts. BoardWithCards is an `import type` and is erased —
// a value import from lib/boards.ts would pull in lib/db, which opens a pg
// pool at module scope, and only `pnpm build` would notice.
import type { BoardWithCards } from '@/lib/boards';
import { previewOf } from '@/lib/cards-limits';

export const DEMO_BOARD_ID = 'demo-board';
export const DEMO_BOARD_NAME = 'Launch checklist';

const DAY = 86_400_000;

// Midnight UTC on the day `offset` days from the viewer's today. lib/due.ts
// reduces a due date from its UTC parts and "now" from its local ones, so a
// date built this way is exactly `offset` days out by dueState's reckoning.
// Offsets rather than literal dates are what keep "3d over" true in every
// year this board is served.
const dueOn = (now: Date, offset: number) =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offset * DAY);

const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

// Ordered by name, matching the board read in lib/boards.ts.
const LABELS = [
  { id: 'demo-label-api', name: 'api' },
  { id: 'demo-label-bug', name: 'bug' },
  { id: 'demo-label-design', name: 'design' },
  { id: 'demo-label-docs', name: 'docs' },
  { id: 'demo-label-infra', name: 'infra' },
];

type CardSeed = {
  id: string;
  title: string;
  createdDaysAgo: number;
  dueInDays?: number;
  description?: string;
  labelIds?: string[];
  attachments?: number;
};

type ColumnSeed = { id: string; name: string; cards: CardSeed[] };

// Ids are stable and deliberately not uuids. Nothing here may reach a server
// action, and a non-uuid id fails at the Zod boundary rather than touching a
// real row if one ever does.
const COLUMNS: ColumnSeed[] = [
  {
    id: 'demo-col-ready',
    name: 'Ready to Work',
    cards: [
      {
        id: 'demo-card-search',
        title: 'Search cards across a board',
        createdDaysAgo: 6,
        labelIds: ['demo-label-api'],
      },
      {
        id: 'demo-card-export',
        title: 'Export a board to CSV',
        createdDaysAgo: 5,
        labelIds: ['demo-label-docs'],
      },
      {
        id: 'demo-card-empty',
        title: 'An empty column should read as an invitation',
        createdDaysAgo: 4,
        labelIds: ['demo-label-design'],
      },
    ],
  },
  {
    id: 'demo-col-progress',
    name: 'In Progress',
    cards: [
      {
        id: 'demo-card-migrate',
        title: 'Move attachments to the EU bucket',
        createdDaysAgo: 9,
        dueInDays: -3,
        description:
          'The bucket has to be created against the EU-jurisdiction endpoint. A bucket made there is not visible from the plain host at all, which is what makes the privacy policy true rather than aspirational.',
        labelIds: ['demo-label-infra'],
      },
      {
        id: 'demo-card-presence',
        title: 'Show who else is looking at the board',
        createdDaysAgo: 3,
        dueInDays: 1,
        labelIds: ['demo-label-api', 'demo-label-design'],
      },
    ],
  },
  {
    id: 'demo-col-testing',
    name: 'In Testing',
    cards: [
      {
        id: 'demo-card-drag',
        title: 'Drag between columns on a phone',
        createdDaysAgo: 2,
        description:
          'Below 700px the board shows one column at a time, so a cross-column drag has to arm the column it lands in rather than draw a line the reader cannot see.',
        labelIds: ['demo-label-bug', 'demo-label-design'],
        attachments: 1,
      },
      {
        id: 'demo-card-invite',
        title: 'Invite by email, accept from the board list',
        createdDaysAgo: 7,
        labelIds: ['demo-label-api'],
      },
    ],
  },
  {
    id: 'demo-col-review',
    name: 'In Review',
    cards: [
      {
        id: 'demo-card-activity',
        title: 'Draw the line where the reader left off',
        createdDaysAgo: 1,
        description:
          'The marker is read before it is written. Upsert it first and the line sits at the top of every visit, which answers "what is new" with "everything".',
        labelIds: ['demo-label-design'],
      },
      {
        id: 'demo-card-ranks',
        title: 'Two people drop a card in the same place',
        createdDaysAgo: 8,
        labelIds: ['demo-label-infra'],
      },
    ],
  },
  {
    id: 'demo-col-done',
    name: 'Done',
    cards: [
      {
        id: 'demo-card-oauth',
        title: 'Sign in with Google and GitHub',
        createdDaysAgo: 21,
        labelIds: ['demo-label-api'],
      },
      {
        id: 'demo-card-theme',
        title: 'Dark and light, following the system',
        createdDaysAgo: 18,
        labelIds: ['demo-label-design'],
      },
      {
        id: 'demo-card-privacy',
        title: 'Name every sub-processor in the policy',
        createdDaysAgo: 14,
        labelIds: ['demo-label-docs'],
      },
    ],
  },
];

// Returns exactly the shape lib/boards.ts produces, so toBoardState consumes
// it unchanged and the canvas cannot tell the difference.
export function demoBoard(now: Date): BoardWithCards {
  return {
    id: DEMO_BOARD_ID,
    name: DEMO_BOARD_NAME,
    labels: LABELS,
    columns: COLUMNS.map((column, columnIndex) => ({
      id: column.id,
      name: column.name,
      rank: `a${columnIndex}`,
      cards: column.cards.map((card, cardIndex) => ({
        id: card.id,
        columnId: column.id,
        title: card.title,
        rank: `a${cardIndex}`,
        createdAt: ago(now, card.createdDaysAgo),
        dueDate: card.dueInDays === undefined ? null : dueOn(now, card.dueInDays),
        descriptionPreview: previewOf(card.description ?? null),
        cardLabels: (card.labelIds ?? []).map((labelId) => ({ labelId })),
        attachments: Array.from({ length: card.attachments ?? 0 }, (_, index) => ({
          id: `${card.id}-file-${index}`,
        })),
      })),
    })),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run lib/demo-board.test.ts > /tmp/a1.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/a1.log
```

Expected: EXIT=0, 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/demo-board.ts lib/demo-board.test.ts
git commit -m "feat: the demo board's content, as a fixture

Offsets rather than dates, so a card that is three days overdue stays
three days overdue in every year this board is served."
```

### Task A2: A realtime provider that can decline to connect

**Files:**
- Modify: `components/board/realtime.tsx`
- Test: `components/board/realtime.test.tsx` (create)

**Interfaces:**
- Produces: `RealtimeProvider` accepting `boardId: string | null`. Task A5 passes `null`.

- [ ] **Step 1: Write the failing test**

Create `components/board/realtime.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// vitest.config.mts does not set globals: true, so Testing Library never
// registers its own afterEach(cleanup). CLAUDE.md requires wiring it by hand.
afterEach(cleanup);

const channel = { bind: vi.fn(), unbind_all: vi.fn() };
const constructed = vi.hoisted(() => vi.fn());
// A class, not vi.fn(impl): the provider calls `new Pusher(...)`, and a spy
// wrapping an arrow function is not a constructor.
vi.mock('pusher-js', () => ({
  default: class {
    connection = { bind: vi.fn(), unbind_all: vi.fn() };
    subscribe = vi.fn(() => channel);
    unsubscribe = vi.fn();
    disconnect = vi.fn();
    constructor(...args: unknown[]) {
      constructed(...args);
    }
  },
}));

const { RealtimeProvider } = await import('./realtime');

beforeEach(() => {
  constructed.mockClear();
  vi.stubEnv('NEXT_PUBLIC_PUSHER_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_PUSHER_CLUSTER', 'eu');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('connects for a board', () => {
  render(
    <RealtimeProvider boardId="11111111-2222-3333-4444-555555555555">
      <p>board</p>
    </RealtimeProvider>,
  );
  expect(constructed).toHaveBeenCalledTimes(1);
});

// The demo has no channel it could be authorised on: its board id is not a
// uuid, so /api/pusher/auth rejects it by construction. Connecting anyway
// would spend a free-tier connection per anonymous visitor to fail.
test('never opens a socket when there is no board', () => {
  render(
    <RealtimeProvider boardId={null}>
      <p>demo</p>
    </RealtimeProvider>,
  );
  expect(constructed).not.toHaveBeenCalled();
});

test('still renders its children with no board', () => {
  const { getByText } = render(
    <RealtimeProvider boardId={null}>
      <p>demo</p>
    </RealtimeProvider>,
  );
  expect(getByText('demo')).toBeTruthy();
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run components/board/realtime.test.tsx > /tmp/a2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a2.log
```

Expected: FAIL — the `boardId={null}` renders are type errors at author time and, at runtime, the
second test fails because a client is constructed for the string `"null"` channel.

- [ ] **Step 3: Make the board id nullable**

In `components/board/realtime.tsx`, change the prop type and the effect's guard:

```tsx
export function RealtimeProvider({
  boardId,
  children,
}: {
  // Null is a surface with no channel to join — the demo board, which is a
  // fixture rather than a row. It is not an error state: the provider is
  // still required, because the canvas calls useRealtime() unconditionally.
  boardId: string | null;
  children: React.ReactNode;
}) {
```

and inside the effect, extend the existing early return:

```tsx
    // No credentials is a supported configuration, not an error: the app is
    // simply not realtime, which is what self-hosting without Pusher gets.
    // No board id is the same answer for a different reason — see the prop.
    if (!key || !cluster || !boardId) return;
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm exec vitest run components/board/realtime.test.tsx > /tmp/a2.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/a2.log
```

Expected: EXIT=0, 3 tests passing.

- [ ] **Step 5: Confirm the board route still typechecks**

```bash
pnpm typecheck > /tmp/a2-tc.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a2-tc.log
```

Expected: EXIT=0. `string` is assignable to `string | null`, so the existing call site is
unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/board/realtime.tsx components/board/realtime.test.tsx
git commit -m "feat: let a surface with no channel skip the socket entirely"
```

### Task A3: A top bar with no account menu

**Files:**
- Modify: `components/app/top-bar.tsx`, `app/(app)/(chrome)/layout.tsx:14`,
  `app/(app)/(board)/boards/[boardId]/layout.tsx:54`
- Test: `components/app/top-bar.test.tsx` (create)

**Interfaces:**
- Produces: `TopBar` taking `viewer?: { userId: string; name: string | null; email: string; image: string | null }`
  in place of the four separate props. Absent means no `AccountMenu`.

- [ ] **Step 1: Write the failing test**

Create `components/app/top-bar.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

// AccountMenu reaches lib/actions/session, which imports lib/auth and
// therefore lib/db's pool. The bar's own behaviour is what is under test.
vi.mock('@/components/app/account-menu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

const { TopBar } = await import('./top-bar');

const viewer = {
  userId: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  image: null,
};

test('renders the account menu for a signed-in viewer', () => {
  const html = renderToStaticMarkup(<TopBar viewer={viewer} title="Roadmap" />);
  expect(html).toContain('account-menu');
  expect(html).toContain('Roadmap');
});

// The demo is served to someone with no session, so there is no account to
// put in a menu — and the privacy link the board hides in that menu has to
// move into the bar's actions instead.
test('renders no account menu without a viewer', () => {
  const html = renderToStaticMarkup(<TopBar title="Launch checklist" />);
  expect(html).not.toContain('account-menu');
  expect(html).toContain('Launch checklist');
});

test('renders its actions either way', () => {
  const html = renderToStaticMarkup(<TopBar actions={<a href="/privacy">Privacy</a>} />);
  expect(html).toContain('/privacy');
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run components/app/top-bar.test.tsx > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a3.log
```

Expected: FAIL — `TopBar` has no `viewer` prop and requires `userId`, `email` and `image`.

- [ ] **Step 3: Collapse the four props into one optional object**

Rewrite the signature and the trailing block of `components/app/top-bar.tsx`:

```tsx
import { AccountMenu } from '@/components/app/account-menu';

export type TopBarViewer = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
};

// A page cannot pass data up into a layout, so the board title is resolved in
// the layout on the dynamic segment and handed down here.
export function TopBar({
  viewer,
  title,
  nav,
  actions,
}: {
  // Absent on the demo board at /, which is served to someone with no
  // session. Every other surface under (app) has one by the time it renders.
  viewer?: TopBarViewer;
  title?: string;
  // Navigation, not an action: it sits to the left of the title so the bar
  // reads as "Boards / this board" rather than burying the way out among the
  // things you do to the board you are on.
  nav?: React.ReactNode;
  actions?: React.ReactNode;
}) {
```

and in the returned markup, replace the unconditional `<AccountMenu … />` with:

```tsx
        {actions}
        {viewer ? (
          <AccountMenu
            userId={viewer.userId}
            name={viewer.name}
            email={viewer.email}
            image={viewer.image}
          />
        ) : null}
```

- [ ] **Step 4: Update both existing call sites**

`app/(app)/(chrome)/layout.tsx`:

```tsx
      <TopBar
        viewer={{
          userId: session.user.id ?? '',
          name: session.user.name ?? null,
          email: session.user.email ?? '',
          image: session.user.image ?? null,
        }}
      />
```

`app/(app)/(board)/boards/[boardId]/layout.tsx` — same object, replacing the four props below
`actions`:

```tsx
            viewer={{
              userId: session.user.id,
              name: session.user.name ?? null,
              email: session.user.email ?? '',
              image: session.user.image ?? null,
            }}
```

- [ ] **Step 5: Run the tests and the typechecker**

```bash
pnpm exec vitest run components/app/top-bar.test.tsx > /tmp/a3.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/a3.log
pnpm typecheck > /tmp/a3-tc.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/a3-tc.log
```

Expected: both EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add components/app/top-bar.tsx components/app/top-bar.test.tsx "app/(app)/(chrome)/layout.tsx" "app/(app)/(board)/boards/[boardId]/layout.tsx"
git commit -m "refactor: let the top bar render without an account"
```

### Task A4: A card face that is not a link

**Files:**
- Modify: `components/board/board-card.tsx`, `components/board/board-column.tsx`,
  `components/board/board-canvas.tsx`
- Test: `components/board/board-card.test.tsx`

**Interfaces:**
- Produces: `BoardCard` and `BoardColumn` take `demo?: boolean`; `BoardCanvas` takes
  `demo?: boolean` and passes it down. Task B2 and Task C3 extend the same prop.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-card.test.tsx`:

```tsx
describe('the demo board', () => {
  // The intercepting route lives under /boards/[boardId]; at / it does not
  // exist. A link there sends a signed-out visitor to /signin from a
  // middle-click, a long-press, or the status bar they read before clicking.
  test('renders the title as plain text, not a link', () => {
    const html = render({ demo: true, canWrite: false });
    expect(html).toContain('Fix the rank tie-break');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });

  test('still links on a real board', () => {
    expect(render()).toContain('href="/boards/board-1/cards/card-1"');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm exec vitest run components/board/board-card.test.tsx > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a4.log
```

Expected: FAIL — `demo` is not a prop of `BoardCard`, and the rendered title is still an anchor.

- [ ] **Step 3: Add the prop and the branch**

In `components/board/board-card.tsx`, add `demo` to the destructured props and the type:

```tsx
export function BoardCard({
  card,
  ringHue,
  boardId,
  canWrite,
  demo = false,
  columns,
  labels,
  filtering,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  ringHue?: number;
  boardId: string;
  canWrite: boolean;
  // The demo board at / has no card route to link to and no server to reach.
  demo?: boolean;
  columns: { id: string; name: string }[];
```

and extend the title's existing branch, which already renders plain text for a card the server
does not know about yet:

```tsx
          {card.pending || demo ? (
            // A temp id is not a card the server knows about yet — the same
            // reason useSortable disables dragging above. Not a link until it
            // settles. A demo card is never a link at all: there is no card
            // route under /, so following one lands on /signin.
            card.title
          ) : (
```

- [ ] **Step 4: Thread it through the column and the canvas**

In `components/board/board-column.tsx`, add `demo` beside `canWrite` in both the destructuring and
the prop type (`demo?: boolean;`), and pass it to `BoardCard`:

```tsx
                        canWrite={canWrite}
                        demo={demo}
```

In `components/board/board-canvas.tsx`, add it to the component's props:

```tsx
export function BoardCanvas({
  board,
  canWrite,
  demo = false,
}: {
  board: BoardWithCards;
  canWrite: boolean;
  // Rendered at / from lib/demo-board.ts rather than from Postgres. Section B
  // gives this flag its second job: a drag that never calls the server.
  demo?: boolean;
}) {
```

and pass it to each `BoardColumn`, immediately after `canWrite={canWrite}`:

```tsx
                canWrite={canWrite}
                demo={demo}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm exec vitest run components/board > /tmp/a4.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/a4.log
```

Expected: EXIT=0, with the whole board suite passing — the default `demo = false` leaves every
existing test unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/board/board-card.tsx components/board/board-card.test.tsx components/board/board-column.tsx components/board/board-canvas.tsx
git commit -m "feat: a demo card face is text, not a link to a route that is not there"
```

### Task A5: The route

**Files:**
- Create: `app/(demo)/layout.tsx`, `app/(demo)/page.tsx`, `components/demo/demo-board.tsx`
- Delete: `app/page.tsx`
- Modify: `e2e/board-view.spec.ts`, `playwright.config.ts` (a stale comment)
- Test: `e2e/demo.spec.ts` (create)

**Interfaces:**
- Consumes: `demoBoard`, `DEMO_BOARD_NAME` (A1); `RealtimeProvider` with a null board (A2);
  `TopBar`'s optional viewer (A3); `BoardCanvas`'s `demo` (A4).
- Produces: `DemoBoard({ board }: { board: BoardWithCards })`, the client shell Task C3 adds the
  card dialog to.

- [ ] **Step 1: Write the failing end-to-end test**

Create `e2e/demo.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { closeSeedPool, removeSeededUser, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// Signed out on purpose: no seedSession, no context cookies. If any of these
// need a session to pass, the demo is not a demo.
test('a stranger gets the board at /', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Launch checklist' })).toBeVisible();
  await expect(page.locator('[data-column-id]')).toHaveCount(5);
  await expect(page.getByTestId('card-title').first()).toBeVisible();
});

test('the demo offers no way to change the board', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'New card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Card actions' })).toHaveCount(0);
});

// The card route lives under /boards/[boardId] and is signed-in only, so a
// link on a demo card face is a trap. See board-card.test.tsx.
test('no card on the demo board is a link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-card-id] a')).toHaveCount(0);
});

test('says that nothing is saved, and offers the way in', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Nothing here is saved')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

// CLAUDE.md requires the privacy link reachable from every route. The demo is
// a board — fixed viewport, no footer — and a signed-out visitor has no
// account menu, so the bar carries it.
test('keeps privacy reachable without a footer', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible();
});

test('sends a signed-in visitor to their own boards', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/');
    await expect(page).toHaveURL(/\/boards$/);
  } finally {
    await removeSeededUser(userId);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/a5.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/a5.log
```

Expected: non-zero exit. `/` still redirects to `/boards` and then to `/signin`.

- [ ] **Step 3: Write the client shell**

Create `components/demo/demo-board.tsx`:

```tsx
'use client';

import { BoardCanvas } from '@/components/board/board-canvas';
import type { BoardWithCards } from '@/lib/boards';

// The demo's own client boundary. It exists so the board components stay
// ignorant of the demo beyond one flag, and so Section C has somewhere to
// hold the open card without giving BoardCanvas a dialog it does not need.
export function DemoBoard({ board }: { board: BoardWithCards }) {
  return <BoardCanvas board={board} canWrite={false} demo />;
}
```

- [ ] **Step 4: Write the layout**

Create `app/(demo)/layout.tsx`:

```tsx
import Link from 'next/link';

import { TopBar } from '@/components/app/top-bar';
import { BoardActionsProvider } from '@/components/board/board-actions';
import { RealtimeProvider } from '@/components/board/realtime';
import { DEMO_BOARD_NAME } from '@/lib/demo-board';

// The (board) treatment: fixed viewport height, body scroll locked, and no
// SiteFooter — a footer below a locked viewport is unreachable. The privacy
// link the board view hides in the account menu lives in the bar here,
// because a visitor with no session has no account menu.
//
// There is no auth() call in this layout. Nothing here is authorised: the
// demo is public, and the redirect for a signed-in visitor is a convenience
// that belongs in the one place that decides what to render.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider boardId={null}>
      <BoardActionsProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <TopBar
            title={DEMO_BOARD_NAME}
            actions={
              <>
                <span className="hidden font-mono text-xs text-muted min-[700px]:inline">
                  Nothing here is saved
                </span>
                <span className="font-mono text-xs text-muted min-[700px]:hidden">Demo</span>
                <Link
                  href="/privacy"
                  className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
                >
                  Privacy
                </Link>
                <Link
                  href="/signin"
                  className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-[13px] font-medium text-white"
                >
                  Sign in
                </Link>
              </>
            }
          />
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </BoardActionsProvider>
    </RealtimeProvider>
  );
}
```

`bg-flow-mid` with `text-white` is exactly what `components/board/new-card-button.tsx:13` already
uses for the app's one accent button. No new colour, no new token.

- [ ] **Step 5: Write the page, and delete the old root**

Create `app/(demo)/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

import { DemoBoard } from '@/components/demo/demo-board';
import { auth } from '@/lib/auth';
import { demoBoard } from '@/lib/demo-board';

// / is the demo board for anyone signed out, and a redirect for anyone signed
// in. It reads no database: the board comes from lib/demo-board.ts, resolved
// against the request's own clock so its due dates never go stale.
export default async function DemoPage() {
  const session = await auth();
  if (session?.user) redirect('/boards');

  return <DemoBoard board={demoBoard(new Date())} />;
}
```

```bash
git rm app/page.tsx
```

- [ ] **Step 6: Add `/` to the footer-free list**

In `e2e/board-view.spec.ts`, extend the third test's loop comment and add a case. Append this test
after `'the board drops the footer but keeps privacy in the account menu'`:

```ts
// The demo board at / is the second footer-free route, for the same reason —
// a locked viewport — but it has no account menu to hide the link in.
test('the demo board drops the footer and puts privacy in the bar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible();
});
```

- [ ] **Step 7: Correct the stale comment in the Playwright config**

`playwright.config.ts`'s `webServer` comment says the root "redirects into the auth-gated routes".
That stops being true here. Update it to:

```ts
    // Readiness probes /api/health, not '/'. The root renders the demo board,
    // which is a fixture and would report ready before the database is
    // reachable — the seeded-session harness needs the database, so the probe
    // has to be a route that touches it.
```

Leave the probe itself alone.

- [ ] **Step 8: Run the new suite and watch it pass**

```bash
pnpm exec playwright test e2e/demo.spec.ts e2e/board-view.spec.ts --reporter=line > /tmp/a5.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/a5.log
```

Expected: EXIT=0. Compare the number that ran against the number collected — a summary line is not
an exit code.

- [ ] **Step 9: Full local gate**

```bash
pnpm typecheck > /tmp/a5-tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/a5-lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/a5-test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/a5-build.log 2>&1; echo "BUILD=$?"
tail -5 /tmp/a5-build.log
```

Expected: all four EXIT=0. The build is what proves `lib/demo-board.ts` dragged no database import
into the client bundle.

- [ ] **Step 10: Commit**

```bash
git add "app/(demo)" components/demo/demo-board.tsx e2e/demo.spec.ts e2e/board-view.spec.ts playwright.config.ts
git add -u
git commit -m "feat: serve the demo board at /

A signed-out visitor gets a real board rendered from a fixture; a signed-in
one still lands on /boards."
```

### Task A6: Documentation and the pull request

**Files:**
- Modify: `CLAUDE.md`, `docs/plans/demo-board.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Under **Layout**, add the group above `components/`:

```
  (demo)/
    layout.tsx              # / for a signed-out visitor: the board with no
                            # session, no footer, privacy in the top bar
    page.tsx                # redirects to /boards when signed in
```

Under **Footer and legal pages**, after the paragraph explaining the board's exemption, add:

> `/` is the second exemption, and the same one: the demo board locks the viewport too. It has no
> account menu to hide the link in — its visitor has no account — so the privacy link sits in its
> top bar. `e2e/demo.spec.ts` and `e2e/board-view.spec.ts` both hold it there.

Under **Realtime**, after the bullet about `/api/pusher/auth`, add:

> `RealtimeProvider` takes `boardId: string | null`, and null is how a surface opts out of the
> socket entirely — the demo board at `/`, whose id is not a uuid and could never be authorised on
> a channel. Without it every anonymous visitor would open a connection to fail.

Under **Open decisions**, after the labels paragraph, add:

> **The demo board is settled** and built: `/` serves a fixture board to anyone signed out, drag
> included, and writes nothing anywhere. `docs/specs/demo-board.md` holds the reasoning — including
> why it is a fixture rather than a board row.

- [ ] **Step 2: Tick this plan's Section A boxes**

Every checkbox in Tasks A1–A6, in the same commit.

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md docs/plans/demo-board.md
git commit -m "docs: record the demo board at /"
git push -u origin feat/demo-board-route
```

- [ ] **Step 4: Open the pull request**

```bash
gh pr create --base main --title "feat: demo board Section A — the board a stranger can see" --body "..."
```

The body states: the spec and plan section this implements, the exit codes actually observed for
typecheck, lint, test, build and the e2e run, screenshots of `/` in both themes and at 360px, and
anything left out. Then **stop and hand back** — do not start Section B in this session, and do not
merge your own PR.

---

## Section B — the drag that goes nowhere

Branch: `feat/demo-board-drag`, from `main` once Section A has landed. Confirm the base is real
before starting:

```bash
git fetch origin && git merge-base --is-ancestor origin/main HEAD && echo "base ok"
```

### Task B1: A card that drags without write controls

**Files:**
- Modify: `components/board/board-card.tsx`, `components/board/board-column.tsx`,
  `components/board/board-canvas.tsx`
- Test: `components/board/board-card.test.tsx`

**Interfaces:**
- Produces: `BoardCard` and `BoardColumn` take `canDrag: boolean`; `BoardCanvas` computes
  `canDrag={canWrite || demo}` and passes it down. `canWrite` keeps its existing meaning — the ⋯
  menu, the composer, the column controls — and stops gating the sortable.

- [ ] **Step 1: Write the failing test**

In `components/board/board-card.test.tsx`, the `@dnd-kit/sortable` mock discards its argument.
Capture it. Replace the existing mock block's `useSortable` with a spy, adding this beside the
`dragging` hoisted ref at the top of the file:

```tsx
const sortableArgs = vi.hoisted(() => ({ current: null as { disabled?: boolean } | null }));
```

and inside the existing `vi.mock('@dnd-kit/sortable', …)` factory, change `useSortable` to:

```tsx
  useSortable: (args: { disabled?: boolean }) => {
    sortableArgs.current = args;
    return {
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      get isDragging() {
        return dragging.current;
      },
    };
  },
```

Then append:

```tsx
describe('dragging apart from writing', () => {
  // The demo drags but has no ⋯ menu, no composer and no server. Before this,
  // both behaviours rode on canWrite and could not be separated.
  test('a demo card is draggable while it carries no write controls', () => {
    const html = render({ canWrite: false, canDrag: true, demo: true });
    expect(sortableArgs.current?.disabled).toBe(false);
    expect(html).not.toContain('Card actions');
  });

  test('a viewer still cannot drag', () => {
    render({ canWrite: false, canDrag: false });
    expect(sortableArgs.current?.disabled).toBe(true);
  });

  test('a pending card never drags, whatever else is true', () => {
    render({ canWrite: true, canDrag: true, card: { ...card, pending: true } });
    expect(sortableArgs.current?.disabled).toBe(true);
  });

  test('a filtered board never drags', () => {
    render({ canWrite: true, canDrag: true, filtering: true });
    expect(sortableArgs.current?.disabled).toBe(true);
  });
});
```

Add `canDrag` to the shared `render` helper's defaults so the existing tests keep their meaning:

```tsx
      canWrite
      canDrag
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/board/board-card.test.tsx > /tmp/b1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/b1.log
```

Expected: FAIL — `canDrag` is not a prop, and `disabled` is still computed from `canWrite`.

- [ ] **Step 3: Split the two meanings**

In `components/board/board-card.tsx`, add `canDrag` to the props and the type (`canDrag: boolean;`,
documented as *"Dragging and writing are not the same permission: the demo board drags and writes
nothing."*), then change the sortable's guard:

```tsx
    disabled: !canDrag || card.pending === true || filtering,
```

Leave every other `canWrite` in the file exactly as it is — the ⋯ menu and the title's padding
still key off it.

- [ ] **Step 4: Thread it through**

`components/board/board-column.tsx`: add `canDrag` to the destructuring and the type, and pass
`canDrag={canDrag}` to `BoardCard` beside `canWrite`.

`components/board/board-canvas.tsx`: derive it once, above the return, and pass it to every column:

```tsx
  // Dragging and writing part company on the demo board: it drags, and it has
  // no write controls and no server to tell.
  const canDrag = canWrite || demo;
```

```tsx
                canWrite={canWrite}
                canDrag={canDrag}
```

The canvas's own `onDragEnd` guard at `components/board/board-canvas.tsx:516` reads `!canWrite` and
must read `!canDrag`, or a demo drop is computed and then discarded.

- [ ] **Step 5: Run the board suite**

```bash
pnpm exec vitest run components/board > /tmp/b1.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/b1.log
```

Expected: EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add components/board/board-card.tsx components/board/board-card.test.tsx components/board/board-column.tsx components/board/board-canvas.tsx
git commit -m "feat: separate dragging a card from being allowed to write one"
```

### Task B2: A move that never leaves the browser

**Files:**
- Modify: `components/board/board-canvas.tsx`
- Test: `components/board/board-canvas.test.tsx` (create)

**Interfaces:**
- Consumes: `demo` and `canDrag` from Tasks A4 and B1.
- Produces: nothing new. This is the behaviour the whole spec exists for.

- [ ] **Step 1: Write the failing test**

Create `components/board/board-canvas.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// vitest.config.mts does not set globals: true, so Testing Library never
// registers afterEach(cleanup) for itself. CLAUDE.md requires it by hand.
afterEach(cleanup);

// DndContext is mocked so the test can hold the real onDragEnd and call it
// with a drop, rather than simulating pointer physics in jsdom.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((event: unknown) => void) | null }));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (e: unknown) => void }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: () => null,
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => {} }),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  sortableKeyboardCoordinates: () => {},
  verticalListSortingStrategy: undefined,
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
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

const cardActions = vi.hoisted(() => ({
  createCard: vi.fn(),
  deleteCard: vi.fn(),
  moveCard: vi.fn(),
  renameCard: vi.fn(),
}));
vi.mock('@/lib/actions/cards', () => cardActions);
vi.mock('@/lib/actions/board', () => ({ readBoard: vi.fn() }));
vi.mock('@/lib/actions/columns', () => ({
  addColumn: vi.fn(),
  deleteColumn: vi.fn(),
  moveColumn: vi.fn(),
  renameColumn: vi.fn(),
}));

const { BoardCanvas } = await import('./board-canvas');
const { RealtimeProvider } = await import('./realtime');
const { BoardActionsProvider } = await import('./board-actions');
const { demoBoard } = await import('@/lib/demo-board');

const NOW = new Date('2026-09-04T09:30:00.000Z');

const renderDemo = () =>
  render(
    <RealtimeProvider boardId={null}>
      <BoardActionsProvider>
        <BoardCanvas board={demoBoard(NOW)} canWrite={false} demo />
      </BoardActionsProvider>
    </RealtimeProvider>,
  );

test('a demo drop moves the card and tells no one', () => {
  renderDemo();

  // 'demo-card-search' starts in Ready to Work; drop it on In Progress.
  dnd.onDragEnd?.({
    active: { id: 'demo-card-search' },
    over: { id: 'demo-col-progress' },
  });

  const progress = document.querySelector('[data-column-id="demo-col-progress"]');
  expect(progress?.textContent).toContain('Search cards across a board');

  // The claim the whole feature rests on.
  expect(cardActions.moveCard).not.toHaveBeenCalled();
  expect(cardActions.createCard).not.toHaveBeenCalled();
  expect(cardActions.renameCard).not.toHaveBeenCalled();
  expect(cardActions.deleteCard).not.toHaveBeenCalled();
});

test('the card leaves the column it came from', () => {
  renderDemo();

  dnd.onDragEnd?.({
    active: { id: 'demo-card-search' },
    over: { id: 'demo-col-progress' },
  });

  const ready = document.querySelector('[data-column-id="demo-col-ready"]');
  expect(ready?.textContent).not.toContain('Search cards across a board');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/board/board-canvas.test.tsx > /tmp/b2.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/b2.log
```

Expected: FAIL — `moveCard` was called. If instead the drop does nothing, the `!canDrag` guard from
Task B1 Step 4 was not applied.

- [ ] **Step 3: Short-circuit the mutation funnel**

In `components/board/board-canvas.tsx`, at the top of `run` (`board-canvas.tsx:364`):

```tsx
  // Every mutation but create follows one shape: compute the inverse from the
  // pre-state, apply optimistically, and replay the inverse if the server says
  // no. The inverse rather than a snapshot is what keeps a failed request from
  // also undoing whatever landed while it was in flight.
  //
  // The demo board stops at the first line: it has no server to ask and no id
  // the server would recognise, so the optimistic update is the whole update.
  // A reload restores the fixture, which is the honest thing for a board
  // nobody owns.
  function run(action: BoardAction, call: () => Promise<{ ok: boolean }>, message: string) {
    if (demo) {
      dispatch(action);
      return;
    }

    const undo = inverse(state, action);
```

Nothing else changes: `addCard` and `addColumnAfter` are reached only through controls `canWrite`
already hides.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run components/board > /tmp/b2.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/b2.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add components/board/board-canvas.tsx components/board/board-canvas.test.tsx
git commit -m "feat: a demo drag stops at the reducer"
```

### Task B3: The reload that proves it

**Files:**
- Modify: `e2e/demo.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `e2e/demo.spec.ts`:

```ts
// dnd-kit's PointerSensor has a 5px activation distance and only starts the
// drag once it has seen the pointer move, so Playwright's dragTo is silently
// ignored. This is the sequence board-dnd.spec.ts proved works — without
// written(), because the demo issues no request to wait for.
async function dragCard(page: Page, title: string, columnId: string) {
  const card = page.locator('[data-card-id]').filter({ hasText: title });
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute('style', /translate3d/);
  await page.locator(`[data-column-id="${columnId}"]`).hover();
  await page.mouse.up();
}

test('a card dragged on the demo lands where it was dropped', async ({ page }) => {
  await page.goto('/');

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');

  await expect(
    page.locator('[data-column-id="demo-col-progress"]').getByTestId('card-title'),
  ).toContainText(['Search cards across a board']);
});

// The whole feature in one assertion: the drag was real, and it was never
// written anywhere.
test('a reload puts it back', async ({ page }) => {
  await page.goto('/');

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');
  await page.reload();

  await expect(
    page.locator('[data-column-id="demo-col-ready"]').getByTestId('card-title'),
  ).toContainText(['Search cards across a board']);
  await expect(
    page.locator('[data-column-id="demo-col-progress"]').getByTestId('card-title'),
  ).not.toContainText(['Search cards across a board']);
});

test('dragging the demo issues no request of any kind', async ({ page }) => {
  await page.goto('/');

  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');
  await page.waitForTimeout(500);

  expect(posts).toEqual([]);
});
```

Add `type Page` to the file's Playwright import: `import { expect, test, type Page } from '@playwright/test';`

- [ ] **Step 2: Run it and watch it fail, then pass**

```bash
pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/b3.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/b3.log
```

Expected after Tasks B1 and B2: EXIT=0, with the collected count matching the run count. If the
drag test fails at the `translate3d` assertion, `canDrag` is not reaching the card.

- [ ] **Step 3: Full local gate**

```bash
pnpm typecheck > /tmp/b3-tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/b3-lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/b3-test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/b3-build.log 2>&1; echo "BUILD=$?"
```

Expected: all EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add e2e/demo.spec.ts
git commit -m "test: prove the demo drag reaches nothing but the reducer"
```

### Task B4: Documentation and the pull request

- [ ] **Step 1: Update `CLAUDE.md`**

Under **Drag and drop**, add:

> Dragging and writing are separate permissions. `canWrite` gates the ⋯ menus, the composer and the
> column controls; `canDrag` gates the sortable, and the demo board at `/` has the second without
> the first. `BoardCanvas`'s `run()` returns after its dispatch in demo mode, so an optimistic move
> is the whole move.

- [ ] **Step 2: Tick every Section B box in this plan, and commit**

```bash
git add CLAUDE.md docs/plans/demo-board.md
git commit -m "docs: record the demo drag"
git push -u origin feat/demo-board-drag
```

- [ ] **Step 3: Open the PR, then stop**

`gh pr create --base main --title "feat: demo board Section B — the drag that goes nowhere"`, with
observed exit codes and a screenshot of a drag in progress. Hand back; do not start Section C in
this session.

---

## Section C — the card

Branch: `feat/demo-board-card`, from `main` once Section B has landed.

### Task C1: The card detail the fixture already implies

**Files:**
- Modify: `lib/demo-board.ts`, `lib/demo-board.test.ts`

**Interfaces:**
- Produces: `DemoCardDetail` and `demoCard(cardId: string, now: Date): DemoCardDetail | null`.
  The spec writes this as `demoCard(cardId)`; it takes `now` for the same reason `demoBoard` does —
  the comment timestamps are offsets, not dates. Task C2 consumes it.

- [ ] **Step 1: Write the failing test**

Append to `lib/demo-board.test.ts`:

```ts
describe('demoCard', () => {
  test('returns the whole description, not the preview', () => {
    const card = demoCard('demo-card-migrate', NOW);
    expect(card?.title).toBe('Move attachments to the EU bucket');
    expect(card?.description?.length ?? 0).toBeGreaterThan(DESCRIPTION_PREVIEW_MAX);
  });

  test('resolves labels to names, in the board order', () => {
    expect(demoCard('demo-card-drag', NOW)?.labels.map((label) => label.name)).toEqual([
      'bug',
      'design',
    ]);
  });

  test('carries comments, oldest first, dated against now', () => {
    const comments = demoCard('demo-card-migrate', NOW)?.comments ?? [];
    expect(comments.length).toBeGreaterThan(0);
    const times = comments.map((comment) => comment.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const time of times) expect(time).toBeLessThan(NOW.getTime());
  });

  test('agrees with the board about the due date', () => {
    const onBoard = allCards(NOW).find((card) => card.id === 'demo-card-migrate');
    expect(demoCard('demo-card-migrate', NOW)?.dueDate).toEqual(onBoard?.dueDate);
  });

  test('answers null for a card that is not on the demo board', () => {
    expect(demoCard('demo-card-nope', NOW)).toBeNull();
    expect(demoCard('11111111-2222-3333-4444-555555555555', NOW)).toBeNull();
  });
});
```

Add `demoCard` to the file's import from `@/lib/demo-board`.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run lib/demo-board.test.ts > /tmp/c1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c1.log
```

Expected: FAIL — `demoCard` is not exported.

- [ ] **Step 3: Add the comments and the reader**

In `lib/demo-board.ts`, add a comment seed to `CardSeed`:

```ts
type CommentSeed = { id: string; authorId: string; author: string; daysAgo: number; body: string };
```

extend `CardSeed` with `comments?: CommentSeed[];`, and give two cards comments. On
`demo-card-migrate`:

```ts
        comments: [
          {
            id: 'demo-comment-migrate-1',
            authorId: 'demo-user-rin',
            author: 'Rin Okabe',
            daysAgo: 4,
            body: 'The plain endpoint cannot see the bucket at all, so this is not a setting that can drift.',
          },
          {
            id: 'demo-comment-migrate-2',
            authorId: 'demo-user-mila',
            author: 'Mila Brandt',
            daysAgo: 2,
            body: 'Verified from outside with an unauthenticated preflight. Still want the authenticated check before we call it done.',
          },
        ],
```

and on `demo-card-drag`:

```ts
        comments: [
          {
            id: 'demo-comment-drag-1',
            authorId: 'demo-user-mila',
            author: 'Mila Brandt',
            daysAgo: 1,
            body: 'Arming the column reads well on a phone. The line alone did not.',
          },
        ],
```

Then append the reader:

```ts
export type DemoCardDetail = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  labels: { id: string; name: string }[];
  comments: { id: string; body: string; createdAt: Date; author: { id: string; name: string } }[];
};

// Null for anything that is not on the demo board, including a well-formed
// uuid: the demo has no rows and nothing to look one up in.
export function demoCard(cardId: string, now: Date): DemoCardDetail | null {
  for (const column of COLUMNS) {
    const card = column.cards.find((seed) => seed.id === cardId);
    if (!card) continue;

    const assigned = new Set(card.labelIds ?? []);
    return {
      id: card.id,
      title: card.title,
      description: card.description ?? null,
      dueDate: card.dueInDays === undefined ? null : dueOn(now, card.dueInDays),
      // Filtered from the board's own set rather than mapped from the card's,
      // so the order matches the picker and the card face — the rule
      // LabelLine in board-card.tsx already follows.
      labels: LABELS.filter((label) => assigned.has(label.id)),
      comments: (card.comments ?? [])
        .map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: ago(now, comment.daysAgo),
          author: { id: comment.authorId, name: comment.author },
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    };
  }

  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run lib/demo-board.test.ts > /tmp/c1.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/c1.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add lib/demo-board.ts lib/demo-board.test.ts
git commit -m "feat: what a demo card holds when you open it"
```

### Task C2: The read-only card

**Files:**
- Create: `components/demo/demo-card.tsx`, `components/demo/demo-card.test.tsx`

**Interfaces:**
- Consumes: `DemoCardDetail` (C1); `Dialog`, `DialogContent`, `DialogTitle` from
  `components/ui/dialog.tsx`; `avatarHue` and `initials` from `lib/avatar.ts`; `formatDue` and
  `dueState` from `lib/due.ts`; `formatRelative` from `lib/relative-time.ts`.
- Produces: `DemoCard({ card, onClose }: { card: DemoCardDetail; onClose: () => void })`.

- [ ] **Step 1: Write the failing test**

Create `components/demo/demo-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(cleanup);

vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }));

const { DemoCard } = await import('./demo-card');

const card = {
  id: 'demo-card-migrate',
  title: 'Move attachments to the EU bucket',
  description: 'The bucket has to be created against the EU-jurisdiction endpoint.',
  dueDate: new Date('2026-09-01T00:00:00.000Z'),
  labels: [{ id: 'demo-label-infra', name: 'infra' }],
  comments: [
    {
      id: 'demo-comment-migrate-1',
      body: 'The plain endpoint cannot see the bucket at all.',
      createdAt: new Date('2026-08-31T09:00:00.000Z'),
      author: { id: 'demo-user-rin', name: 'Rin Okabe' },
    },
  ],
};

test('shows what the card holds', () => {
  render(<DemoCard card={card} onClose={() => {}} />);

  expect(screen.getByText('Move attachments to the EU bucket')).toBeTruthy();
  expect(screen.getByText(/EU-jurisdiction endpoint/)).toBeTruthy();
  expect(screen.getByText('infra')).toBeTruthy();
  expect(screen.getByText(/plain endpoint cannot see/)).toBeTruthy();
  expect(screen.getByText('Rin Okabe')).toBeTruthy();
});

// Read-only is the whole contract: there is no server behind this dialog.
test('offers nothing to edit with', () => {
  render(<DemoCard card={card} onClose={() => {}} />);

  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.querySelectorAll('input, textarea, form')).toHaveLength(0);
});

test('says the demo is read-only rather than leaving a reader guessing', () => {
  render(<DemoCard card={card} onClose={() => {}} />);
  expect(screen.getByText(/Sign in to add a comment/)).toBeTruthy();
});

test('renders a card with no description or comments', () => {
  render(
    <DemoCard
      card={{ ...card, description: null, comments: [], labels: [] }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText('Move attachments to the EU bucket')).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/demo/demo-card.test.tsx > /tmp/c2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c2.log
```

Expected: FAIL — cannot resolve `./demo-card`.

- [ ] **Step 3: Write the component**

Create `components/demo/demo-card.tsx`:

```tsx
'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { avatarHue, initials } from '@/lib/avatar';
import type { DemoCardDetail } from '@/lib/demo-board';
import { dueLabel, dueState, formatDue } from '@/lib/due';
import { formatRelative } from '@/lib/relative-time';
import { useMounted } from '@/lib/use-mounted';

// Deliberately not components/board/card-body.tsx. That component reads
// comments from the server on mount, mounts the attachment picker and imports
// four server actions; this dialog has no server behind it at all. The cost is
// that the two can drift — see docs/specs/demo-board.md, "What this costs".
export function DemoCard({ card, onClose }: { card: DemoCardDetail; onClose: () => void }) {
  // The same hydration trap DueDate and CommentTime avoid: the server does not
  // know the reader's clock, locale or time zone.
  const mounted = useMounted();
  const now = new Date();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-[15px] font-medium tracking-[-0.01em]">
          {card.title}
        </DialogTitle>

        {card.dueDate && mounted ? (
          <p
            className={`font-mono text-xs ${
              dueState(card.dueDate, now) === 'over'
                ? 'text-time-over'
                : dueState(card.dueDate, now) === 'soon'
                  ? 'text-time-soon'
                  : 'text-muted'
            }`}
          >
            {formatDue(card.dueDate)}
            {dueLabel(card.dueDate, now) ? ` · ${dueLabel(card.dueDate, now)}` : ''}
          </p>
        ) : null}

        {card.labels.length > 0 ? (
          <p className="font-mono text-xs text-muted">
            {card.labels.map((label) => label.name).join(' · ')}
          </p>
        ) : null}

        {card.description ? (
          <p className="whitespace-pre-wrap text-[15px]/6 text-ink">{card.description}</p>
        ) : null}

        {card.comments.length > 0 ? (
          <ul className="flex flex-col gap-4 border-t border-line pt-4">
            {card.comments.map((comment) => (
              <li key={comment.id} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: `hsl(${avatarHue(comment.author.id)} 45% 45%)` }}
                >
                  {initials(comment.author.name, '')}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted">
                    <span className="text-ink">{comment.author.name}</span>{' '}
                    <time dateTime={comment.createdAt.toISOString()} className="font-mono">
                      {mounted ? formatRelative(comment.createdAt, now) : null}
                    </time>
                  </p>
                  <p className="whitespace-pre-wrap text-[15px]/6 text-ink">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t border-line pt-4 text-[13px] text-muted">
          Sign in to add a comment, a due date or a file.
        </p>
      </DialogContent>
    </Dialog>
  );
}
```

`lib/relative-time.ts:14` exports `formatRelative(at, now, locale?)`, and `initials(name, email)`
at `lib/avatar.ts:16` only reaches the email when the name is empty — every demo comment has a
name, so the empty string is never read. Neither module changes.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run components/demo > /tmp/c2.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/c2.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add components/demo/demo-card.tsx components/demo/demo-card.test.tsx
git commit -m "feat: open a demo card and read it"
```

### Task C3: Opening it

**Files:**
- Modify: `components/board/board-card.tsx`, `components/board/board-column.tsx`,
  `components/board/board-canvas.tsx`, `components/demo/demo-board.tsx`
- Test: `components/board/board-card.test.tsx`

**Interfaces:**
- Produces: `BoardCard` and `BoardColumn` take `onOpen?: () => void`; `BoardCanvas` takes
  `onOpenCard?: (cardId: string) => void`. `DemoBoard` holds the open card in state.

- [ ] **Step 1: Write the failing test**

Append to `components/board/board-card.test.tsx`:

```tsx
test('a demo card title is a button that asks to be opened', () => {
  const html = render({ demo: true, onOpen: () => {} });
  expect(html).toContain('<button');
  expect(html).toContain('Fix the rank tie-break');
  expect(html).not.toContain('href');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run components/board/board-card.test.tsx > /tmp/c3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/c3.log
```

Expected: FAIL — the demo title is still plain text from Task A4.

- [ ] **Step 3: Promote the title to a button**

In `components/board/board-card.tsx`, add `onOpen` to the props (`onOpen?: () => void;`) and
replace the three-way title branch:

```tsx
          {card.pending ? (
            // A temp id is not a card the server knows about yet — the same
            // reason useSortable disables dragging above. Not a link until it
            // settles.
            card.title
          ) : demo ? (
            // The demo has no card route to link to, so opening one is state
            // rather than navigation. Still the whole card face's hit area,
            // and still not an anchor: there is nothing to navigate to.
            <button
              type="button"
              onClick={onOpen}
              onMouseDown={(event) => event.preventDefault()}
              className="text-left after:absolute after:inset-0"
            >
              {card.title}
            </button>
          ) : (
            <Link
```

- [ ] **Step 4: Thread it through**

`components/board/board-column.tsx`: add `onOpenCard?: (card: StateCard) => void` to the props and
pass `onOpen={onOpenCard ? () => onOpenCard(card) : undefined}` to each `BoardCard`.

`components/board/board-canvas.tsx`: add `onOpenCard?: (cardId: string) => void` to the props and
pass `onOpenCard={onOpenCard ? (card) => onOpenCard(card.id) : undefined}` to each `BoardColumn`.

`components/demo/demo-board.tsx` becomes:

```tsx
'use client';

import { useState } from 'react';

import { BoardCanvas } from '@/components/board/board-canvas';
import { DemoCard } from '@/components/demo/demo-card';
import type { BoardWithCards } from '@/lib/boards';
import { demoCard } from '@/lib/demo-board';

// The open card is state, not a route: the intercepting parallel route exists
// so a real card has a shareable URL, and a demo card has nothing to share.
export function DemoBoard({ board }: { board: BoardWithCards }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? demoCard(openId, new Date()) : null;

  return (
    <>
      <BoardCanvas board={board} canWrite={false} demo onOpenCard={setOpenId} />
      {open ? <DemoCard card={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
```

- [ ] **Step 5: Extend the end-to-end suite**

Append to `e2e/demo.spec.ts`:

```ts
test('a demo card opens and closes', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Move attachments to the EU bucket' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/EU-jurisdiction endpoint/)).toBeVisible();
  await expect(dialog.getByText('Rin Okabe')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Closing is state, not history: the board is still the board.
  await expect(page).toHaveURL(/\/$/);
});
```

The earlier `no card on the demo board is a link` test still holds — a button is not an anchor —
and is the guard that keeps this from regressing into a route.

- [ ] **Step 6: Run everything**

```bash
pnpm exec vitest run > /tmp/c3-unit.log 2>&1; echo "UNIT=$?"; tail -6 /tmp/c3-unit.log
pnpm exec playwright test e2e/demo.spec.ts --reporter=line > /tmp/c3-e2e.log 2>&1; echo "E2E=$?"; tail -10 /tmp/c3-e2e.log
pnpm typecheck > /tmp/c3-tc.log 2>&1; echo "TYPECHECK=$?"
pnpm lint > /tmp/c3-lint.log 2>&1; echo "LINT=$?"
pnpm build > /tmp/c3-build.log 2>&1; echo "BUILD=$?"
```

Expected: all EXIT=0, with the e2e collected count matching the run count.

- [ ] **Step 7: Commit**

```bash
git add components/board components/demo e2e/demo.spec.ts
git commit -m "feat: open a card on the demo board"
```

### Task C4: Documentation and the pull request

- [ ] **Step 1: Update `CLAUDE.md`**

Under **Layout**, beside the `(demo)` entry added in Task A6, note that the demo's card is local
state rather than the intercepting route, and why:

```
                            # its card opens from local state, not the
                            # intercept: a demo card has no URL to share
```

- [ ] **Step 2: Tick every Section C box, and commit**

```bash
git add CLAUDE.md docs/plans/demo-board.md
git commit -m "docs: record the demo card"
git push -u origin feat/demo-board-card
```

- [ ] **Step 3: Open the PR, then stop**

`gh pr create --base main --title "feat: demo board Section C — the card"`, with observed exit
codes and screenshots of an open demo card in both themes.

---

## Whole-branch verification, before the last PR is called done

Run by the final review, per `CLAUDE.md`'s model table — Opus, reading the branch against the spec,
this plan and `CLAUDE.md` at once.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, exit codes read directly.
- [ ] `pnpm test:e2e`, with the number that ran compared against the number collected.
- [ ] A signed-out browser at `/` drags a card, and a reload puts it back — by hand, not only in
      Playwright.
- [ ] The network panel shows no server-action request and no Pusher connection while dragging.
- [ ] `/` at 360px shows one column and the switcher, with the bar's note truncated to `Demo`.
- [ ] Both themes, by hand.
- [ ] A signed-in browser at `/` still lands on `/boards`.
- [ ] No file added under `app/(demo)/`, `components/demo/` or `lib/demo-board.ts` imports
      `lib/db`, `lib/permissions`, or any module under `lib/actions/`:

```bash
grep -rn "lib/db\|lib/permissions\|lib/actions" "app/(demo)" components/demo lib/demo-board.ts; echo "EXIT=$? (1 means clean)"
```

- [ ] Screenshots attached to each PR.
