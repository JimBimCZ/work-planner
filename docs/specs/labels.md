# Spec: Labels

Status: approved, not implemented
Date: 2026-09-01
Sub-project: 9 of 10 — see `docs/specs/account-deletion.md` "Order"

## Goal

A board too full to read gets narrowed to the cards that matter. A member
defines a small set of labels on the board — `bug`, `blocked`, `chore` — puts
them on cards, and filters the board down to the cards carrying all of a chosen
set.

A label is a **query tool first** and a card annotation second. That ordering
was the first thing settled at the brainstorm and it decides most of this spec:
it is why labels have no colour, why the card face gets one muted mono line
rather than a row of chips, and why the filter lives in the URL rather than in
board state.

## Non-goals

**No colour, and this is not an oversight.** `CLAUDE.md` allows three colour
roles — flow, accent, warning — and says outright: "Do not add a fourth role. If
something needs emphasis, it needs hierarchy or spacing, not a new hue."
Conventional labels are coloured chips, which is exactly a fourth role, and the
warm half of the palette is spoken for twice over (due dates at rest, destructive
controls in transit). A label that filters needs no hue to do its job, so the
rule and the feature do not have to fight. **Do not add a `colour` column later
without re-opening the design brief first** — the column is one migration, but
the rule it breaks is load-bearing across the whole board.

**No free-form tags.** A label is picked from the board's set, never typed onto
a card. Typing produces `blocked` and `Blocked` as two filters, and a rename
becomes an edit of every card that carries it.

**No cross-board labels.** A label belongs to one board. There is no global
library, no copying a set between boards, and no organisation-level vocabulary.

**No other filters.** Not by due date, not by card text, not by who created a
card. A search box is a different feature with a different shape, and naming it
here would drag it into this sub-project's plan.

**No OR, no NOT, no saved filters.** Selecting two labels means both. A filter
that is hard to express is a signal that the board needs fewer cards, not a
query language.

**No filtering on `/boards`.** The board list shows boards, not cards.

**Dragging is disabled while a filter is active.** This is a decision, not a
gap — see "The sharp edge" below.

## Deliverables

### Schema: `labels` and `card_labels`

```ts
export const labels = pgTable(
  'labels',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
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
    cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.labelId] }),
    index('card_labels_label_id_idx').on(t.labelId),
  ],
);
```

**Verified, not assumed:** `IndexBuilderOn.on()` accepts `SQL` in drizzle-orm
0.45.2 — `node_modules/drizzle-orm/pg-core/indexes.d.ts:42` — and `sql`,
`unique`, `check` and `index` are already imported in `lib/db/schema.ts`.

Both foreign keys cascade, and both cascades are deliberate:

- **`labels.boardId` cascades from `boards`** — a deleted board takes its
  vocabulary with it. Nothing else references a label.
- **`card_labels` cascades from both sides.** Deleting a label takes it off
  every card, which is the promise a managed set makes: the alternative is a
  label that is gone from the picker but still printed on cards. Deleting a card
  takes its assignments with it, matching how `comments.cardId` already behaves.

Unlike `comments.authorId`, there is nothing here to preserve for a departing
user. A label is board property, not authored content, so no column is nullable
and `set null` appears nowhere in this schema.

**Two caps, both enforced in the action rather than the database:**

- **32 characters per name.** A label has to fit on a card face beside others.
- **50 labels per board.** This one is load-bearing rather than cosmetic: a
  card's `labelIds` array travels in a realtime payload, and 50 ids at 36 bytes
  is roughly 1.8KB — comfortably under `PAYLOAD_CEILING`'s 8,192. It also keeps
  the filter popover a list a person can read. A board that wants a 51st label
  has a taxonomy problem the app should not solve by growing the payload.

Neither cap is a check constraint, because both are product limits that may be
tuned, and `CLAUDE.md` reserves database constraints for invariants — the way
`board_invites_role_not_owner` guards an actual rule.

Relations: `cards` gains `cardLabels: many(cardLabels)`, so the existing board
query pulls assignments in the same round trip rather than earning a second one.

### Reads: `lib/labels.ts` and one extra column on the board query

`boardLabels(boardId)` returns `{ id, name }[]` ordered by `lower(name)` — the
set the picker and the filter popover both render.

`getBoardWithColumns` in `lib/boards.ts` gains
`with: { cardLabels: { columns: { labelId: true } } }` on its nested `cards`.
That is the whole read change: the board already loads every card, so every
card's labels come with it, and `toBoardState` maps them into the client state
below. One query, not two, and the reconnect catch-up inherits it for free
because it calls the same function.

**Counts are not a query.** The filter popover shows how many cards carry each
label; the client already holds every card's `labelIds`, so it counts them in
the browser. A count query would be a second source of truth that can disagree
with the board on screen.

### Actions: `lib/actions/labels.ts`

Four actions, each in the house shape — `auth()` → `safeParse` →
`assertBoardAccess` → transaction → publish after it commits → discriminated
result:

| Action | Minimum role | Notable failures |
|---|---|---|
| `createLabel({ boardId, name, mutationId })` | `member` | `DUPLICATE`, `LIMIT_REACHED` |
| `renameLabel({ labelId, name, mutationId })` | `member` | `DUPLICATE`, `NOT_FOUND` |
| `deleteLabel({ labelId, mutationId })` | `member` | `NOT_FOUND` |
| `setCardLabels({ cardId, labelIds, mutationId })` | `member` | `NOT_FOUND`, `INVALID` |

`member`, not `owner`, throughout. Deleting a *column* is already a member's
job, and a label is less destructive than that — `deleteColumn` refuses to
orphan cards, whereas deleting a label loses only the assignments. A `viewer`
reads labels and filters by them and can write nothing, which is the existing
ladder rather than a new rule.

`renameLabel` and `deleteLabel` take a `labelId` and resolve the board from the
row before checking access, the way `revokeInvite` resolves an invite's board —
the client never says which board it is acting on.

**`setCardLabels` replaces the whole set** rather than offering add and remove.
One idempotent action, one event, no ordering question between a pair of
concurrent toggles. It must **verify every submitted `labelId` belongs to the
card's own board** and answer `INVALID` otherwise: without that check a member
of board A could staple board B's label onto a card by id, which leaks the
existence of B's vocabulary and corrupts B's filter counts. `CLAUDE.md`'s "never
trust `boardId` or `userId` from the client" extends to label ids for the same
reason.

The 50-label cap is a guard rather than an invariant: two simultaneous creates
can both read 49 and both succeed. A fifty-first label costs nothing — the
payload maths has an order of magnitude of headroom — and closing the race would
take a lock or a constraint, neither of which a tunable product limit is worth.
Uniqueness is the opposite case and is owned by the database, because a
check-then-insert genuinely does let two callers create `bug` twice.

### Client state, and where the filter lives

`StateCard` gains `labelIds: string[]`. `BoardState` gains
`labels: { id: string; name: string }[]` — the board's set, held once, so a
rename repaints every card without touching a single card's state.

**The filter is not in board state.** It is read from the URL —
`/boards/<id>?label=bug&label=blocked` — with `useSearchParams`, and the canvas
filters cards at render. Three things fall out of that, all of them wanted:

1. It survives a reload and can be pasted to a colleague, matching the reasoning
   that made card modals real URLs rather than local state.
2. It is **per-viewer**. Narrowing your own board never narrows anyone else's,
   so it needs no server write and no realtime event.
3. **A reconnect cannot clobber it.** `components/board/board-canvas.tsx:226`
   dispatches `board.reseed` with a whole fresh `BoardState`; anything held in
   that reducer is replaced wholesale. A filter held there would vanish every
   time the socket reconnected. Held in the URL, it is untouched by definition.

An unknown label in the URL — deleted, or from another board — is ignored rather
than erroring, and the board renders unfiltered.

### The sharp edge: drag and drop under a filter

`moveCard` takes `beforeCardId` and `afterCardId`, never an index. If the client
reads those neighbours from the **filtered** list, the new rank lands between two
cards the user cannot see: the drop looks correct, and clearing the filter
reveals the card somewhere else entirely. Reading them from the unfiltered list
is no better — then the drop position on screen is a lie.

**So while a filter is active, cards are not draggable.** The `⋯` menu's "Move
to column" keeps working, so nothing becomes unreachable, and `useSortable`
already takes a `disabled` flag for exactly this kind of case (a pending card, a
viewer). This is one condition added to a guard that exists, not a new mechanism.

### The four surfaces

- **Card face** — one line under the due date, in the same 12px mono muted face
  dates use: `bug · blocked`. It truncates rather than wrapping, so a card's
  height cannot change with its label count.
- **Card modal** — a checkbox list of the board's labels under the due-date
  control, calling `setCardLabels` on change. Optimistic, like every other card
  edit here.
- **Filter popover** — opened from a "Filter" control in the top bar: the
  board's labels, each with its live count, multi-select, plus a "Clear" that
  drops the query parameter. The control shows the active count when filtering
  (`Filter · 2`) so a narrowed board can never look like an empty one.
- **Label management lives at the foot of that same popover** — a "New label"
  row, and rename and delete for members. It does **not** earn a third button in
  a top bar that already carries Members and New card, and a viewer sees the
  list without the controls.

A column emptied by a filter reads **"Nothing here matches"**, not the existing
"Nothing here yet" — under a filter the current copy is simply false.

The quality floor applies unannounced: the trigger carries `aria-expanded`, the
list is real checkboxes, focus rings are the 2px accent at 2px offset, and the
popover is reachable and dismissible by keyboard. Below 700px it is the same
control over the single-column layout.

### Realtime: four events, taking the union to nineteen

```ts
| { type: 'label.created'; id: string; name: string }
| { type: 'label.updated'; id: string; name: string }
| { type: 'label.deleted'; id: string }
| { type: 'card.labelled'; id: string; labelIds: string[] }
```

`card.labelled` carries the **whole** set rather than a delta, so a client that
missed an event converges on the next one instead of drifting. Payload size is
bounded by the 50-label cap above.

`lib/events.ts`'s `BoardEvent` and `components/board/realtime.tsx`'s
`EVENT_NAMES` must list all nineteen. That is not a matter of discipline any
more: `lib/events.test.ts` reads `realtime.tsx` and asserts every published name
is bound, so the four names go into that test's list as part of this work.

A `label.deleted` arriving at a client whose filter names that label leaves the
filter naming a label that no longer exists — which is the unknown-label case
already handled above, and renders unfiltered.

## Testing

**Unit (Vitest):**

- `lib/actions/labels.test.ts` — the guard order for all four actions; `viewer`
  refused; the duplicate fold (`Bug` against an existing `bug`); the 50-label
  cap; `setCardLabels` refusing a label id from another board; publish happening
  after the transaction and not inside it.
- `lib/labels.test.ts` — `boardLabels` ordering, and that it is scoped to one
  board.
- `lib/board-state.test.ts` — `toBoardState` carrying `labelIds`; the filter
  predicate ANDing rather than ORing; a card with no labels surviving an empty
  filter and not a populated one.
- `lib/events.test.ts` — the existing every-event-is-bound assertion, extended
  to nineteen names.

**End-to-end (Playwright), `e2e/labels.spec.ts`:**

- A member creates a label, applies it to a card, and the card face shows it.
- Two labels in the URL narrow the board to cards carrying **both**.
- The filter survives a reload, because it is in the URL.
- A column emptied by the filter reads "Nothing here matches".
- Cards are not draggable while a filter is active, and "Move to column" is.
- A viewer sees labels and can filter, and is offered no way to create, rename,
  delete or apply one.
- Deleting a label takes it off the cards that carried it.
- Two live clients: one applies a label, the other's card face shows it without
  a reload. Guarded by the same Pusher-credentials skip `e2e/realtime.spec.ts`
  uses.

## Sections and pull requests

One section, one branch, one PR, in this order:

- **A — schema, reads and actions.** `labels`, `card_labels`, the migration,
  `lib/labels.ts`, all four actions and their tests. No UI, no events.
  Branch `feat/labels-actions`.
- **B — the card, end to end.** `StateCard.labelIds`, the board query column,
  `toBoardState`, the card modal picker, the card face line.
  Branch `feat/labels-card`.
- **C — filtering.** The URL parameter, the filter popover with counts and
  management, the drag guard, the "Nothing here matches" copy.
  Branch `feat/labels-filter`.
- **D — realtime.** The four events, published and bound, and the two-client
  e2e. Branch `feat/labels-realtime`.

B depends on A, C on B, D on C. Branch each from `main` once its parent has
landed rather than stacking — `CLAUDE.md` records two stacks that stranded a
child PR on a consumed base.

## Verification

Ticked only against observed output, per section:

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, each
      exit code read from its own redirected log, never through a pipe.
- [ ] `pnpm exec playwright test` passes with the count run equal to the count
      collected.
- [ ] The migration applies to an empty database in CI, and is run against
      production by hand when Section A lands.
- [ ] A filtered board, reloaded, is still filtered.
- [ ] `select 'Bug'` and `select 'bug'` cannot both exist on one board —
      confirmed against the database, not only against the Zod schema.
- [ ] Two real browsers: one applies a label, the other's card shows it without
      a reload.

## Documentation changed in the same pull requests

- `CLAUDE.md` "Data model" — the two tables, their cascades, and the two caps
  with the payload reason for the second.
- `CLAUDE.md` "Realtime" — "all fifteen" becomes nineteen, with the four names.
- `CLAUDE.md` "Layout" — `lib/labels.ts` and `lib/actions/labels.ts`.
- `CLAUDE.md` "Design" — one line recording that labels are deliberately
  colourless, pointing here, so the three-role rule is not quietly broken later.
- `CLAUDE.md` "Open decisions" — labels/tags resolved; attachments remains.

## Settled while brainstorming

**Filtering beat scanning.** A label whose job is to narrow the board needs no
hue, which is what dissolves the collision with the three-role design brief.
Rejected: the conventional coloured chip, which would have forced either a
fourth colour role or a fight with the due-date signal.

**A managed set beat free-form tags**, and beat free-form with autocomplete. The
deciding argument is rename: with a set it is one row, with tags it is every
card, and nothing stops the vocabulary fragmenting in between.

**A mono line beat nothing on the card face.** Invisible labels would mean
opening a card to learn what it carries. It also beat showing labels only while
filtering, which is two card layouts to build and test for one card's worth of
information.

**AND beat OR**, and beat one-label-at-a-time. Narrowing is the stated job; OR
widens, and a single-label filter is the version you outgrow in a week.

**The URL beat local state**, on three counts: it survives reload, it is
shareable, and — the one that actually forced it — a reconnect's
`board.reseed` replaces the whole reducer, so a filter living there would
disappear whenever the socket blinked.

**Disabling drag under a filter beat computing neighbours from the unfiltered
list.** Both are compromises; only one of them can put a card somewhere the user
did not drop it.

## Open decisions carried forward

- **Attachments** (sub-project 10) — still carrying the unresolved blob-store
  conflict recorded in `docs/specs/account-deletion.md`.
- **Activity log**, and **board archive vs hard delete** — untouched by this
  spec.
- **OR and NOT semantics, and saved filters** — deliberately out of scope. If
  AND-only proves too blunt in daily use, that is a small, well-bounded
  follow-up, and it starts with evidence rather than with this paragraph.
