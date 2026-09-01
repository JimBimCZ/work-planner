# Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people on one board see each other's changes without reloading.

**Architecture:** One Pusher private channel per board. Every mutating server action publishes after its transaction commits. A `RealtimeProvider` in the board layout holds the single connection and fans events out to the board canvas and the open card, which dispatch them into the reducer `lib/board-state.ts` already has. Clients ignore their own changes by matching a client-minted `mutationId` echoed in the payload.

**Tech Stack:** Pusher Channels (`pusher` server SDK, `pusher-js` v8 client), Next.js 16 App Router, TypeScript strict, Zod, Vitest, Playwright.

**Spec:** `docs/specs/realtime.md`

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include this section.

- **This sub-project changes no database schema.** No migration is generated, and `pnpm db:generate` is never run. If a task seems to need a column, stop — the design deliberately avoids one.
- **`publish()` is called after the transaction commits, never inside it.** A rolled-back write that already announced itself puts every other client into a state the database disagrees with.
- **`publish()` never throws.** The write has already committed; a Pusher failure must not turn a successful action into a failed one.
- **`publish()` no-ops when server credentials are absent.** This is what keeps self-hosting working.
- **Payload ceiling is 8,192 bytes** measured with `Buffer.byteLength` on the serialised event. Pusher's documented limit is 10KB and answers more with a 413.
- **Every server action independently re-checks permission** via `lib/permissions.ts`. The proxy is routing, not authorisation. This includes `/api/pusher/auth` and the new `readBoard`.
- **`lib/events.ts` is server-only**, exactly as `lib/permissions.ts` is: it imports the `pusher` server SDK. A `'use client'` file may import **types** from it (`import type` is erased) but never a value. `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass on a violation — only `pnpm build` catches it.
- **No module-level Pusher client.** `CLAUDE.md` permits exactly one module-level singleton and `lib/db/index.ts` spends it. The Pusher server SDK is a stateless HTTPS REST wrapper holding no sockets, so it is constructed per call and costs nothing to re-create.
- **No new state library.** No TanStack Query, no Zustand. Server state lives on the server; local UI state uses `useState`/`useReducer`.
- **Vitest runs in the `node` environment** (`vitest.config.mts`), so there is no DOM and no React component testing. Client behaviour is proved by Playwright, never by a unit test.
- **Read the real exit code.** A shell pipeline exits with the status of its last command. Redirect to a file and echo `$?`:
  `pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/e2e.log`
- **Copy rules.** Active voice, sentence case, no filler, no apologies. A control says what happens.
- **Colour rules.** The teammate ring uses the actor's avatar hue from `lib/avatar.ts` — cool half of the wheel only. Nothing warm is added; warm is due dates and destructive actions only.

## Prerequisites — do these before Section 1

These are outside the plan's code and block the e2e from being meaningful.

- [x] **Confirm the Pusher app exists and the credentials are real.** `.env` already carries a numeric `PUSHER_APP_ID` with a 20-character key and secret and a 2-character cluster, which look like a provisioned app, but nothing in this repository has ever called Pusher. Prove it with a real trigger before building on it — Task 1's manual check does this.
- [x] **Add the four variables to the Vercel project** (Production, Preview and Development): `PUSHER_APP_ID`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`.
- [x] **Add them as GitHub Actions secrets and wire them into `.github/workflows/ci.yml`.** The CI job currently has no Pusher variables at all, so without this every realtime e2e skips itself and the suite is theatre. Note that `NEXT_PUBLIC_PUSHER_KEY` is inlined at build time and Playwright's `webServer` runs `pnpm build && pnpm start`, so it must be present as a **build-time** environment variable in CI, not only at run time.

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `lib/events.ts` | The `BoardEvent` union, `channelFor`, the Pusher server client factory, and `publish`. Server-only. |
| `lib/events.test.ts` | Payload shaping, the byte ceiling, the credential no-op, and that publish never throws. |
| `app/api/pusher/auth/route.ts` | Private-channel authorisation. Re-derives the user from the session and the board from the channel name. |
| `app/api/pusher/auth/route.test.ts` | The four refusals and the one success. |
| `components/board/realtime.tsx` | `RealtimeProvider`, `useRealtime`. One connection, handler fan-out, `claim()`, reconnect signal. |
| `lib/actions/board.ts` | `readBoard` — the one new server action, a permission-checking read for reconnect. |
| `lib/actions/board.test.ts` | Its refusals. |
| `e2e/realtime.spec.ts` | Two browser contexts on one board. The only honest test of this sub-project. |

**Modified:**

| File | Change |
|---|---|
| `package.json` | Add `pusher` and `pusher-js`. |
| `lib/actions/cards.ts` | `mutationId` on five schemas; `publish` after each transaction. |
| `lib/actions/columns.ts` | `mutationId` on four schemas; `publish` after each transaction. |
| `lib/actions/comments.ts` | `mutationId` on three schemas; `publish` after each transaction. |
| `lib/actions/*.test.ts` | Every call site gains a `mutationId`; new assertions on what was published. |
| `lib/board-state.ts` | Two new actions: `card.patch` and `board.reseed`. |
| `lib/board-state.test.ts` | Their tests. |
| `app/(app)/(board)/boards/[boardId]/layout.tsx` | Wrap in `RealtimeProvider`. |
| `components/board/board-canvas.tsx` | Subscribe, apply events, hold ring state, handle reconnect. |
| `components/board/board-card.tsx` | Render the ring. |
| `components/board/card-body.tsx` | Subscribe for its own card; dirty-field rule; deleted-card treatment. |
| `components/board/card-comments.tsx` | Subscribe for its own card's comments. |
| `components/board/board-actions.tsx` | `registerPatchCard` routes through the reducer's new `card.patch`. |
| `.env.example` | The four Pusher variables. |
| `docker-compose.yml` | The four Pusher variables, documented as optional. |
| `.github/workflows/ci.yml` | The four Pusher variables from secrets. |
| `CLAUDE.md` | Add `comment.updated` and `comment.deleted` to the event list. |

---

## Section 1 — The transport, proved end to end on one event

`lib/events.ts`, `/api/pusher/auth`, `RealtimeProvider`, and exactly one event — `card.moved` — wired from a server action to a second browser.

Everything after this section is repetition of a path this section proves. It goes first because **a subscription that silently fails to authorise looks exactly like an app with no realtime configured — which is also its correct behaviour.** Proving the difference once, early, is what stops that ambiguity contaminating six later sections.

### Task 1: `lib/events.ts`

**Files:**
- Create: `lib/events.ts`
- Create: `lib/events.test.ts`
- Modify: `package.json` (add `pusher`)

**Interfaces:**
- Consumes: nothing.
- Produces: `type BoardEvent` (the full union, though only `card.moved` is published this section); `PAYLOAD_CEILING: number`; `channelFor(boardId: string): string`; `pusherServer(): Pusher | null`; `publish(boardId: string, event: BoardEvent): Promise<void>`.

- [x] **Step 1: Add the server SDK**

```bash
pnpm add pusher
```

- [x] **Step 2: Write the failing test**

Create `lib/events.test.ts`. The Pusher SDK is mocked so nothing leaves the machine; `publish` reads credentials from `process.env` **at call time**, not at module load, which is what makes these tests possible.

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const trigger = vi.fn();
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger;
    authorizeChannel = vi.fn();
  },
}));

const { PAYLOAD_CEILING, channelFor, publish } = await import('./events');

const CREDENTIALS = {
  PUSHER_APP_ID: '1234567',
  PUSHER_SECRET: 'secret',
  NEXT_PUBLIC_PUSHER_KEY: 'key',
  NEXT_PUBLIC_PUSHER_CLUSTER: 'eu',
};

const moved = {
  type: 'card.moved',
  mutationId: 'm1',
  actorId: 'user-1',
  id: 'card-1',
  columnId: 'col-2',
  rank: 'a1',
} as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  trigger.mockReset();
  trigger.mockResolvedValue(undefined);
  saved = { ...process.env };
  Object.assign(process.env, CREDENTIALS);
});

afterEach(() => {
  for (const key of Object.keys(CREDENTIALS)) delete process.env[key];
  Object.assign(process.env, saved);
});

test('the channel is private and names the board', () => {
  expect(channelFor('b1')).toBe('private-board-b1');
});

describe('publish', () => {
  test('triggers on the board channel, using the event type as the event name', async () => {
    await publish('b1', moved);
    expect(trigger).toHaveBeenCalledWith('private-board-b1', 'card.moved', moved);
  });

  test('does nothing when the credentials are absent', async () => {
    delete process.env.PUSHER_APP_ID;
    await publish('b1', moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  test('does nothing when only some credentials are present', async () => {
    delete process.env.PUSHER_SECRET;
    await publish('b1', moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  // The write has already committed by the time publish runs. Throwing here
  // would turn a successful action into a failed one.
  test('swallows a transport failure', async () => {
    trigger.mockRejectedValue(new Error('network'));
    await expect(publish('b1', moved)).resolves.toBeUndefined();
  });

  test('refuses to send a payload over the ceiling', async () => {
    const huge = { ...moved, rank: 'x'.repeat(PAYLOAD_CEILING) };
    await publish('b1', huge as unknown as typeof moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  test('the ceiling leaves headroom under Pusher documented 10KB limit', () => {
    expect(PAYLOAD_CEILING).toBeLessThan(10 * 1024);
  });
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm test lib/events.test.ts`
Expected: FAIL — `Cannot find module './events'`.

- [x] **Step 4: Write the implementation**

Create `lib/events.ts`:

```ts
import Pusher from 'pusher';

// Pusher's REST API answers anything over 10KB with a 413. The gap is headroom
// for the envelope Pusher wraps around the payload; the number is asserted in
// lib/events.test.ts rather than trusted.
export const PAYLOAD_CEILING = 8_192;

type Envelope = { mutationId: string; actorId: string };

export type BoardEvent = Envelope &
  (
    | {
        type: 'card.created';
        id: string;
        columnId: string;
        title: string;
        rank: string;
        createdAt: string;
        dueDate: string | null;
      }
    | {
        type: 'card.updated';
        id: string;
        title: string;
        dueDate: string | null;
        descriptionChanged: boolean;
      }
    | { type: 'card.moved'; id: string; columnId: string; rank: string }
    | { type: 'card.deleted'; id: string }
    | { type: 'column.created'; id: string; name: string; rank: string }
    | { type: 'column.updated'; id: string; name: string }
    | { type: 'column.moved'; id: string; rank: string }
    | {
        type: 'column.deleted';
        id: string;
        targetColumnId: string;
        cards: { id: string; columnId: string; rank: string }[];
      }
    | {
        type: 'comment.created';
        id: string;
        cardId: string;
        body: string;
        createdAt: string;
        author: { id: string; name: string | null; image: string | null } | null;
      }
    | { type: 'comment.created.truncated'; id: string; cardId: string }
    | { type: 'comment.updated'; id: string; cardId: string; body: string; updatedAt: string }
    | { type: 'comment.deleted'; id: string; cardId: string }
  );

export const channelFor = (boardId: string) => `private-board-${boardId}`;

// Built per call rather than held at module scope. CLAUDE.md permits exactly
// one module-level singleton and lib/db/index.ts spends it; this SDK is a
// stateless HTTPS wrapper holding no sockets, so re-creating it costs nothing.
export function pusherServer(): Pusher | null {
  const appId = process.env.PUSHER_APP_ID;
  const secret = process.env.PUSHER_SECRET;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !secret || !key || !cluster) return null;
  return new Pusher({ appId, key, secret, cluster, useTLS: true });
}

export async function publish(boardId: string, event: BoardEvent): Promise<void> {
  const client = pusherServer();
  if (!client) return;

  const bytes = Buffer.byteLength(JSON.stringify(event));
  if (bytes > PAYLOAD_CEILING) {
    // Reaching here is a payload bug, not a user error. Sending it would earn a
    // 413; dropping it loses one update, which is the lesser failure.
    console.error(`[events] ${event.type} is ${bytes}B, over the ${PAYLOAD_CEILING}B ceiling`);
    return;
  }

  try {
    await client.trigger(channelFor(boardId), event.type, event);
  } catch (error) {
    console.error('[events] publish failed', error);
  }
}
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/events.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 6: Prove the credentials are real, by hand**

The unit tests mock the SDK, so they prove the shape and nothing about the account. Run this once, read the output, then delete the file:

```bash
cat > pusher-probe.mjs <<'EOF'
import { existsSync, readFileSync } from 'node:fs';
import Pusher from 'pusher';
const seen = new Set(Object.keys(process.env));
for (const file of ['.env', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !seen.has(m[1])) process.env[m[1]] = m[2];
  }
}
const client = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  useTLS: true,
});
console.log(await client.trigger('private-board-probe', 'probe', { ok: true }));
EOF
node pusher-probe.mjs; echo "EXIT=$?"
rm pusher-probe.mjs
```

Expected: a `200` status object. A `401` means the key, secret or cluster is wrong — **stop and fix the credentials before continuing**, because every later section assumes this works. Record the observed status in the PR body.

- [x] **Step 7: Commit**

```bash
git add lib/events.ts lib/events.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add lib/events.ts, the board event contract and publisher"
```

### Task 2: `/api/pusher/auth`

**Files:**
- Create: `app/api/pusher/auth/route.ts`
- Create: `app/api/pusher/auth/route.test.ts`

**Interfaces:**
- Consumes: `pusherServer` and `channelFor` from `lib/events.ts`; `auth` from `lib/auth.ts`; `assertBoardAccess` and `BoardAccessError` from `lib/permissions.ts`.
- Produces: `POST(request: Request): Promise<Response>` at `/api/pusher/auth`, returning `{ auth: string }` on success, 400 on a malformed request (missing or non-string form fields), and 403 on every access refusal.

- [x] **Step 1: Write the failing test**

Create `app/api/pusher/auth/route.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const authorizeChannel = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, pusherServer: () => ({ authorizeChannel }) };
});

const { POST } = await import('./route');
const { BoardAccessError } = await import('@/lib/permissions');

const BOARD = '4f1c2a90-8b3d-4e6f-9a12-7c5d8e0b3a44';

function request(body: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  return new Request('http://localhost/api/pusher/auth', { method: 'POST', body: form });
}

const valid = { socket_id: '123.456', channel_name: `private-board-${BOARD}` };

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  authorizeChannel.mockReset();
  authorizeChannel.mockReturnValue({ auth: 'key:signature' });
});

test('authorises a member of the board', async () => {
  const response = await POST(request(valid));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ auth: 'key:signature' });
  expect(authorizeChannel).toHaveBeenCalledWith('123.456', `private-board-${BOARD}`);
});

// viewer is the floor: CLAUDE.md grants viewers read and comment, so they
// belong on the channel.
test('asks for viewer, not member', async () => {
  await POST(request(valid));
  expect(assertBoardAccess).toHaveBeenCalledWith('user-1', BOARD, 'viewer');
});

test('refuses without a session', async () => {
  authMock.mockResolvedValue(null);
  expect((await POST(request(valid))).status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

test('refuses a board the user is not a member of', async () => {
  assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
  expect((await POST(request(valid))).status).toBe(403);
  expect(authorizeChannel).not.toHaveBeenCalled();
});

// The channel name is client input. It is parsed before anything is looked up,
// so a malformed name never reaches the database.
test('refuses a channel name that is not a board channel', async () => {
  const response = await POST(request({ ...valid, channel_name: 'private-secrets' }));
  expect(response.status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

test('refuses a presence channel for the same board', async () => {
  const response = await POST(request({ ...valid, channel_name: `presence-board-${BOARD}` }));
  expect(response.status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

// Defence in depth rather than a known exploit: the auth string Pusher signs is
// socket_id:channel_name, so the socket id is not a free-form field.
test('refuses a malformed socket id', async () => {
  const response = await POST(request({ ...valid, socket_id: '1.1:private-board-other' }));
  expect(response.status).toBe(403);
  expect(authorizeChannel).not.toHaveBeenCalled();
});

test('refuses a request with no form fields', async () => {
  const response = await POST(
    new Request('http://localhost/api/pusher/auth', { method: 'POST', body: new FormData() }),
  );
  expect(response.status).toBe(400);
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test app/api/pusher/auth/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [x] **Step 3: Write the route**

Create `app/api/pusher/auth/route.ts`:

```ts
import { auth } from '@/lib/auth';
import { channelFor, pusherServer } from '@/lib/events';
import { assertBoardAccess } from '@/lib/permissions';

// The board id is a uuid, and the name must be exactly the channel this app
// publishes to — not a prefix match, and not a presence channel.
const BOARD_CHANNEL =
  /^private-board-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// Pusher socket ids are two decimal runs joined by a dot. Pusher signs
// `socket_id:channel_name`, so this field is not free-form text.
const SOCKET_ID = /^\d+\.\d+$/;

const forbidden = () => new Response('Forbidden', { status: 403 });

export async function POST(request: Request) {
  const form = await request.formData();
  const socketId = form.get('socket_id');
  const channelName = form.get('channel_name');

  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) return forbidden();

  if (!SOCKET_ID.test(socketId)) return forbidden();

  const match = BOARD_CHANNEL.exec(channelName);
  if (!match) return forbidden();

  const boardId = match[1];
  if (channelName !== channelFor(boardId)) return forbidden();

  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch {
    return forbidden();
  }

  const client = pusherServer();
  if (!client) return forbidden();

  return Response.json(client.authorizeChannel(socketId, channelName));
}
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `pnpm test app/api/pusher/auth/route.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Commit**

```bash
git add app/api/pusher/auth
git commit -m "feat: authorise the board channel from the session, not the request"
```

### Task 3: `RealtimeProvider`, and the board layout that holds it

**Files:**
- Create: `components/board/realtime.tsx`
- Modify: `app/(app)/(board)/boards/[boardId]/layout.tsx`
- Create: `e2e/realtime.spec.ts`
- Modify: `package.json` (add `pusher-js`)
- Modify: `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `type BoardEvent` from `lib/events.ts` — **`import type` only**. `lib/events.ts` imports the `pusher` server SDK; importing a *value* from it here would pull that into the browser bundle and break `pnpm build`, which is the only check that catches it.
- Produces: `RealtimeProvider({ boardId, children })`; `useRealtime(): { subscribe: (h: (e: BoardEvent) => void) => () => void; status: 'off' | 'connecting' | 'subscribed' | 'failed' }`. Later sections add `claim()` (Section 2) and `reconnected` (Section 4) to the same context.

- [x] **Step 1: Add the client SDK**

```bash
pnpm add pusher-js
```

- [x] **Step 2: Write the failing test**

Create `e2e/realtime.spec.ts`. This is the first test in the suite that needs real credentials, so it declares that dependency loudly rather than passing vacuously.

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

// playwright.config.ts loads .env and .env.local into process.env before this
// runs. Without credentials the app is correctly non-realtime, so these tests
// would pass vacuously — skipping says so instead of pretending.
const configured = Boolean(
  process.env.PUSHER_APP_ID &&
    process.env.PUSHER_SECRET &&
    process.env.NEXT_PUBLIC_PUSHER_KEY &&
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
);

test.skip(!configured, 'Pusher credentials are not configured');

test.afterAll(async () => {
  await closeSeedPool();
});

test('a board subscribes to its own private channel', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);
    // Subscription is asynchronous and authorises over /api/pusher/auth, so
    // reaching "subscribed" proves the route signed the channel.
    await expect(page.locator('[data-realtime]')).toHaveAttribute(
      'data-realtime',
      'subscribed',
      { timeout: 15_000 },
    );
  } finally {
    await removeSeededUser(userId);
  }
});

test('a board the user cannot read never subscribes', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Private');
  await page.context().clearCookies();
  const outsider = await seedSession(context);

  try {
    // The board 404s for an outsider, so there is no canvas to subscribe. The
    // channel refusal is asserted directly against the route instead.
    const response = await page.request.post('/api/pusher/auth', {
      form: { socket_id: '123.456', channel_name: `private-board-${boardId}` },
    });
    expect(response.status()).toBe(403);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(outsider.userId);
  }
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log`
Expected: FAIL — no element matches `[data-realtime]`.

- [x] **Step 4: Write the provider**

Create `components/board/realtime.tsx`:

```tsx
'use client';

import Pusher from 'pusher-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// import type, not import. lib/events.ts pulls in the pusher server SDK; a
// value import here would put it in the browser bundle and only pnpm build
// would notice. See CLAUDE.md on lib/permissions.ts, which has the same shape.
import type { BoardEvent } from '@/lib/events';

type Handler = (event: BoardEvent) => void;
type Status = 'off' | 'connecting' | 'subscribed' | 'failed';

const EVENT_NAMES: BoardEvent['type'][] = [
  'card.created',
  'card.updated',
  'card.moved',
  'card.deleted',
  'column.created',
  'column.updated',
  'column.moved',
  'column.deleted',
  'comment.created',
  'comment.created.truncated',
  'comment.updated',
  'comment.deleted',
];

const RealtimeContext = createContext<{
  subscribe: (handler: Handler) => () => void;
  status: Status;
} | null>(null);

export function RealtimeProvider({
  boardId,
  children,
}: {
  boardId: string;
  children: React.ReactNode;
}) {
  // A ref, not state: adding a handler must not re-render the provider and
  // tear down the connection every time the modal opens over the board.
  const handlers = useRef(new Set<Handler>());
  const [status, setStatus] = useState<Status>('off');

  useEffect(() => {
    // Referenced literally, never destructured off process.env: Next inlines
    // NEXT_PUBLIC_* by textual substitution at build time, and a destructured
    // read is not substituted.
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    // No credentials is a supported configuration, not an error: the app is
    // simply not realtime, which is what self-hosting without Pusher gets.
    if (!key || !cluster) return;

    setStatus('connecting');
    const pusher = new Pusher(key, {
      cluster,
      channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' },
    });

    const name = `private-board-${boardId}`;
    const channel = pusher.subscribe(name);
    channel.bind('pusher:subscription_succeeded', () => setStatus('subscribed'));
    channel.bind('pusher:subscription_error', () => setStatus('failed'));

    const fanOut = (event: BoardEvent) => {
      for (const handler of handlers.current) handler(event);
    };
    for (const eventName of EVENT_NAMES) channel.bind(eventName, fanOut);

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(name);
      pusher.disconnect();
      setStatus('off');
    };
  }, [boardId]);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({ subscribe, status }), [subscribe, status]);

  return (
    <RealtimeContext.Provider value={value}>
      <div className="contents" data-realtime={status}>
        {children}
      </div>
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime used outside RealtimeProvider');
  return context;
}
```

- [x] **Step 5: Wire it into the board layout**

In `app/(app)/(board)/boards/[boardId]/layout.tsx`, import `RealtimeProvider` and wrap the existing `BoardActionsProvider`. It goes here and nowhere else: this layout is the only shared parent of the board page, the canonical card page and the `@card` slot, so one connection serves all three.

```tsx
import { RealtimeProvider } from '@/components/board/realtime';
```

```tsx
  return (
    <RealtimeProvider boardId={boardId}>
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
          {card}
        </div>
      </BoardActionsProvider>
    </RealtimeProvider>
  );
```

- [x] **Step 6: Add the four variables everywhere they belong**

`.env.example` already lists all four — confirm with `grep -i pusher .env.example` and add any that are missing, values empty.

`docker-compose.yml`, in the `app` service's `environment` block, with a comment saying they are optional:

```yaml
      # Optional. Without them the app runs correctly with no realtime, which is
      # the supported self-hosting configuration. NEXT_PUBLIC_PUSHER_KEY is
      # inlined at build time, so realtime needs it as a build argument, not
      # only here.
      PUSHER_APP_ID: ${PUSHER_APP_ID:-}
      PUSHER_SECRET: ${PUSHER_SECRET:-}
      NEXT_PUBLIC_PUSHER_KEY: ${NEXT_PUBLIC_PUSHER_KEY:-}
      NEXT_PUBLIC_PUSHER_CLUSTER: ${NEXT_PUBLIC_PUSHER_CLUSTER:-}
```

`.github/workflows/ci.yml`, in the job-level `env:` block, so they are present for both `pnpm build` and `pnpm test:e2e`:

```yaml
      PUSHER_APP_ID: ${{ secrets.PUSHER_APP_ID }}
      PUSHER_SECRET: ${{ secrets.PUSHER_SECRET }}
      NEXT_PUBLIC_PUSHER_KEY: ${{ secrets.NEXT_PUBLIC_PUSHER_KEY }}
      NEXT_PUBLIC_PUSHER_CLUSTER: ${{ secrets.NEXT_PUBLIC_PUSHER_CLUSTER }}
```

- [x] **Step 7: Run the tests and watch them pass**

```bash
pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Expected: EXIT=0, 2 passed. **If they report as skipped, the credentials are not in your environment** — fix that before continuing, because a skipped realtime test proves nothing.

- [x] **Step 8: Commit**

```bash
git add components/board/realtime.tsx "app/(app)/(board)/boards/[boardId]/layout.tsx" e2e/realtime.spec.ts package.json pnpm-lock.yaml .env.example docker-compose.yml .github/workflows/ci.yml
git commit -m "feat: hold one board channel subscription in the board layout"
```

### Task 4: `card.moved`, from the action to a second browser

**Files:**
- Modify: `lib/actions/cards.ts` (`moveSchema`, `moveCard`)
- Modify: `lib/actions/cards.test.ts`
- Modify: `components/board/board-canvas.tsx`
- Modify: `e2e/realtime.spec.ts`

**Interfaces:**
- Consumes: `publish` and `type BoardEvent` from `lib/events.ts`; `useRealtime` from `components/board/realtime.tsx`.
- Produces: `moveCard` requires `mutationId: string` in its input and publishes `card.moved`. Every later action follows this exact shape.

- [x] **Step 1: Write the failing test**

In `lib/actions/cards.test.ts`, add the publish mock beside the existing mocks at the top of the file:

```ts
const publish = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
});
```

and reset it in the existing `beforeEach`:

```ts
  publish.mockReset();
  publish.mockResolvedValue(undefined);
```

Then add to the existing `describe('moveCard', ...)`:

```ts
  test('requires a mutationId', async () => {
    await expect(
      moveCard({ cardId: 'card-1', toColumnId: 'col-1', beforeCardId: null, afterCardId: null }),
    ).resolves.toEqual({ ok: false, error: 'INVALID' });
  });

  test('publishes card.moved on the board, carrying the server rank', async () => {
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-1',
      beforeCardId: null,
      afterCardId: null,
      mutationId: 'm1',
    });

    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.moved',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'card-1',
      columnId: 'col-1',
      rank: expect.any(String),
    });
  });

  // The event announces a write that happened. Announcing a rejected one puts
  // every other client into a state the database disagrees with.
  test('publishes nothing when the move is refused', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await moveCard({
      cardId: 'card-1',
      toColumnId: 'col-1',
      beforeCardId: null,
      afterCardId: null,
      mutationId: 'm1',
    });
    expect(publish).not.toHaveBeenCalled();
  });
```

Every existing `moveCard(...)` call in this file now needs `mutationId: 'm1'` added, except the ones asserting `INVALID` on other grounds.

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: FAIL — `publish` is not called; `mutationId` is accepted where it should be required.

- [x] **Step 3: Publish from `moveCard`**

In `lib/actions/cards.ts`, add the import:

```ts
import { publish } from '@/lib/events';
```

extend the schema:

```ts
const moveSchema = z.object({
  cardId: id,
  toColumnId: id,
  beforeCardId: id.nullable(),
  afterCardId: id.nullable(),
  mutationId: id,
});
```

and publish after the transaction, between `revalidatePath` and the return:

```ts
  if (rank === null) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  // After the commit, never inside it: a rolled-back write that already
  // announced itself leaves every other client ahead of the database.
  await publish(boardId, {
    type: 'card.moved',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: cardId,
    columnId: toColumnId,
    rank,
  });
  return { ok: true, data: { rank } } as const;
```

- [x] **Step 4: Apply the event on the canvas**

In `components/board/board-canvas.tsx`, import `useRealtime`, mint a `mutationId` in `moveCardTo`, and subscribe.

```ts
import { useRealtime } from '@/components/board/realtime';
```

In the component body, beside the other hooks:

```ts
  const { subscribe } = useRealtime();
```

`moveCardTo` passes a fresh id — echo suppression arrives in Section 2, and until then the mover receives its own event and re-applies the move with the server's rank, which is idempotent and settles the optimistic value:

```ts
    return run(
      { type: 'card.move', cardId: card.id, toColumnId, rank: ranksAfter(last?.rank ?? null, 1)[0] },
      () =>
        moveCard({
          cardId: card.id,
          toColumnId,
          beforeCardId: last?.id ?? null,
          afterCardId: null,
          mutationId: crypto.randomUUID(),
        }),
      'That card could not be moved. Try again.',
    );
```

And the subscription, after the existing effects:

```ts
  // Remote events take the same reducer path a local mutation does. There is
  // no second state tree, and no second set of rules about ordering.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'card.moved') {
          dispatch({
            type: 'card.move',
            cardId: event.id,
            toColumnId: event.columnId,
            rank: event.rank,
          });
        }
      }),
    [subscribe],
  );
```

- [x] **Step 5: Extend the e2e to two browser contexts**

Add to `e2e/realtime.spec.ts`. **One browser proves nothing about this sub-project**: the whole claim is that a change in one session reaches another.

```ts
test('a card moved in one browser moves in another, with no reload', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const alice = await seedSession(contextA);
  const boardId = await seedBoard(alice.userId, 'Roadmap');
  const bob = await seedSession(contextB);
  await seedMember(boardId, bob.userId, 'member');
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await pageA.goto(`/boards/${boardId}`);
    await pageB.goto(`/boards/${boardId}`);
    // Both must be subscribed before the move, or the test races the socket.
    for (const page of [pageA, pageB]) {
      await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
        timeout: 15_000,
      });
    }

    await expect(
      pageB.locator(`[data-column-id="${ready.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();

    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).hover();
    await pageA.getByRole('button', { name: 'Card actions' }).click();
    await pageA.getByRole('menuitem', { name: inProgress.name }).click();

    // B is never reloaded. If this passes after a reload it proves nothing.
    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await removeSeededUser(alice.userId);
    await removeSeededUser(bob.userId);
  }
});
```

The exact selectors for moving a card from the menu must match `components/board/card-menu.tsx`. Read that file and correct them rather than assuming; if the menu names differ, the test is wrong, not the component.

- [x] **Step 6: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e2e.log
```

Expected: all 0. `pnpm build` matters here specifically — it is the check that catches `components/board/realtime.tsx` importing a value rather than a type from `lib/events.ts`.

- [x] **Step 7: Commit**

```bash
git add lib/actions/cards.ts lib/actions/cards.test.ts components/board/board-canvas.tsx e2e/realtime.spec.ts
git commit -m "feat: publish card.moved and apply it on another browser board"
```

### Section 1 gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, each exit code read from its own redirected log, count run compared against count collected.
- [x] **The realtime e2e ran rather than skipped.** A skipped realtime test is indistinguishable from a passing one in the summary line, and proves nothing. Confirm the count went up.
- [x] The Pusher credentials were proved with a real trigger (Task 1, Step 6) and the observed status code is in the PR body.
- [x] `/api/pusher/auth` refuses a board the caller is not a member of, **asserted by calling the route directly**, not by the UI declining to subscribe.
- [ ] Two real browsers, side by side, show one moving a card the other did not touch — observed by hand as well as in Playwright.
- [x] With `PUSHER_APP_ID` and `NEXT_PUBLIC_PUSHER_KEY` removed from the environment, the board still loads, still moves cards, and `[data-realtime]` reads `off`. This is the self-hosting configuration.
- [x] Open the PR. Stop. Start Section 2 in a fresh session.

---

## Section 2 — `mutationId` through the twelve remaining actions

Wide, mechanical and dull, which is exactly why it is its own PR: smeared through the others it would make each one unreviewable. Nothing user-visible changes — every event published here is consumed in Section 3.

Every action takes the same three edits: a `mutationId: z.uuid()` line in its Zod schema, a `publish(...)` call between `revalidatePath('/boards')` and the return, and `mutationId` added to each of its existing call sites in the test file.

**Learned in Section 1, and it applies to all eleven remaining actions:** making
`mutationId` required breaks every *caller* that does not send one, and an action
usually has more than one. `moveCard` had two — the card menu's `moveCardTo` and
the drag handler's own call in `onDragEnd` — and Task 4's own snippet only fixed
the first, which would have left every real drag failing `INVALID` while the
menu path passed. Before ticking any task in this section, grep the client for
every call site of the action you just changed, not only the one the task names.

### Task 5: The five remaining card actions

**Files:**
- Modify: `lib/actions/cards.ts`
- Modify: `lib/actions/cards.test.ts`
- Modify: `components/board/board-canvas.tsx`, `components/board/card-body.tsx` (call sites)

**Interfaces:**
- Consumes: `publish` from `lib/events.ts`.
- Produces: `createCard`, `renameCard`, `setCardDescription`, `setCardDueDate` and `deleteCard` all require `mutationId: string` and publish. `createCard` now also returns `createdAt` in its data, which Section 3's `card.created` needs on the client.

- [x] **Step 1: Write the failing tests**

Add to `lib/actions/cards.test.ts`, inside the matching `describe` blocks. The `publish` mock and its `beforeEach` reset were added in Section 1, Task 4.

```ts
// createCard
  test('publishes card.created with the row the server actually wrote', async () => {
    await createCard({ columnId: 'col-1', title: 'Ship it', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.created',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'card-1',
      columnId: 'col-1',
      title: 'Ship it',
      rank: expect.any(String),
      createdAt: expect.any(String),
      dueDate: null,
    });
  });

// renameCard
  test('publishes card.updated, and does not claim the description changed', async () => {
    await renameCard({ cardId: 'card-1', title: 'Shipped', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.updated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'card-1',
      title: 'Shipped',
      dueDate: null,
      descriptionChanged: false,
    });
  });

// setCardDescription
  // The flag, not the text: a 10,000-character description cannot fit under
  // Pusher's 10KB limit in any encoding, so it is never in a payload.
  test('publishes card.updated with descriptionChanged and no description text', async () => {
    await setCardDescription({ cardId: 'card-1', description: 'x'.repeat(9_000), mutationId: 'm1' });
    const [, event] = publish.mock.calls[0];
    expect(event).toMatchObject({ type: 'card.updated', descriptionChanged: true });
    expect(JSON.stringify(event)).not.toContain('xxxx');
  });

// setCardDueDate
  test('publishes card.updated carrying the due date as a calendar date', async () => {
    await setCardDueDate({ cardId: 'card-1', dueDate: '2026-09-10', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.updated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'card-1',
      title: expect.any(String),
      dueDate: '2026-09-10',
      descriptionChanged: false,
    });
  });

// deleteCard
  test('publishes card.deleted', async () => {
    await deleteCard({ cardId: 'card-1', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'card.deleted',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'card-1',
    });
  });
```

Add one `requires a mutationId` case per action, in the shape Section 1 used for `moveCard`, and add `mutationId: 'm1'` to every existing call in the file that is not asserting `INVALID`.

The `cardRow` fixture at the top of the file must grow the fields the events read, so update it and its `beforeEach`:

```ts
let cardRow:
  | { id: string; boardId: string; columnId: string; rank: string; title: string; dueDate: Date | null }
  | undefined;
```

```ts
  cardRow = {
    id: 'card-1',
    boardId: 'b1',
    columnId: 'col-1',
    rank: 'a0',
    title: 'Ship it',
    dueDate: null,
  };
```

- [x] **Step 2: Run them and watch them fail**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: FAIL — `publish` not called.

- [x] **Step 3: Add `mutationId` to the schemas**

In `lib/actions/cards.ts`:

```ts
const createSchema = z.object({ columnId: id, title: cardTitle, mutationId: id });
const renameSchema = z.object({ cardId: id, title: cardTitle, mutationId: id });
const deleteSchema = z.object({ cardId: id, mutationId: id });
const descriptionSchema = z.object({
  cardId: id,
  description: z.string().trim().max(10_000),
  mutationId: id,
});
const dueDateSchema = z.object({ cardId: id, dueDate: z.string().nullable(), mutationId: id });
```

- [x] **Step 4: Publish from each action**

`createCard` — the transaction already `.returning()`s the row, so widen what it returns and publish it:

```ts
    await touchBoard(tx, boardId);
    return { id: row.id, rank, createdAt: row.createdAt.toISOString() };
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.created',
    mutationId: parsed.data.mutationId,
    actorId: createdById,
    id: created.id,
    columnId: parsed.data.columnId,
    title: parsed.data.title,
    rank: created.rank,
    createdAt: created.createdAt,
    dueDate: null,
  });
  return { ok: true, data: created } as const;
```

`renameCard`, `setCardDescription` and `setCardDueDate` all publish `card.updated`, which carries the card's *current* title and due date rather than only the field that changed. Each already reads the card through `boardIdForCard`; replace that with a single read that returns the fields the event needs. In `lib/actions/scope.ts`, add:

```ts
// card.updated carries the card's whole small surface, not just the field that
// changed, so a client can apply it without asking a second question. The
// description is deliberately absent: it cannot fit in a payload.
export async function cardEventScope(
  cardId: string,
): Promise<{ boardId: string; title: string; dueDate: Date | null } | null> {
  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, cardId),
    columns: { boardId: true, title: true, dueDate: true },
  });
  return card ?? null;
}
```

Then in `renameCard`, replace `const boardId = await boardIdForCard(...)` with:

```ts
  const card = await cardEventScope(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;
  const boardId = card.boardId;
```

and publish after the transaction:

```ts
  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: parsed.data.title,
    dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
    descriptionChanged: false,
  });
  return { ok: true } as const;
```

`setCardDescription` — same `cardEventScope` swap, then:

```ts
  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: card.title,
    dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
    descriptionChanged: true,
  });
  return { ok: true } as const;
```

`setCardDueDate` — same swap, then:

```ts
  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: card.title,
    dueDate: parsed.data.dueDate,
    descriptionChanged: false,
  });
  return { ok: true } as const;
```

`toDateInputValue` is already imported in this module's sibling `lib/due.ts`; add it to the existing `import { fromDateInputValue } from '@/lib/due';` line.

`deleteCard`:

```ts
  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
  });
  return { ok: true } as const;
```

- [x] **Step 5: Fix every call site**

`components/board/board-canvas.tsx`: `createCard`, `renameCard`, `deleteCard` and the column actions all need `mutationId: crypto.randomUUID()`. `components/board/card-body.tsx`: `renameCard`, `setCardDescription`, `setCardDueDate`. Find them with:

```bash
grep -rn "createCard(\|renameCard(\|deleteCard(\|setCardDescription(\|setCardDueDate(" components/ app/
```

- [x] **Step 6: Run the tests and watch them pass**

Run: `pnpm test lib/actions/cards.test.ts` then `pnpm typecheck`
Expected: both PASS. **`typecheck` does not find a missed call site** — every action takes
`input: unknown`, so a call with no `mutationId` type-checks and fails at runtime with `INVALID`.
Grep for the call sites instead, as the note at the top of this section says.

- [x] **Step 7: Commit**

```bash
git add lib/actions/cards.ts lib/actions/cards.test.ts lib/actions/scope.ts components/board
git commit -m "feat: publish every card mutation"
```

### Task 6: The four column actions

**Files:**
- Modify: `lib/actions/columns.ts`, `lib/actions/columns.test.ts`, `components/board/board-canvas.tsx`

**Interfaces:**
- Produces: `addColumn`, `renameColumn`, `moveColumn`, `deleteColumn` require `mutationId` and publish. `deleteColumn`'s transaction now returns the moved cards so the event can carry them.

- [x] **Step 1: Write the failing tests**

Add the same `publish` mock and reset to `lib/actions/columns.test.ts` as Section 1 added to the cards test, then:

```ts
// addColumn
  test('publishes column.created', async () => {
    await addColumn({ boardId: 'b1', name: 'Blocked', afterColumnId: null, mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.created',
      mutationId: 'm1',
      actorId: 'user-1',
      id: expect.any(String),
      name: 'Blocked',
      rank: expect.any(String),
    });
  });

// renameColumn
  test('publishes column.updated', async () => {
    await renameColumn({ columnId: 'col-1', name: 'Doing', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.updated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'col-1',
      name: 'Doing',
    });
  });

// moveColumn
  test('publishes column.moved with the server rank', async () => {
    await moveColumn({
      columnId: 'col-1',
      beforeColumnId: null,
      afterColumnId: null,
      mutationId: 'm1',
    });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.moved',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'col-1',
      rank: expect.any(String),
    });
  });

// deleteColumn
  // The cards do not disappear; they move. The event carries where they went,
  // because the transaction computed exactly that and the client cannot.
  test('publishes column.deleted carrying every card it moved', async () => {
    await deleteColumn({ columnId: 'col-1', targetColumnId: 'col-2', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'column.deleted',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'col-1',
      targetColumnId: 'col-2',
      cards: expect.any(Array),
    });
  });

  test('publishes nothing when the column is the last one', async () => {
    // Arrange a single-column board with the fixture this file already uses.
    await deleteColumn({ columnId: 'col-1', targetColumnId: 'col-2', mutationId: 'm1' });
    expect(publish).not.toHaveBeenCalled();
  });
```

The last test needs the file's `siblingColumns` fixture set to one column; follow whatever the existing `refuses to delete the last column` test does to arrange that, and mirror it.

- [x] **Step 2: Run them and watch them fail**

Run: `pnpm test lib/actions/columns.test.ts`
Expected: FAIL.

- [x] **Step 3: Add `mutationId` to the schemas**

```ts
const addSchema = z.object({
  boardId: id,
  name: columnName,
  afterColumnId: id.nullable(),
  mutationId: id,
});
const renameSchema = z.object({ columnId: id, name: columnName, mutationId: id });
const moveSchema = z.object({
  columnId: id,
  beforeColumnId: id.nullable(),
  afterColumnId: id.nullable(),
  mutationId: id,
});
const deleteSchema = z.object({ columnId: id, targetColumnId: id, mutationId: id });
```

- [x] **Step 4: Publish from each action**

`addColumn`, after `revalidatePath('/boards')`, using whatever the transaction already returns for the new id and rank:

```ts
  await publish(boardId, {
    type: 'column.created',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: created.id,
    name: parsed.data.name,
    rank: created.rank,
  });
```

`renameColumn`:

```ts
  await publish(boardId, {
    type: 'column.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.columnId,
    name: parsed.data.name,
  });
```

`moveColumn`:

```ts
  await publish(boardId, {
    type: 'column.moved',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.columnId,
    rank,
  });
```

`deleteColumn` needs its transaction to hand back the cards it moved. Change the two `return 'OK' as const;` path so the transaction returns the moved rows:

```ts
    for (const [position, card] of moving.entries()) {
      await tx
        .update(cards)
        .set({ columnId: targetColumnId, rank: ranks[position] })
        .where(eq(cards.id, card.id));
    }

    await tx.delete(columns).where(eq(columns.id, columnId));
    await touchBoard(tx, boardId);
    return {
      outcome: 'OK' as const,
      cards: moving.map((card, position) => ({
        id: card.id,
        columnId: targetColumnId,
        rank: ranks[position],
      })),
    };
  });

  if (outcome === 'LAST_COLUMN' || outcome === 'INVALID') {
    return { ok: false, error: outcome } as const;
  }

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'column.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: columnId,
    targetColumnId,
    cards: outcome.cards,
  });
  return { ok: true } as const;
```

The two early returns inside the transaction stay as the bare strings `'LAST_COLUMN'` and `'INVALID'`, so the discriminant above works.

- [x] **Step 5: Fix the call sites and run**

Add `mutationId: crypto.randomUUID()` to the four column calls in `components/board/board-canvas.tsx`.

Run: `pnpm test lib/actions/columns.test.ts` then `pnpm typecheck`
Expected: both PASS.

- [x] **Step 6: Commit**

```bash
git add lib/actions/columns.ts lib/actions/columns.test.ts components/board/board-canvas.tsx
git commit -m "feat: publish every column mutation"
```

### Task 7: The three comment actions

**Files:**
- Modify: `lib/actions/comments.ts`, `lib/actions/comments.test.ts`, `components/board/card-comments.tsx`

**Interfaces:**
- Produces: `addComment`, `editComment`, `deleteComment` require `mutationId` and publish. `addComment` returns `createdAt` alongside `id`.

- [x] **Step 1: Write the failing tests**

Add the `publish` mock and reset to `lib/actions/comments.test.ts`, then:

```ts
// addComment
  test('publishes comment.created with the body and the author', async () => {
    await addComment({ cardId: 'card-1', body: 'Looks right', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'comment.created',
      mutationId: 'm1',
      actorId: 'user-1',
      id: expect.any(String),
      cardId: 'card-1',
      body: 'Looks right',
      createdAt: expect.any(String),
      author: { id: 'user-1', name: expect.anything(), image: expect.anything() },
    });
  });

// editComment
  test('publishes comment.updated', async () => {
    await editComment({ commentId: 'comment-1', body: 'Rewritten', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'comment.updated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'comment-1',
      cardId: expect.any(String),
      body: 'Rewritten',
      updatedAt: expect.any(String),
    });
  });

// deleteComment
  test('publishes comment.deleted', async () => {
    await deleteComment({ commentId: 'comment-1', mutationId: 'm1' });
    expect(publish).toHaveBeenCalledWith('b1', {
      type: 'comment.deleted',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'comment-1',
      cardId: expect.any(String),
    });
  });

  // Authorship, not access: a member who is not the author is refused, and a
  // refused write announces nothing.
  test('publishes nothing when the caller is not the author', async () => {
    authMock.mockResolvedValue({ user: { id: 'someone-else' } });
    await expect(
      editComment({ commentId: 'comment-1', body: 'Mine now', mutationId: 'm1' }),
    ).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(publish).not.toHaveBeenCalled();
  });
```

- [x] **Step 2: Run them and watch them fail**

Run: `pnpm test lib/actions/comments.test.ts`
Expected: FAIL.

- [x] **Step 3: Add `mutationId` and publish**

Schemas:

```ts
const addSchema = z.object({ cardId: id, body, mutationId: id });
const editSchema = z.object({ commentId: id, body, mutationId: id });
const deleteSchema = z.object({ commentId: id, mutationId: id });
```

`addComment` — widen what the transaction returns, and publish the author from the session rather than a second query:

```ts
    await touchBoard(tx, boardId);
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'comment.created',
    mutationId: parsed.data.mutationId,
    actorId: authorId,
    id: created.id,
    cardId: parsed.data.cardId,
    body: parsed.data.body,
    createdAt: created.createdAt,
    author: {
      id: authorId,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    },
  });
  return { ok: true, data: created } as const;
```

`editComment` and `deleteComment` both already resolve `commentScope`, which gives them `boardId`; extend `commentScope` in `lib/actions/scope.ts` to return `cardId` too, since the event needs it to reach the right thread:

```ts
export async function commentScope(
  commentId: string,
): Promise<{ boardId: string; cardId: string; authorId: string | null } | null> {
  const comment = await db.query.comments.findFirst({
    where: (c, { eq: is }) => is(c.id, commentId),
    columns: { authorId: true, cardId: true },
    with: { card: { columns: { boardId: true } } },
  });

  return comment
    ? { boardId: comment.card.boardId, cardId: comment.cardId, authorId: comment.authorId }
    : null;
}
```

Then publish, after each `revalidatePath('/boards')`:

```ts
  // editComment
  await publish(scope.boardId, {
    type: 'comment.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.commentId,
    cardId: scope.cardId,
    body: parsed.data.body,
    updatedAt: new Date().toISOString(),
  });
```

```ts
  // deleteComment
  await publish(scope.boardId, {
    type: 'comment.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.commentId,
    cardId: scope.cardId,
  });
```

- [x] **Step 4: Fix the call sites and run**

Add `mutationId: crypto.randomUUID()` to the three calls in `components/board/card-comments.tsx`.

Run: `pnpm test lib/actions/comments.test.ts` then `pnpm typecheck`
Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add lib/actions/comments.ts lib/actions/comments.test.ts lib/actions/scope.ts components/board/card-comments.tsx
git commit -m "feat: publish every comment mutation"
```

### Task 8: `claim()`, so a client ignores its own change

**Files:**
- Modify: `components/board/realtime.tsx`, `components/board/board-canvas.tsx`, `e2e/realtime.spec.ts`

**Interfaces:**
- Produces: `useRealtime()` gains `claim(): string`, which mints a `mutationId` and records it. A handler passed to `subscribe` is never invoked for an event whose `mutationId` was claimed by this client.

- [x] **Step 1: Write the failing test**

Add to `e2e/realtime.spec.ts`:

```ts
test('a client does not re-apply its own move', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
      timeout: 15_000,
    });

    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).hover();
    await page.getByRole('button', { name: 'Card actions' }).click();
    await page.getByRole('menuitem', { name: inProgress.name }).click();

    // Long enough for the echo to have arrived and been ignored.
    await page.waitForTimeout(3_000);

    // Exactly one card, in exactly one column. A re-applied echo would show up
    // as a duplicate or as a card that bounced back.
    await expect(page.locator(`[data-card-id="${cardId}"]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await removeSeededUser(userId);
  }
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log`

Expected: this test may pass by luck before `claim` exists, because re-applying `card.move` with the server's own rank is idempotent. **That is not a reason to skip the step.** Confirm the mechanism directly instead: temporarily log in the canvas subscription and observe the client receiving its own event.

- [x] **Step 3: Add `claim` to the provider**

In `components/board/realtime.tsx`:

```tsx
// Bounded: an echo arrives within milliseconds of its action resolving, so the
// window only has to outlive one round trip. Unbounded, this would grow for as
// long as the board stays open.
const CLAIM_MEMORY = 50;
```

Inside `RealtimeProvider`, beside `handlers`:

```tsx
  const claimed = useRef<string[]>([]);

  const claim = useCallback(() => {
    const mutationId = crypto.randomUUID();
    claimed.current.push(mutationId);
    if (claimed.current.length > CLAIM_MEMORY) claimed.current.shift();
    return mutationId;
  }, []);
```

and filter in `fanOut`:

```tsx
    const fanOut = (event: BoardEvent) => {
      // Our own change is already applied optimistically. Applying the echo as
      // well would fight the optimistic update rather than confirm it.
      const index = claimed.current.indexOf(event.mutationId);
      if (index !== -1) {
        claimed.current.splice(index, 1);
        return;
      }
      for (const handler of handlers.current) handler(event);
    };
```

Add `claim` to the context type and to the `useMemo` value.

- [x] **Step 4: Use it at every call site**

Replace every `mutationId: crypto.randomUUID()` added in Tasks 5–7 with `mutationId: claim()`, taking `claim` from `useRealtime()` in `board-canvas.tsx`, `card-body.tsx` and `card-comments.tsx`.

```bash
grep -rn "crypto.randomUUID()" components/board/
```

Every remaining hit should be a temporary optimistic id (`tmp-${crypto.randomUUID()}`), not a `mutationId`.

- [x] **Step 5: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e2e.log
```

- [x] **Step 6: Commit**

```bash
git add components/board e2e/realtime.spec.ts
git commit -m "feat: let a client recognise and ignore its own change"
```

### Section 2 gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [x] **All thirteen actions require a `mutationId`** and every one refuses without it. Confirm by count, not by reading: `grep -c "mutationId: z.uuid()" lib/actions/*.ts` totals 13 across cards, columns and comments — 6 + 4 + 3. The plan said twelve and `mutationId: id`; both were wrong. Twelve counted the actions *remaining* after Section 1 did `moveCard`, and `id` (any non-empty string) would have undone Section 1's own fix, which bound `moveCard`'s to a UUID so an oversized value cannot push the published event over `PAYLOAD_CEILING` and drop it silently. The same reason applies to all thirteen, so all thirteen are `z.uuid()`.
- [x] **Every action publishes after its transaction and not inside it**, and a refused action publishes nothing — asserted per action, not assumed.
- [x] No `mutationId: crypto.randomUUID()` survives in `components/`; every one goes through `claim()`.
- [x] Nothing user-visible changed. Say so in the PR: the events are published but only `card.moved` is consumed, and Section 3 is what consumes the rest.
- [x] Open the PR (#60). Stop. Start Section 3 in a fresh session.

---

## Section 3 — The canvas converges with a teammate

Everything published in Section 2 gets a consumer here, so the board itself is fully realtime by the end of it. The open card is Section 5's.

### Task 9: `card.patch` in the reducer

**Files:**
- Modify: `lib/board-state.ts`, `lib/board-state.test.ts`
- Modify: `components/board/board-canvas.tsx`

**Interfaces:**
- Produces: `BoardAction` gains `{ type: 'card.patch'; cardId: string; title?: string; dueDate?: string | null }`, handled by `boardReducer` and given a real entry in `inverse`.

- [x] **Step 1: Write the failing test**

Add to `lib/board-state.test.ts`:

```ts
describe('card.patch', () => {
  const base: BoardState = {
    columns: [{ id: 'col-1', name: 'Ready', rank: 'a0' }],
    cards: [
      {
        id: 'card-1',
        columnId: 'col-1',
        title: 'Ship it',
        rank: 'a0',
        createdAt: '2026-08-31T00:00:00.000Z',
        dueDate: '2026-09-10',
      },
    ],
  };

  test('sets the title alone, leaving the due date untouched', () => {
    const next = boardReducer(base, { type: 'card.patch', cardId: 'card-1', title: 'Shipped' });
    expect(next.cards[0]).toMatchObject({ title: 'Shipped', dueDate: '2026-09-10' });
  });

  test('sets the due date alone, leaving the title untouched', () => {
    const next = boardReducer(base, { type: 'card.patch', cardId: 'card-1', dueDate: null });
    expect(next.cards[0]).toMatchObject({ title: 'Ship it', dueDate: null });
  });

  // An absent key and an explicit null mean different things: one says "leave
  // it", the other says "clear it". A shallow spread would conflate them.
  test('an absent key is not a null', () => {
    const next = boardReducer(base, { type: 'card.patch', cardId: 'card-1', title: 'Shipped' });
    expect(next.cards[0].dueDate).toBe('2026-09-10');
  });

  test('a card that is not there changes nothing', () => {
    expect(boardReducer(base, { type: 'card.patch', cardId: 'gone', title: 'x' })).toEqual(base);
  });

  test('its inverse restores both fields from the pre-state', () => {
    const action: BoardAction = { type: 'card.patch', cardId: 'card-1', title: 'Shipped' };
    const undone = applyAll(boardReducer(base, action), inverse(base, action));
    expect(undone.cards[0]).toMatchObject({ title: 'Ship it', dueDate: '2026-09-10' });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/board-state.test.ts`
Expected: FAIL — `card.patch` is not in the `BoardAction` union.

- [x] **Step 3: Add the action**

In `lib/board-state.ts`, extend the union:

```ts
  | { type: 'card.patch'; cardId: string; title?: string; dueDate?: string | null }
```

the reducer, beside `card.rename`:

```ts
    // An absent key leaves the field alone; an explicit null clears it. Those
    // are different instructions, so neither is spread in blindly.
    case 'card.patch':
      return mapCard(state, action.cardId, (card) => ({
        ...card,
        ...(action.title !== undefined ? { title: action.title } : {}),
        ...(action.dueDate !== undefined ? { dueDate: action.dueDate } : {}),
      }));
```

and `inverse`:

```ts
    case 'card.patch': {
      const card = state.cards.find((c) => c.id === action.cardId);
      if (!card) return [];
      return [
        { type: 'card.patch', cardId: action.cardId, title: card.title, dueDate: card.dueDate },
      ];
    }
```

- [x] **Step 4: Route the modal's patch through it**

In `components/board/board-canvas.tsx`, the `registerPatchCard` effect currently dispatches two actions. Collapse it:

```ts
  useEffect(() => {
    registerPatchCard((cardId, patch) => dispatch({ type: 'card.patch', cardId, ...patch }));
    return () => registerPatchCard(null);
  }, [registerPatchCard]);
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test lib/board-state.test.ts` then `pnpm test`
Expected: both PASS.

- [x] **Step 6: Commit**

```bash
git add lib/board-state.ts lib/board-state.test.ts components/board/board-canvas.tsx
git commit -m "feat: give the reducer one card patch action"
```

### Task 10: The canvas applies every card and column event

**Files:**
- Modify: `components/board/board-canvas.tsx`
- Modify: `e2e/realtime.spec.ts`

**Interfaces:**
- Consumes: `type BoardEvent` from `lib/events.ts`, `useRealtime` from `components/board/realtime.tsx`.
- Produces: nothing new; the board simply converges.

- [x] **Step 1: Write the failing test**

Add to `e2e/realtime.spec.ts`. A helper keeps the two-context setup from being written five times:

```ts
async function twoBrowsers(browser: Browser, name = 'Roadmap') {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const alice = await seedSession(contextA);
  const boardId = await seedBoard(alice.userId, name);
  const bob = await seedSession(contextB);
  await seedMember(boardId, bob.userId, 'member');
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto(`/boards/${boardId}`);
  await pageB.goto(`/boards/${boardId}`);
  for (const page of [pageA, pageB]) {
    await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
      timeout: 15_000,
    });
  }

  const close = async () => {
    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await removeSeededUser(alice.userId);
    await removeSeededUser(bob.userId);
  };

  return { boardId, alice, bob, pageA, pageB, close };
}
```

Import `type Browser` from `@playwright/test`. Then:

```ts
test('a card added in one browser appears in the other', async ({ browser }) => {
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);

  try {
    await pageA.locator(`[data-column-id="${ready.id}"]`).getByRole('button', { name: 'Add card' }).click();
    await pageA.getByRole('textbox', { name: 'Card title' }).fill('From Alice');
    await pageA.getByRole('button', { name: 'Add card' }).last().click();

    await expect(pageB.getByTestId('card-title').filter({ hasText: 'From Alice' })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a card renamed in one browser is renamed in the other', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageA.reload();
    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).dblclick();
    await pageA.getByRole('textbox').fill('Shipped');
    await pageA.getByRole('textbox').press('Enter');

    await expect(pageB.getByTestId('card-title').filter({ hasText: 'Shipped' })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a card deleted in one browser disappears from the other', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageA.reload();
    await expect(pageB.locator(`[data-card-id="${cardId}"]`)).toBeVisible();

    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).hover();
    await pageA.getByRole('button', { name: 'Card actions' }).click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('button', { name: 'Delete card' }).click();

    await expect(pageB.locator(`[data-card-id="${cardId}"]`)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await close();
  }
});

test('a column added in one browser appears in the other', async ({ browser }) => {
  const { pageA, pageB, close } = await twoBrowsers(browser);

  try {
    await expect(pageB.locator('[data-column-id]')).toHaveCount(5);

    await pageA.getByRole('button', { name: 'Column actions' }).first().click();
    await pageA.getByRole('menuitem', { name: 'Add column after' }).click();
    await pageA.getByRole('textbox').fill('Blocked');
    await pageA.getByRole('textbox').press('Enter');

    await expect(pageB.locator('[data-column-id]')).toHaveCount(6, { timeout: 15_000 });
    await expect(pageB.getByText('Blocked')).toBeVisible();
  } finally {
    await close();
  }
});

// The cards do not vanish with the column; they move. Asserting the count on
// the target column is what distinguishes "applied" from "dropped".
test('a column deleted in one browser moves its cards in the other', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageA.reload();
    await pageA
      .locator(`[data-column-id="${ready.id}"]`)
      .getByRole('button', { name: 'Column actions' })
      .click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('combobox').selectOption(inProgress.id);
    await pageA.getByRole('button', { name: 'Delete column' }).click();

    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(pageB.locator(`[data-column-id="${ready.id}"]`)).toHaveCount(0);
  } finally {
    await close();
  }
});
```

**Every selector above must be checked against the real components** — `components/board/add-card.tsx`, `card-menu.tsx`, `column-menu.tsx` and `delete-column-dialog.tsx` — and corrected to match. If a name differs, the test is wrong, not the component.

- [x] **Step 2: Run them and watch them fail**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/e2e.log`
Expected: FAIL — B never converges, because only `card.moved` has a consumer.

- [x] **Step 3: Apply every event on the canvas**

Replace the single-event subscription from Section 1, Task 4 with the full handler:

```ts
  // Remote events take the same reducer path a local mutation does. There is no
  // second state tree and no second set of ordering rules. Events this client
  // caused never arrive here — the provider filters them by mutationId.
  useEffect(
    () =>
      subscribe((event) => {
        switch (event.type) {
          case 'card.created':
            dispatch({
              type: 'card.create',
              card: {
                id: event.id,
                columnId: event.columnId,
                title: event.title,
                rank: event.rank,
                createdAt: event.createdAt,
                dueDate: event.dueDate,
              },
            });
            return;
          case 'card.updated':
            // The card face shows a title and a due date and nothing else, so
            // descriptionChanged is not its business — that is the open card's.
            dispatch({
              type: 'card.patch',
              cardId: event.id,
              title: event.title,
              dueDate: event.dueDate,
            });
            return;
          case 'card.moved':
            dispatch({
              type: 'card.move',
              cardId: event.id,
              toColumnId: event.columnId,
              rank: event.rank,
            });
            return;
          case 'card.deleted':
            dispatch({ type: 'card.delete', cardId: event.id });
            return;
          case 'column.created':
            dispatch({
              type: 'column.create',
              column: { id: event.id, name: event.name, rank: event.rank },
            });
            return;
          case 'column.updated':
            dispatch({ type: 'column.rename', columnId: event.id, name: event.name });
            return;
          case 'column.moved':
            dispatch({ type: 'column.move', columnId: event.id, rank: event.rank });
            return;
          case 'column.deleted':
            dispatch({
              type: 'column.delete',
              columnId: event.id,
              targetColumnId: event.targetColumnId,
              ranks: event.cards.map((card) => card.rank),
            });
            return;
          default:
            // Comment events belong to the open card, not the canvas.
            return;
        }
      }),
    [subscribe],
  );
```

Confirm against `lib/board-state.ts` that `column.delete`'s `ranks` is the list of new ranks for the moving cards in the order the reducer expects. If the reducer needs the cards themselves rather than bare ranks, pass `event.cards` and adjust — read the reducer, do not guess.

- [x] **Step 4: Run them and watch them pass**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log`
Expected: EXIT=0.

- [x] **Step 5: Run everything**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e2e.log
```

- [x] **Step 6: Commit**

```bash
git add components/board/board-canvas.tsx e2e/realtime.spec.ts
git commit -m "feat: converge the board canvas on a teammate's changes"
```

### Section 3 gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [x] Every card and column event has a consumer, proved by a two-context e2e each — **none of which reloads the receiving page.** A reload would make all of them pass with no realtime at all.
- [x] A column deleted remotely moves its cards rather than dropping them, asserted on the target column.
- [x] Dragging still works, and `e2e/board-dnd.spec.ts` passes unchanged.
- [ ] Open the PR with a screen recording or paired screenshots of two windows. Stop. Start Section 4 in a fresh session.

---

## Section 4 — Reconnect

Pusher does not replay. A client that was asleep reconnects to a board that has moved on, and nothing so far tells it.

### Task 11: `readBoard`, and `board.reseed`

**Files:**
- Create: `lib/actions/board.ts`, `lib/actions/board.test.ts`
- Modify: `lib/board-state.ts`, `lib/board-state.test.ts`

**Interfaces:**
- Consumes: `getBoardWithColumns` from `lib/boards.ts`, which returns `BoardWithCards | null` and is wrapped in React's `cache`. Note the mismatch between the function name and the type name — the function is `getBoardWithColumns`.
- Produces: `readBoard(input: unknown)` returning `{ ok: true, data: BoardState } | { ok: false, error: ... }`; `BoardAction` gains `{ type: 'board.reseed'; state: BoardState }`.

- [x] **Step 1: Write the failing tests**

`lib/board-state.test.ts`:

```ts
describe('board.reseed', () => {
  test('replaces the whole state', () => {
    const before: BoardState = {
      columns: [{ id: 'col-1', name: 'Ready', rank: 'a0' }],
      cards: [],
    };
    const after: BoardState = {
      columns: [{ id: 'col-2', name: 'Doing', rank: 'a1' }],
      cards: [],
    };
    expect(boardReducer(before, { type: 'board.reseed', state: after })).toEqual(after);
  });

  test('its inverse restores the state it replaced', () => {
    const before: BoardState = {
      columns: [{ id: 'col-1', name: 'Ready', rank: 'a0' }],
      cards: [],
    };
    const action: BoardAction = {
      type: 'board.reseed',
      state: { columns: [], cards: [] },
    };
    expect(applyAll(boardReducer(before, action), inverse(before, action))).toEqual(before);
  });
});
```

`lib/actions/board.test.ts` — copy the mock preamble from `lib/actions/cards.test.ts` (the `auth`, `next/cache`, `@/lib/permissions` and `@/lib/db` mocks) and add:

```ts
test('refuses without a session', async () => {
  authMock.mockResolvedValue(null);
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({
    ok: false,
    error: 'UNAUTHENTICATED',
  });
});

// A reconnect is not a reason to trust a boardId from a client. The proxy is
// routing, not authorisation.
test('refuses a board the caller is not a member of', async () => {
  assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
  await expect(readBoard({ boardId: 'b1' })).resolves.toEqual({ ok: false, error: 'FORBIDDEN' });
});

test('asks for viewer, since reading is all it does', async () => {
  await readBoard({ boardId: 'b1' });
  expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
});

test('publishes nothing — it is a read', async () => {
  await readBoard({ boardId: 'b1' });
  expect(publish).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `pnpm test lib/board-state.test.ts lib/actions/board.test.ts`
Expected: FAIL on both.

- [x] **Step 3: Add `board.reseed`**

In `lib/board-state.ts`, extend the union with `| { type: 'board.reseed'; state: BoardState }`, add to the reducer:

```ts
    case 'board.reseed':
      return action.state;
```

and to `inverse`:

```ts
    case 'board.reseed':
      return [{ type: 'board.reseed', state }];
```

- [x] **Step 4: Write `readBoard`**

Create `lib/actions/board.ts`. Read `lib/boards.ts` first and reuse its existing board read and the shape `components/board/board-canvas.tsx`'s `seed()` builds, so one mapping exists rather than two.

```ts
'use server';

import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { toBoardState } from '@/lib/board-state';

const schema = z.object({ boardId: z.string().min(1) });

// A read, not a mutation: it publishes nothing and takes no mutationId. It
// exists so a client that missed events while disconnected can catch up.
export async function readBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  const board = await getBoardWithColumns(parsed.data.boardId);
  if (!board) return { ok: false, error: 'NOT_FOUND' } as const;

  return { ok: true, data: toBoardState(board) } as const;
}
```

Move `seed()` out of `board-canvas.tsx` into `lib/board-state.ts` as an exported `toBoardState(board)`, so the initial render and the reconnect build the same shape from the same code. Update `board-canvas.tsx`'s `useReducer` to use it, and delete the now-stale comment that says "There is no realtime in this sub-project, so the reducer is the truth for the session".

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add lib/actions/board.ts lib/actions/board.test.ts lib/board-state.ts lib/board-state.test.ts components/board/board-canvas.tsx
git commit -m "feat: add a permission-checking board read for catching up"
```

### Task 12: Refetch on reconnect, deferred while busy

**Files:**
- Modify: `components/board/realtime.tsx`, `components/board/board-canvas.tsx`, `e2e/realtime.spec.ts`

**Interfaces:**
- Produces: `useRealtime()` gains `reconnected: number`, a counter that increments on every `connected` **after** the first. Consumers watch it as an effect dependency.

- [x] **Step 1: Write the failing test**

Add to `e2e/realtime.spec.ts`. The gap is forced by taking the socket down, changing the board from the other browser while it is down, and bringing it back:

```ts
test('a client that missed events catches up on reconnect', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageA.reload();
    await pageB.reload();
    await expect(pageB.locator(`[data-column-id="${ready.id}"] [data-card-id="${cardId}"]`)).toBeVisible();

    // Take B's socket down. Offline is the honest way to do it: pusher-js sees
    // a real disconnection rather than a synthetic event.
    await pageB.context().setOffline(true);
    await expect(pageB.locator('[data-realtime]')).not.toHaveAttribute(
      'data-realtime',
      'subscribed',
      { timeout: 30_000 },
    );

    // A moves a card that B will never be told about.
    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).hover();
    await pageA.getByRole('button', { name: 'Card actions' }).click();
    await pageA.getByRole('menuitem', { name: inProgress.name }).click();
    await expect(
      pageA.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();

    await pageB.context().setOffline(false);

    // B never reloads. Converging here can only be the reconnect refetch.
    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await close();
  }
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec playwright test realtime -g "catches up" --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log`
Expected: FAIL — B stays on the stale column.

- [x] **Step 3: Signal the reconnection**

In `components/board/realtime.tsx`, inside the effect:

```tsx
  const [reconnected, setReconnected] = useState(0);
```

```tsx
    // The first `connected` is the initial connection and means nothing. Every
    // later one follows a gap in which events were missed and not replayed.
    let everConnected = false;
    pusher.connection.bind('connected', () => {
      if (everConnected) setReconnected((count) => count + 1);
      everConnected = true;
    });
```

Add `reconnected` to the context type and the `useMemo` value.

- [x] **Step 4: Refetch on the canvas, deferred while busy**

In `components/board/board-canvas.tsx`:

```ts
  const { subscribe, claim, reconnected } = useRealtime();
  const [pendingWrites, setPendingWrites] = useState(0);
  const catchUpWanted = useRef(false);
```

Wrap the two places that call actions so they count: increment before `startTransition`'s async work and decrement in a `finally`. Then:

```ts
  // Deferred while a drag or a write is in flight. Reseeding mid-gesture would
  // erase an optimistic change the server has not been told about yet; once the
  // write settles, the server's own read already contains it.
  useEffect(() => {
    if (reconnected === 0) return;
    catchUpWanted.current = true;
  }, [reconnected]);

  useEffect(() => {
    if (!catchUpWanted.current) return;
    if (draggingId || pendingWrites > 0) return;
    catchUpWanted.current = false;

    let cancelled = false;
    void readBoard({ boardId: board.id }).then((result) => {
      if (!cancelled && result.ok) dispatch({ type: 'board.reseed', state: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [reconnected, draggingId, pendingWrites, board.id]);
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log`
Expected: EXIT=0. This test is slower than the others — a real Pusher reconnection takes seconds — so its generous timeouts are deliberate, not padding.

- [x] **Step 6: Run everything, then commit**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e2e.log
```

```bash
git add components/board e2e/realtime.spec.ts
git commit -m "feat: catch up on the board after a reconnection"
```

### Section 4 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] A client that was genuinely offline converges **without a reload** — proved by `setOffline`, not by a synthetic event, and not by reloading the page.
- [ ] **A reseed does not erase an optimistic change made during the gap.** Check by hand: go offline, add a card, come back online, and confirm the card is still there once the write settles.
- [ ] A reseed never fires mid-drag.
- [ ] `readBoard` refuses a board the caller cannot read, asserted by calling it directly.
- [ ] Open the PR. Stop. Start Section 5 in a fresh session.

---

## Section 5 — The open card

`card-body.tsx` already keeps a committed value beside every draft — `savedTitle` beside `title`, `savedDescription` beside `description`, `dueDate` beside `draftDueDate`. Dirtiness is therefore already computable, and the rule this section adds is a comparison rather than new state.

### Task 13: `readCardDescription`

**Files:**
- Modify: `lib/actions/cards.ts`, `lib/actions/cards.test.ts`

**Interfaces:**
- Produces: `readCardDescription(input: unknown)` returning `{ ok: true, data: { description: string | null } } | { ok: false, error: ... }`.

- [ ] **Step 1: Write the failing test**

Add to `lib/actions/cards.test.ts`:

```ts
describe('readCardDescription', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(readCardDescription({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  // A viewer may read. This is the floor for a read, not 'member'.
  test('asks for viewer', async () => {
    await readCardDescription({ cardId: 'card-1' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a board the caller is not a member of', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(readCardDescription({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('publishes nothing — it is a read', async () => {
    await readCardDescription({ cardId: 'card-1' });
    expect(publish).not.toHaveBeenCalled();
  });
});
```

Add `readCardDescription` to the destructured import at the top of the file, and give `cardRow` a `description` field in the fixture.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test lib/actions/cards.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Write it**

In `lib/actions/cards.ts`:

```ts
const readSchema = z.object({ cardId: id });

// The one field card.updated cannot carry. A 10,000-character description does
// not fit under Pusher's 10KB limit in any encoding, so the event says that it
// changed and the open card asks for it.
export async function readCardDescription(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, parsed.data.cardId),
    columns: { boardId: true, description: true },
  });
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  return { ok: true, data: { description: card.description } } as const;
}
```

- [ ] **Step 4: Run it, then commit**

Run: `pnpm test lib/actions/cards.test.ts` — Expected: PASS.

```bash
git add lib/actions/cards.ts lib/actions/cards.test.ts
git commit -m "feat: let an open card re-read a description too big to publish"
```

### Task 14: The card body follows its card

**Files:**
- Modify: `components/board/card-body.tsx`
- Modify: `e2e/realtime.spec.ts`

**Interfaces:**
- Consumes: `useRealtime`, `readCardDescription`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `e2e/realtime.spec.ts`:

```ts
test('a title edited elsewhere lands in a field nobody is typing in', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageA.reload();
    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).dblclick();
    await pageA.getByRole('textbox').fill('Shipped');
    await pageA.getByRole('textbox').press('Enter');

    await expect(pageB.getByLabel('Card title')).toHaveValue('Shipped', { timeout: 15_000 });
  } finally {
    await close();
  }
});

// The rule this section exists for. Last-write-wins is about stored values; it
// does not license destroying text someone has not sent yet.
test('a field being typed in is not overwritten', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.getByLabel('Card title').fill('Half-written thought');

    await pageA.reload();
    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).dblclick();
    await pageA.getByRole('textbox').fill('Shipped');
    await pageA.getByRole('textbox').press('Enter');

    await pageB.waitForTimeout(3_000);
    await expect(pageB.getByLabel('Card title')).toHaveValue('Half-written thought');
  } finally {
    await close();
  }
});

test('a description edited elsewhere is refetched', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);

    await pageA.getByLabel('Description').fill('Written by Alice');
    await pageA.getByLabel('Description').blur();

    await expect(pageB.getByLabel('Description')).toHaveValue('Written by Alice', {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a card deleted elsewhere says so rather than vanishing', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageA.reload();

    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).hover();
    await pageA.getByRole('button', { name: 'Card actions' }).click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('button', { name: 'Delete card' }).click();

    await expect(pageB.getByText('This card was deleted')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByRole('link', { name: 'Back to the board' })).toBeVisible();
    // The canonical page is a route, not an overlay, so it cannot simply close.
    await expect(pageB.getByLabel('Card title')).toHaveCount(0);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/e2e.log`
Expected: FAIL on all four.

- [ ] **Step 3: Subscribe from the card body**

In `components/board/card-body.tsx`:

```ts
  const { subscribe } = useRealtime();
  const [deleted, setDeleted] = useState(false);
```

```ts
  // A field is dirty when its draft differs from the value last committed. A
  // remote value lands in any field that is not dirty and is dropped for one
  // that is: the reader keeps their text, and their own commit then wins under
  // last-write-wins exactly as it would have. This is a rule about focus, not
  // text merging.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'card.deleted' && event.id === card.id) {
          setDeleted(true);
          return;
        }
        if (event.type !== 'card.updated' || event.id !== card.id) return;

        if (title === savedTitle) {
          setTitle(event.title);
          setSavedTitle(event.title);
        }

        const remoteDue = event.dueDate;
        if (draftDueDate === (dueDate ?? '')) {
          setDueDate(remoteDue);
          setDraftDueDate(remoteDue ?? '');
          setLastDueDate(remoteDue);
        }

        if (event.descriptionChanged && description === savedDescription) {
          void readCardDescription({ cardId: card.id }).then((result) => {
            if (!result.ok) return;
            const next = result.data.description ?? '';
            setDescription(next);
            setSavedDescription(next);
          });
        }
      }),
    [
      subscribe,
      card.id,
      title,
      savedTitle,
      description,
      savedDescription,
      draftDueDate,
      dueDate,
    ],
  );
```

- [ ] **Step 4: Say so when the card is gone**

Early in `CardBody`'s render, before the fields:

```tsx
  if (deleted) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <p className="text-ink">This card was deleted.</p>
        <Link href={`/boards/${card.boardId}`} className="text-sm text-muted underline">
          Back to the board
        </Link>
      </div>
    );
  }
```

`card.boardId` is already on `CardForView`, so no new prop is needed. Match the surrounding file's spacing and token classes rather than copying these verbatim, and add the `next/link` import. The copy is sentence case, states what happened, and does not apologise.

- [ ] **Step 5: Run them and watch them pass, then run everything**

```bash
pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
```

- [ ] **Step 6: Commit**

```bash
git add components/board/card-body.tsx e2e/realtime.spec.ts
git commit -m "feat: follow a card's remote edits without clobbering a draft"
```

### Section 5 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] **A field being typed in is not overwritten**, proved in a browser as well as in Playwright. Type a sentence, have the other browser change the same field, and confirm the sentence survives.
- [ ] The same field, when *not* dirty, does take the remote value.
- [ ] A description over the payload ceiling still arrives, via the refetch and not via the event.
- [ ] The deleted-card treatment works on **both** surfaces — the modal over the board and the canonical page — since only one of them can close.
- [ ] Open the PR with screenshots of the deleted-card state in both themes. Stop. Start Section 6 in a fresh session.

---

## Section 6 — Comments in a live thread

### Task 15: `readComments`, and the degraded event

**Files:**
- Modify: `lib/actions/comments.ts`, `lib/actions/comments.test.ts`, `lib/events.ts`, `lib/events.test.ts`

**Interfaces:**
- Produces: `readComments(input: unknown)` returning the thread; `publishComment(boardId, event)` in `lib/events.ts`, which degrades an oversized `comment.created` to `comment.created.truncated`.

- [ ] **Step 1: Write the failing tests**

`lib/events.test.ts`:

```ts
describe('publishComment', () => {
  const created = {
    type: 'comment.created',
    mutationId: 'm1',
    actorId: 'user-1',
    id: 'comment-1',
    cardId: 'card-1',
    createdAt: '2026-08-31T00:00:00.000Z',
    author: { id: 'user-1', name: 'Alice', image: null },
  } as const;

  test('ships a short body inline', async () => {
    await publishComment('b1', { ...created, body: 'Looks right' });
    expect(trigger).toHaveBeenCalledWith(
      'private-board-b1',
      'comment.created',
      expect.objectContaining({ body: 'Looks right' }),
    );
  });

  // 4,000 characters is under the ceiling in ASCII and far over it in emoji.
  // The cap counts characters; the guard has to count bytes.
  test('degrades a body that is under the character cap but over the byte ceiling', async () => {
    await publishComment('b1', { ...created, body: '😀'.repeat(4_000) });
    expect(trigger).toHaveBeenCalledWith('private-board-b1', 'comment.created.truncated', {
      type: 'comment.created.truncated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'comment-1',
      cardId: 'card-1',
    });
  });

  test('a maximum-length ASCII comment still ships inline', async () => {
    await publishComment('b1', { ...created, body: 'x'.repeat(4_000) });
    expect(trigger).toHaveBeenCalledWith(
      'private-board-b1',
      'comment.created',
      expect.objectContaining({ body: 'x'.repeat(4_000) }),
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm test lib/events.test.ts`
Expected: FAIL — `publishComment` is not exported.

- [ ] **Step 3: Add the degrading publisher**

In `lib/events.ts`:

```ts
// The one place the size branch lives. Everything else in this module either
// always fits or never ships its large field at all.
export async function publishComment(
  boardId: string,
  event: Extract<BoardEvent, { type: 'comment.created' }>,
): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(event)) <= PAYLOAD_CEILING) {
    return publish(boardId, event);
  }

  return publish(boardId, {
    type: 'comment.created.truncated',
    mutationId: event.mutationId,
    actorId: event.actorId,
    id: event.id,
    cardId: event.cardId,
  });
}
```

Change `addComment` in `lib/actions/comments.ts` to call `publishComment` rather than `publish`.

- [ ] **Step 4: Add `readComments`**

In `lib/actions/comments.ts`. It reuses `getCardForView`, which already reads the thread in `(createdAt, id)` order for the card page, so there is one query rather than two:

```ts
import { getCardForView } from '@/lib/cards';

const readSchema = z.object({ cardId: id });

// Only reached when a comment was too large to publish inline. It re-reads the
// whole thread rather than one comment, because getCardForView already returns
// it in the order the component needs.
export async function readComments(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await getCardForView(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  return { ok: true, data: card.comments } as const;
}
```

And its tests, in `lib/actions/comments.test.ts`:

```ts
describe('readComments', () => {
  test('refuses without a session', async () => {
    authMock.mockResolvedValue(null);
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHENTICATED',
    });
  });

  test('asks for viewer, since reading is all it does', async () => {
    await readComments({ cardId: 'card-1' });
    expect(assertBoardAccess).toHaveBeenCalledWith('user-1', 'b1', 'viewer');
  });

  test('refuses a board the caller is not a member of', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    await expect(readComments({ cardId: 'card-1' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });

  test('publishes nothing — it is a read', async () => {
    await readComments({ cardId: 'card-1' });
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run, then commit**

```bash
pnpm test lib/events.test.ts lib/actions/comments.test.ts
git add lib/events.ts lib/events.test.ts lib/actions/comments.ts lib/actions/comments.test.ts
git commit -m "feat: degrade an oversized comment payload to a pointer"
```

### Task 16: The thread follows its card

**Files:**
- Modify: `components/board/card-comments.tsx`, `e2e/realtime.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('a comment posted elsewhere appears in an open thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);

    await pageA.getByRole('textbox', { name: 'Add a comment' }).fill('Looks right');
    await pageA.getByRole('button', { name: 'Comment' }).click();

    await expect(pageB.getByText('Looks right')).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }
});

test('a comment edited elsewhere updates in an open thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });
  await seedComment(cardId, alice.userId, 'First thought');

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);

    await pageA.getByRole('button', { name: 'Edit comment: First thought' }).click();
    await pageA.getByRole('textbox').last().fill('Second thought');
    await pageA.getByRole('button', { name: 'Save changes' }).click();

    await expect(pageB.getByText('Second thought')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('First thought')).toHaveCount(0);
  } finally {
    await close();
  }
});

test('a comment deleted elsewhere leaves the thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });
  await seedComment(cardId, alice.userId, 'Never mind');

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(pageB.getByText('Never mind')).toBeVisible();

    await pageA.getByRole('button', { name: 'Delete comment: Never mind' }).click();
    await pageA.getByRole('button', { name: 'Delete comment' }).click();

    await expect(pageB.getByText('Never mind')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await close();
  }
});
```

Import `seedComment` from `./support/session`, and check the Edit/Delete control names against `components/board/card-comments.tsx` — Section 5 of the card modal gave each a distinct label, so use the real one.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec playwright test realtime -g comment --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log`

- [ ] **Step 3: Subscribe from the thread**

In `components/board/card-comments.tsx`:

```ts
  const { subscribe, claim } = useRealtime();
```

```ts
  // Ordering is lib/comment-order.ts's job, not this component's: a remote
  // comment must land where its (createdAt, id) says, not simply at the end,
  // because an optimistic row of ours may already be sitting there.
  useEffect(
    () =>
      subscribe((event) => {
        if (!('cardId' in event) || event.cardId !== cardId) return;

        switch (event.type) {
          case 'comment.created':
            // reinsertOrdered compares createdAt as a Date; the event carries
            // an ISO string, so it is converted here rather than inside the
            // helper, which stays a pure ordering function.
            setRows((rows) =>
              reinsertOrdered(rows, {
                id: event.id,
                body: event.body,
                createdAt: new Date(event.createdAt),
                author: event.author,
              }),
            );
            return;
          case 'comment.created.truncated':
            void readComments({ cardId }).then((result) => {
              if (result.ok) setRows(result.data);
            });
            return;
          case 'comment.updated':
            setRows((rows) =>
              rows.map((row) => (row.id === event.id ? { ...row, body: event.body } : row)),
            );
            return;
          case 'comment.deleted':
            setRows((rows) => rows.filter((row) => row.id !== event.id));
            return;
          default:
            return;
        }
      }),
    [subscribe, cardId],
  );
```

`reinsertOrdered` is `lib/comment-order.ts`'s existing export, written for the rejected-delete rollback in sub-project 5; it places a row by `(createdAt, id)` and is exactly what a remote comment needs, so no new ordering code belongs here.

**A comment being edited locally is not clobbered**, by the same rule as Section 5: if `editingId === event.id`, update the stored body but leave `editDraft` alone.

- [ ] **Step 4: Run them, run everything, commit**

```bash
pnpm exec playwright test realtime --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/e2e.log
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
```

```bash
git add components/board/card-comments.tsx e2e/realtime.spec.ts
git commit -m "feat: keep an open comment thread live"
```

### Task 17: Update `CLAUDE.md`

- [ ] **Step 1: Add the two events**

In `CLAUDE.md`'s Realtime section, change the events line to name all eleven, including `comment.updated` and `comment.deleted`. `CLAUDE.md`'s own rule is that it stays current when an architectural decision changes, and the event list is one.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: name every board event, including comment edit and delete"
```

### Section 6 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] A comment, an edit and a delete each reach a second open thread with no reload.
- [ ] **A 4,000-character comment of emoji arrives**, via the degraded path — forced, not hoped for. Post one and confirm the thread updates.
- [ ] A comment being edited locally is not clobbered by a remote edit of the same comment.
- [ ] An optimistic comment and a remote one do not both appear as duplicates of each other.
- [ ] Open the PR with screenshots of a live thread in both themes. Stop. Start Section 7 in a fresh session.

---

## Section 7 — The teammate ring

The only purely presentational section. By now every event arrives and is applied, so the ring decorates a working system rather than being the thing under debug.

### Task 18: The ring

**Files:**
- Modify: `components/board/board-canvas.tsx`, `components/board/board-card.tsx`
- Modify: `app/globals.css` (the keyframe, if the codebase keeps animations there — check first)
- Modify: `e2e/realtime.spec.ts`

**Interfaces:**
- Consumes: `avatarHue` from `lib/avatar.ts`.
- Produces: `BoardCard` takes an optional `ringHue?: number`.

- [ ] **Step 1: Write the failing test**

```ts
test('a card changed by a teammate is ringed in their colour', async ({ browser }) => {
  const { boardId, alice, bob, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageA.reload();
    await pageB.reload();

    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).dblclick();
    await pageA.getByRole('textbox').fill('Shipped');
    await pageA.getByRole('textbox').press('Enter');

    const card = pageB.locator(`[data-card-id="${cardId}"]`);
    await expect(card).toHaveAttribute('data-ring-hue', /\d+/, { timeout: 15_000 });

    // Cool half of the wheel only: a warm ring would compete with the due-date
    // signal, which CLAUDE.md reserves as the only warm thing on the board.
    const hue = Number(await card.getAttribute('data-ring-hue'));
    expect(hue).toBeGreaterThanOrEqual(180);
    expect(hue).toBeLessThanOrEqual(300);

    // It is a 1.5s acknowledgement, not a persistent state.
    await expect(card).not.toHaveAttribute('data-ring-hue', /\d+/, { timeout: 10_000 });
  } finally {
    await close();
  }
});

test('the ring does not transform under reduced motion', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext({ reducedMotion: 'reduce' });
  const alice = await seedSession(contextA);
  const boardId = await seedBoard(alice.userId, 'Roadmap');
  const bob = await seedSession(contextB);
  await seedMember(boardId, bob.userId, 'member');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await pageA.goto(`/boards/${boardId}`);
    await pageB.goto(`/boards/${boardId}`);
    for (const page of [pageA, pageB]) {
      await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
        timeout: 15_000,
      });
    }

    await pageA.getByTestId('card-title').filter({ hasText: 'Ship it' }).dblclick();
    await pageA.getByRole('textbox').fill('Shipped');
    await pageA.getByRole('textbox').press('Enter');

    const card = pageB.locator(`[data-card-id="${cardId}"]`);
    await expect(card).toHaveAttribute('data-ring-hue', /\d+/, { timeout: 15_000 });

    // The ring still appears — reduced motion removes the movement, not the
    // information. CLAUDE.md: "the ring fades in and out without transform".
    const transform = await card.evaluate((node) => getComputedStyle(node).transform);
    expect(transform).toBe('none');
  } finally {
    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await removeSeededUser(alice.userId);
    await removeSeededUser(bob.userId);
  }
});
```

`twoBrowsers` is not used here because it does not take context options, and the reduced-motion preference has to be set when the context is created.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec playwright test realtime -g ring --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log`

- [ ] **Step 3: Hold ring state on the canvas**

Ring state is deliberately **not** in the reducer: it is ephemeral UI, and `lib/board-state.ts` is pure and heavily tested.

```ts
  const [rings, setRings] = useState<Map<string, number>>(new Map());
```

In the event subscription, after dispatching, for every event that names a card:

```ts
        // A quiet acknowledgement that something moved and who moved it.
        const ringed =
          event.type === 'card.created' ||
          event.type === 'card.updated' ||
          event.type === 'card.moved'
            ? event.id
            : null;

        if (ringed) {
          const hue = avatarHue(event.actorId);
          setRings((current) => new Map(current).set(ringed, hue));
          window.setTimeout(
            () =>
              setRings((current) => {
                const next = new Map(current);
                next.delete(ringed);
                return next;
              }),
            1_500,
          );
        }
```

`card.deleted` gets no ring — the card is gone, so there is nothing to ring.

- [ ] **Step 4: Render it**

Pass `ringHue={rings.get(card.id)}` down to `BoardCard`. In `components/board/board-card.tsx`, add the prop and render the ring as a box-shadow, which does not affect layout and therefore cannot reflow a column mid-drag:

```tsx
export function BoardCard({
  card,
  ringHue,
  /* the existing props stay as they are */
}: {
  card: StateCard;
  ringHue?: number;
  /* ... */
}) {
```

```tsx
    <article
      data-card-id={card.id}
      data-ring-hue={ringHue}
      style={
        ringHue === undefined
          ? undefined
          : { boxShadow: `0 0 0 2px hsl(${ringHue} 55% 55% / 0.9)` }
      }
      className={/* the existing classes, plus */ 'transition-shadow duration-200'}
    >
```

The hue comes from `avatarHue`, which is already constrained to 180°–300°, so the ring cannot stray warm and compete with the due-date signal.

Reduced motion needs no separate branch here: `box-shadow` is not a transform, and the card is not moved or scaled. Confirm that with the test rather than assuming it — if the existing card styles animate a transform on any state change, that is what the reduced-motion test will catch.

Keep it quiet. This is the one moment the board acknowledges someone else, and the design brief says chrome recedes.

- [ ] **Step 5: Run everything, then commit**

```bash
pnpm typecheck > /tmp/tc.log 2>&1; echo "TC=$?"
pnpm lint > /tmp/lint.log 2>&1; echo "LINT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST=$?"
pnpm build > /tmp/build.log 2>&1; echo "BUILD=$?"
pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "E2E=$?"; tail -3 /tmp/e2e.log
```

```bash
git add components/board e2e/realtime.spec.ts app/globals.css
git commit -m "feat: ring a card a teammate just changed, in their colour"
```

### Section 7 gate

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, exit codes read from redirected logs, count run compared against count collected.
- [ ] The ring uses the actor's avatar hue and stays on the cool half of the wheel, asserted numerically rather than by eye.
- [ ] The ring clears itself; it is an acknowledgement, not a state.
- [ ] Under `prefers-reduced-motion` there is no transform — checked with `getComputedStyle`, not by watching.
- [ ] Nothing warm was added anywhere.
- [ ] Open the PR with a screen recording of the ring. Stop.

---

## Verification — the whole sub-project

Copied from `docs/specs/realtime.md`. Tick these only against observed output, and close them in the final section's PR or a short `docs/` follow-up, as sub-projects 4 and 5 did.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass, each exit code read from its own log, count run compared against count collected.
- [ ] Two real browsers on one board show each other's changes, observed by hand and not only in Playwright.
- [ ] A client that is disconnected and reconnected converges without a reload, and does so without erasing an optimistic change made during the gap.
- [ ] `/api/pusher/auth` refuses a board the caller is not a member of — proved by calling it directly, not by the UI declining to subscribe.
- [ ] The app runs correctly with **no Pusher credentials at all**, confirmed in the Docker container, which is the configuration that has none. This is deliberately a manual check rather than an e2e: Playwright's `webServer` builds once for the whole suite and `NEXT_PUBLIC_PUSHER_KEY` is inlined at build time, so one run cannot hold both configurations. Run `docker compose up --build` with the four variables unset, confirm the board loads, a card moves, and `[data-realtime]` reads `off`.
- [ ] No payload exceeds the ceiling, including a 4,000-character comment of multibyte characters.
- [ ] A teammate's change rings the affected card in their avatar colour, and the ring does not transform under `prefers-reduced-motion`.
- [ ] **The realtime e2e ran rather than skipped, in CI as well as locally.** Compare the count collected against the count run; a skipped realtime suite is indistinguishable from a passing one in the summary line.

## What this plan deliberately does not build

Restated from the spec so it is not rediscovered as a gap mid-implementation:

- **Presence.** Who else is viewing the board. `CLAUDE.md` defers it and the ring does not need it.
- **`board.*` events.** Renaming or deleting a board does not reach a live viewer; `/boards` stays on `revalidatePath`.
- **OT, CRDT or text merging.** The dirty-field rule is about focus, not merging.
- **Replay of missed events.** Pusher does not offer it; the reconnect refetch is the whole answer.
- **A polling fallback.** `CLAUDE.md` rules it out.
- **TanStack Query.** Declined with reasons in the spec.
- **A fix for a teammate deleting the board you are viewing.** Carried forward as an open decision.
