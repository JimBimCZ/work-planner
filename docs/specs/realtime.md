# Spec: Realtime

Status: approved, not implemented
Date: 2026-08-31
Sub-project: 6 of 7

## Goal

Two people looking at the same board see the same board. A card someone else
drags moves under your cursor; their comment lands in the thread you are
reading; their edit to a title appears in the field you are not typing in. The
board stops being a snapshot of the moment you loaded it.

Sub-projects 4 and 5 built every mutation in this app as a deliberate
`publish()` call site that does not publish. This sub-project is the one that
makes them publish, and it should add no new mutations of its own.

## Non-goals

**No presence.** Who else is viewing the board is a presence channel, which
`CLAUDE.md` already defers, and the teammate ring does not need it — the actor's
id travels in the event payload, and `avatarHue` turns that into a colour.

**No `board.*` events.** Renaming or deleting a board does not reach a live
viewer. The board list stays on `revalidatePath`, which is what `CLAUDE.md`
prescribes for non-realtime surfaces and what all twelve actions already call.

**No OT, no CRDT, no text merging.** Last-write-wins on card fields, as
`CLAUDE.md` states. The one rule added here is about focus, not merging: a
remote value does not overwrite a field someone is typing in.

**No replay of missed events.** Pusher does not offer it. A client that was
disconnected refetches the board on reconnect; that is the whole answer.

**No polling fallback.** `CLAUDE.md` rules it out explicitly, and nothing here
revisits it.

**No second state library.** TanStack Query is not adopted. `CLAUDE.md` permits
it "where realtime cache reconciliation needs it"; this reads that as a
permission rather than an instruction, and declines it — see "Settled while
brainstorming".

## Deliverables

### The channel

One private channel per board, `private-board-<boardId>`, as `CLAUDE.md`
specifies. Channel names are never trusted: `/api/pusher/auth` parses the board
id out of the name and re-derives access from the session.

### `lib/events.ts`

Server-only. Exports the `BoardEvent` union and `publish(boardId, event)`.

Every event carries `mutationId` and `actorId` alongside its own fields.
`actorId` is what the teammate ring needs — `lib/avatar.ts`'s `avatarHue`
already turns a user id into a colour on the cool half of the wheel.

| Event | Payload beyond the envelope | Published by |
|---|---|---|
| `card.created` | the card: `id`, `columnId`, `title`, `rank`, `createdAt`, `dueDate` | `createCard` |
| `card.updated` | `id`, `title`, `dueDate`, `descriptionChanged` | `renameCard`, `setCardDescription`, `setCardDueDate` |
| `card.moved` | `id`, `columnId`, `rank` | `moveCard` |
| `card.deleted` | `id` | `deleteCard` |
| `column.created` | the column: `id`, `name`, `rank` | `addColumn` |
| `column.updated` | `id`, `name` | `renameColumn` |
| `column.moved` | `id`, `rank` | `moveColumn` |
| `column.deleted` | `id`, `targetColumnId`, and the moved cards' new `{ id, columnId, rank }` | `deleteColumn` |
| `comment.created` | the comment: `id`, `cardId`, `body`, `createdAt`, and the author's `id`, `name`, `image` | `addComment` |
| `comment.updated` | `id`, `cardId`, `body`, `updatedAt` | `editComment` |
| `comment.deleted` | `id`, `cardId` | `deleteComment` |

Payloads are shaped to be the `BoardAction`s `lib/board-state.ts` already takes.
`column.deleted` carries the moved cards' new ranks because the server computed
them anyway, and the reducer's `column.delete` already accepts them.

**`comment.updated` and `comment.deleted` are new to the event list.**
`CLAUDE.md` names only `comment.created`, because that list was written before
sub-project 5 added comment editing and deletion. With the card modal
subscribed, omitting them would let a live thread show text a teammate has
already rewritten, or a comment they have deleted. `CLAUDE.md`'s Realtime
section is updated in the same change.

Three rules `publish` enforces:

- **It never throws.** The transaction has committed by the time it runs, so a
  Pusher failure must not turn a successful write into a failed action. Errors
  are caught and logged.
- **It no-ops when the server credentials are absent**, which is what keeps
  self-hosting working — see "Degradation".
- **It is called after the transaction commits, never inside it.** Already
  `CLAUDE.md`'s rule. Each of the twelve actions has the seam already, since
  they all call `revalidatePath('/boards')` after their transaction.

### The 10KB budget

Pusher's REST API limits event `data` to 10KB and answers a larger payload with
a 413. `docs/specs/card-modal.md` set the description cap at 10,000 characters
and the comment cap at 4,000 *for this sub-project*, and carried forward an open
decision about whether 4,000 would hold. It does, with one correction to how it
is enforced.

The arithmetic, against the verified limit:

- A 10,000-character description is ~10,000 bytes in pure ASCII and up to 40,000
  in UTF-8. **It can never fit**, in any encoding, before the envelope is added.
- A 4,000-character comment is ~4,000 bytes in ASCII and up to ~16,000 in
  emoji or CJK. **It fits usually, not always.**

So the two get different treatment:

- **Description text is never in a payload.** `card.updated` carries a
  `descriptionChanged` boolean, not the description. This is what `CLAUDE.md`
  already prescribes; the arithmetic shows it is the only correct option rather
  than an optimisation, and it keeps one code path instead of a threshold that
  fires unpredictably.

  **A boolean rather than a timestamp, deliberately.** `cards` has no per-field
  timestamp — only `updatedAt`, which Drizzle's `$onUpdate` bumps on any write,
  so it cannot tell a description edit from a title edit and would make an open
  card refetch its description every time someone renamed the card. The writing
  action already knows which field it wrote: `setCardDescription` sets the flag,
  the other two clear it. This needs no column and therefore no migration —
  **this sub-project changes no schema at all.**
- **Comment bodies ship inline, behind a byte-measured guard.** The 4,000
  character cap stays. What changes is that the guard measures
  `Buffer.byteLength` of the serialised payload rather than counting characters.
  Over the ceiling, the event degrades to `{ id, cardId }` and the client
  refetches the thread through the same read the card page already uses. The
  size branch then exists in exactly one place.

**The ceiling is 8,192 bytes**, measured on the serialised event. That leaves
roughly 2KB under the documented limit for the envelope and Pusher's own
framing, and it is asserted by a test that builds a worst-case payload rather
than trusted.

**The card face never refetches.** It shows a title and a due date — 200
characters and a date string, both always inline. Only an open card body
refetches, only for the description, and only when `descriptionChanged` is true.

### `mutationId`

Every mutating action's Zod schema gains a required `mutationId`. The client
mints one per mutation and the server echoes it in the event, so a client can
recognise and ignore its own change.

This is `CLAUDE.md`'s stated design and it survives scrutiny. Pusher offers a
native alternative — passing `socket_id` to `trigger` excludes that connection —
but exclusion silently fails when the socket has not connected yet or has
reconnected under a new id, so a client would still need to tolerate receiving
its own events. `mutationId` is therefore the robust mechanism rather than the
expensive one, and it can also serve as the signal that settles an optimistic
value.

**This is the bulk of the diff:** twelve actions, their schemas, their unit
tests, and every call site.

### `/api/pusher/auth`

A POST route handler. It reads form-encoded `socket_id` and `channel_name`,
derives the user from `auth()` and never from the request body, parses the board
id out of the channel name, calls `assertBoardAccess(userId, boardId, 'viewer')`,
and returns `pusher.authorizeChannel(socketId, channelName)`.

`viewer` is the floor: viewers read boards and comment on them, so they belong
on the channel.

A name that does not match `private-board-<uuid>` is rejected before any
database lookup. Failure returns 403, which reaches the client as
`pusher:subscription_error`; the client binds it and stays in its non-realtime
state rather than retrying forever.

### `RealtimeProvider`

A client component in `boards/[boardId]/layout.tsx`, beside `BoardActionsProvider`.

That layout is the only shared parent of both trees that need events: it wraps
`children` — which is the board page *or* the canonical card page — and the
`@card` slot. One provider there serves the canvas and the open card without
either knowing about the other.

It opens one connection, subscribes once, and fans events out to a `Set` of
handlers held in a ref. One bind per event name, and consumers may mount and
unmount freely — which matters, because the modal opens and closes over a live
board.

**Echo suppression lives here, not in the consumers.** The provider exposes
`claim()`, which mints a `mutationId` and records it in a bounded ring of the
most recent ids. A handler is never invoked for an event whose id is claimed.
It belongs here because both trees issue mutations: the modal's field commits
and comment posts would otherwise each need their own copy of the same
bookkeeping.

### The reducer

Events dispatch into `boardReducer`, the same path a local mutation takes.
`card.moved`, `card.deleted` and `column.*` map onto actions that already exist.
Two are added to `lib/board-state.ts`:

- **`card.patch`** — sets title and/or due date in one action. It also replaces
  what `registerPatchCard` does by hand today, so a modal edit and a remote
  event take one path instead of two.
- **`board.reseed`** — replaces the whole state, for reconnect.

Ring state stays **out** of the reducer. It is ephemeral UI, and
`lib/board-state.ts` is pure and heavily tested. The canvas holds a
`Map<cardId, hue>`, populated from `avatarHue(actorId)` and cleared after 1.5s.

### Reconnect

Pusher does not replay missed messages, so a client that was asleep reconnects
to a board that has moved on.

The provider binds `pusher.connection`. The **first** `connected` is the initial
connection and means nothing; a later one, after `unavailable` or
`disconnected`, signals a gap. The canvas answers it by calling a `readBoard`
server action and dispatching `board.reseed`.

`readBoard` is the one new server action here, and it is a read: it wraps the
board read the page already performs and, like every other action,
independently re-checks `assertBoardAccess`. The proxy is routing, not
authorisation, and a reconnect is not a reason to trust a boardId from a
client.

**Deferred while a drag is active or a mutation is in flight**, then run on
idle. That ordering is what stops a reseed from erasing an optimistic card the
server has not been told about yet: once the mutation settles, the server's read
contains it.

### The teammate ring

When an event names a card, that card fades a 1.5s ring in the actor's avatar
colour, as `CLAUDE.md`'s design section describes. Under
`prefers-reduced-motion` the ring fades in and out without transform. The
canvas already reads the preference through `useSyncExternalStore`, so the
reduced path is a branch rather than new machinery.

### The open card

`card-body.tsx` and `card-comments.tsx` subscribe for their own card id.

**A field is dirty when its draft differs from the last committed value.** A
remote value applies to any field that is not dirty, and is dropped for one that
is — the reader keeps their text, and their own commit then wins under
last-write-wins as normal. Escape re-reads the current server value rather than
the value the field mounted with.

This is not text merging. It is a rule about focus, and the components already
track a draft per field.

**`card.deleted` for the open card** replaces the body with "This card was
deleted" and a way back to the board. Nothing vanishes mid-sentence, an
in-progress comment is not silently discarded, and the same treatment works on
the canonical page, where there is no modal to close.

**Comments** append in `(createdAt, id)` order. `lib/comment-order.ts` already
exists and already does this — the optimistic path needed it first.

### Degradation

`publish` no-ops without server credentials; the provider renders its children
and never connects when `NEXT_PUBLIC_PUSHER_KEY` is absent, and `subscribe`
becomes a no-op. Every mutation still works and a reload still shows the truth —
exactly today's behaviour.

This is what keeps the Deployment section's self-hosting promise true.
`docker-compose.yml` currently passes the app no Pusher variables at all; the
four are added there as optional, and to `.env.example`.

**`NEXT_PUBLIC_PUSHER_KEY` is inlined at build time**, so the client half of
this is decided when the image is built, not when it runs. A self-hoster who
wants realtime must supply the key as a build argument. This is stated in the
deployment notes rather than discovered.

## Testing

**Realtime is tested with two browser contexts in one Playwright test**: context
A moves a card, context B asserts it moved without reloading. A test that drives
one browser proves nothing about this sub-project. `e2e/support/session.ts`
already seeds independent sessions and `seedMember` already creates a second
member, so the harness exists.

The e2e cases that matter:

- A card moved in A appears moved in B, with no reload.
- A comment posted in A appears in B's open thread.
- B's own change does not double-apply in B — the `mutationId` echo works.
- A field B is typing in is not overwritten by A's edit to the same field.
- A card A deletes reads "This card was deleted" in B, which has it open.
- A board with no Pusher key configured still mutates correctly.

Unit tests cover `lib/events.ts`'s payload shaping and the byte guard, the two
new reducer actions, and `mutationId` validation on all twelve actions. The auth
route is tested for its three refusals: no session, a malformed channel name,
and a board the caller is not a member of.

The byte ceiling is asserted by a test that builds a worst-case payload, not
assumed from the character caps.

## Sections and pull requests

One section, one branch, one PR, per `CLAUDE.md`.

1. **The transport, proved end to end on one event.** `lib/events.ts`,
   `/api/pusher/auth`, `RealtimeProvider`, and `card.moved` — one event, wired
   from a server action to a second browser. Nothing else. This is the section
   that answers whether the private channel authorises correctly and whether two
   contexts really see each other, and it is small enough that a failure there
   is unambiguous. Everything after it is repetition of a proven path.
2. **`mutationId` through all twelve actions.** Schemas, call sites, unit tests,
   and echo suppression in the provider. Mechanical, wide, and dull — which is
   why it is its own PR rather than smeared through the others.
3. **The rest of the card and column events**, into the reducer, plus
   `card.patch`. The canvas converges with a teammate.
4. **Reconnect.** `readBoard`, `board.reseed`, and the deferral while a drag or
   a mutation is in flight.
5. **The open card.** `card.updated` and `card.deleted` in the card body, the
   dirty-field rule, the description refetch, and the deleted-card treatment.
6. **Comments in the thread**, including the byte guard and its degraded path.
7. **The teammate ring**, and the reduced-motion branch.

The transport comes first because every later section assumes it works, and a
subscription that silently fails to authorise looks exactly like an app with no
realtime — which is also its correct behaviour when unconfigured. Proving the
difference once, early, is what stops that ambiguity from contaminating six
later sections.

The ring comes last because it is the only part that is purely presentational:
by then every event already arrives and is applied, and the ring is a decoration
on a working system rather than the thing being debugged.

## Verification

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all
  pass, each exit code read from its own log, count run compared against count
  collected.
- Two real browsers on one board show each other's changes, observed by hand and
  not only in Playwright.
- A client that is disconnected and reconnected converges on the server's state
  without a reload, and does so without erasing an optimistic change made during
  the gap.
- `/api/pusher/auth` refuses a board the caller is not a member of — proved by
  calling it directly, not by the UI declining to subscribe.
- The app runs correctly with no Pusher credentials at all, confirmed in the
  Docker container, which is the configuration that has none.
- No payload exceeds the ceiling, including a 4,000-character comment of
  multibyte characters.
- A teammate's change rings the affected card in their avatar colour, and the
  ring does not transform under `prefers-reduced-motion`.

## Open decisions carried forward

- **A teammate deleting the board you are viewing.** Nothing tells you, and your
  next mutation fails with a generic error. This is pre-existing rather than
  introduced here; fixing it wants a `board.deleted` event, which is a scope
  increase this sub-project declines.
- **Presence.** Deferred by `CLAUDE.md` and not revisited here.
- **Whether the ring should also mark columns**, not only cards. `CLAUDE.md`'s
  design section describes it for cards only, and this follows that.

## Settled while brainstorming

- **Scope is the board canvas plus the open card**, not the board list. Every
  event in the contract therefore has a consumer, and `revalidatePath` keeps
  `/boards` correct without a subscription.
- **TanStack Query is not adopted.** The board already has optimistic updates
  with inverse rollback in `lib/board-state.ts`, which is most of what the
  library would provide; adopting it would mean rewriting sub-project 4's work
  to gain a cache the reducer already is. The one genuine fetch — a description
  too large for a payload — is a single server action.
- **`mutationId` over Pusher's `socket_id` exclusion**, because exclusion can
  silently fail and a client must tolerate its own events regardless.
- **Refetch on reconnect** rather than accepting silent staleness. The failure
  mode of the alternative is invisible, which is the kind this codebase has
  repeatedly paid for.
- **Degrade silently without credentials** rather than requiring Pusher, because
  the Deployment section promises self-hosting.
- **Never clobber a dirty field**, and **say so in place** when an open card is
  deleted.
