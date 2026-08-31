# Spec: Board canvas

Status: drafted, awaiting review
Date: 2026-08-30
Sub-project: 4 of 7

## Goal

The board stops being a shell. The `cards` table, card and column CRUD, drag and
drop between columns on fractional ranks, and a board that stays usable at
360px.

Sub-project 5 inherits a `cards` table it fills in rather than creates, a card
whose body is already the thing you click, and an optimistic client reducer that
the intercepted modal writes through instead of inventing its own.

## Non-goals

**The card modal, and everything in it.** Description, due date and comments are
sub-project 5, along with the intercepting parallel route and the canonical
`/cards/[cardId]` page. In this sub-project a card's body is inert: it renders,
it drags, and clicking it does nothing. That is a deliberate gap, and the `⋯`
menu is what stops it from being a card you cannot correct for a whole
sub-project — see "What you can do to a card".

No realtime. Every mutation here is a candidate `publish()` call site in
sub-project 6, and none of them make one. A teammate's change appears on their
next load, exactly as sub-project 3 already accepted.

No `comments` table. It belongs with the UI that writes to it.

No column drag. Reordering is a menu action — see "Columns reorder from a menu,
not by dragging".

No invite flow and still no second member, so every board in this sub-project
has exactly one member. The `viewer` role is nonetheless honoured by the UI and
by every action, because retrofitting a read-only canvas is far more expensive
than building one.

## Deliverables

### Schema and the third migration

One table, added to `lib/db/schema.ts` and generated with `pnpm db:generate`.

```ts
export const cards = pgTable(
  'cards',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
    columnId: text('column_id').notNull().references(() => columns.id),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    rank: text('rank').notNull(),
    createdById: text('created_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('cards_column_id_rank_idx').on(t.columnId, t.rank),
    index('cards_board_id_idx').on(t.boardId),
  ],
);
```

- **`description` and `dueDate` ship now, unwritten.** This is not the
  `assigneeId` mistake wearing a different hat. Those two were speculative —
  no requirement, no UI, no rule that needed them. These are in `CLAUDE.md`'s
  data model and sub-project 5 is committed to both, so they are columns
  arriving one sub-project early rather than columns nothing will ever write to.
  The purchase is one hand-run migration against production instead of two, and
  sub-project 5 opening with UI instead of schema.
- **`boardId` is denormalised, per `CLAUDE.md`, and this sub-project is what it
  is for.** Every card action resolves its board from the card row to authorise
  the caller. Without the column that is a join on the permission path of every
  drag.
- **`columnId` carries no `onDelete` action, deliberately.** See below.
- `cards_column_id_rank_idx` is the read path — a column's cards, in order.
  `cards_board_id_idx` is the permission path.
- `updatedAt` uses Drizzle's `$onUpdate`, matching `boards`.

### The referential action on `columnId`, and the one thing to prove first

`CLAUDE.md`: *"Deleting a column requires a target column to move its cards
into. Never cascade-delete cards with the column."* Leaving `columnId` at
Postgres's default `NO ACTION` makes that a property of the database rather than
a rule `deleteColumn` remembers: a bare column delete that would orphan cards
fails outright.

The subtlety is board deletion, which sub-project 3 shipped and must keep
working. Deleting a board cascades to `columns` **and** to `cards` in the same
statement. The claim this design rests on is that `NO ACTION` is checked at the
end of the statement, by which point the cascading delete of `cards` has already
removed the referencing rows, whereas `RESTRICT` is checked immediately and
would abort the board delete.

**That claim is unverified.** It is the whole reason for choosing `NO ACTION`
over `RESTRICT`, so Section A's first task proves it against a real Postgres
before anything else is built: seed a board with columns and cards, delete the
board, and assert it succeeds and leaves no rows — and separately assert that
deleting a column holding cards is rejected. If the claim is wrong, the fallback
is `onDelete: 'cascade'` on `columnId` with the no-orphan rule enforced only in
`deleteColumn`, and this section is rewritten to say so.

### What you can do to a card

A card renders its title and nothing else. There is no assignee, no label, no
count, and no due-date strip yet — the due date has no way to be set until
sub-project 5, and a warm strip on a board where nothing can be overdue would be
the one warm colour in the app spent on nothing.

Card creation has two entry points onto one path:

- **"New card" in the board header**, which `CLAUDE.md` names and the auth spec
  parked for this sub-project. It appends to the first column. It is the primary
  action on a board with nothing on it, and it is where the eye goes first.
- **"Add card" at the foot of every column**, which is the actual daily flow.
  Adding to the column you mean beats adding to Ready to Work and dragging.

Both append to the **bottom** of their column, because that is where both
buttons sit. Both call `createCard`. Two affordances, one action, one optimistic
path.

**The title is typed inline, not in a dialog.** Either button opens a one-line
input at the foot of its column — the header's scrolls the first column into
view first — where Enter commits and opens a fresh one for the next card, and
Escape closes it. Adding cards is the most repeated action on the board, and a
dialog per card would mean a modal open and close for each. Renaming, which is
rare, keeps the dialog.

An existing card carries a `⋯` menu — **Rename**, **Move to →**, **Delete** —
reusing the dropdown primitive and the rename dialog that sub-project 3's board
row menu already installed. This is the pattern the repository has, not a second
one.

Sub-project 5's modal will also edit the title. That duplication is accepted for
the same reason a board can be renamed from its row menu: reaching a field from
the place you are looking is worth one extra call site.

**"Move to" is not a narrow-viewport affordance.** It exists at every width. On
a collapsed board it is the only way to cross columns, but on a wide board it is
the pointer-free path, which is precisely where dnd-kit's keyboard sensor is
weakest — cross-container keyboard dragging is the hardest thing to get right
and the easiest thing to get subtly wrong. A menu that hits the same `moveCard`
action costs one submenu.

### Columns reorder from a menu, not by dragging

The column header carries a `⋯` menu: **Rename**, **Move left**, **Move
right**, **Add column right**, **Delete…**. Move left is disabled on the first
column, move right on the last. Rename and Add column each take a name in the
dialog sub-project 3's board row menu already established; Move left and right
commit immediately with nothing to type.

`CLAUDE.md` fixes the *mechanism* — "column reordering uses the same helper
against sibling columns" — and says nothing about the gesture. Dragging a column
would mean a horizontal `SortableContext` wrapping the vertical card ones inside
one `DndContext`: the column drag must not swallow a card drag, the two need
different collision detection, and the keyboard sensor has to stay coherent
across both axes. That is the highest-risk interaction available, spent on the
action you perform once when you set a board up, in a sub-project that also owns
cards, column CRUD and the responsive collapse.

The fractional ranks mean drag-to-reorder can be added later with no schema
change, no data migration and no change to `moveColumn`'s signature. Nothing is
foreclosed.

The consequence worth naming: **dnd-kit only ever sees cards.** One
`DndContext`, one `useDroppable` per column, one `useSortable` per card, no
nesting.

**Deleting a column names its target.** The dialog asks which column the cards
move into, defaulting to the neighbour on the left, and `deleteColumn` moves
them and deletes in one transaction. It rejects a target on another board, a
target equal to the column itself, and deleting a board's last column — all
server-side, because a dialog-only guard is theatre a client can skip. A column
with no cards still asks, and the answer is simply unused; a dialog that
sometimes appears is worse than one that always does.

### Server actions

`lib/actions/cards.ts` and `lib/actions/columns.ts`, following the existing
convention exactly — session, Zod parse, access check, transaction,
discriminated result:

| Action | Input | Minimum role |
|---|---|---|
| `createCard` | `{ columnId, title }` | `member` |
| `renameCard` | `{ cardId, title }` | `member` |
| `deleteCard` | `{ cardId }` | `member` |
| `moveCard` | `{ cardId, toColumnId, beforeCardId, afterCardId }` | `member` |
| `addColumn` | `{ boardId, name, afterColumnId }` | `member` |
| `renameColumn` | `{ columnId, name }` | `member` |
| `moveColumn` | `{ columnId, beforeColumnId, afterColumnId }` | `member` |
| `deleteColumn` | `{ columnId, targetColumnId }` | `member` |

**No card or column action takes a `boardId` for authorisation.** `CLAUDE.md`
forbids trusting one from the client, so each resolves the board from the row it
is about — `select board_id from cards where id = ?`, or from `columns` — and
checks *that*. A caller who hands over someone else's `cardId` is refused
because the board it resolves to is not theirs, not because they were believed
about which board they were on. `addColumn` is the exception: it genuinely has
no row yet, takes the `boardId`, and checks it directly.

**Neighbours, never indexes**, for columns as well as cards. `CLAUDE.md` gives
the reason for `moveCard` — an index is stale the moment someone else moves
something — and it applies unchanged to `moveColumn`. "Move left" is the client
computing the two neighbours from what it rendered; the server rank-betweens
them. Both actions write exactly one row.

**Every action bumps `boards.updatedAt` in the transaction it already opened.**
`/boards` sorts on that column and renders it as a relative time, and without
this it answers "which board did I last rename" — which, once boards are in
daily use, means every row reads months old while the boards are worked hourly.
The cost is honest and worth stating: a card move now writes two rows rather
than the one the fractional-rank design is proud of. It stays one transaction
and one round trip, and the second write is an unindexed single-row update on a
primary key.

Rejected: deriving last activity on read as `greatest(boards.updated_at,
max(cards.updated_at))`. It costs nothing on write, but it puts a join and an
aggregate over `cards` into the one query that runs on every visit to `/boards`,
and the ordering can no longer be served from an index on one column.

`revalidatePath('/boards')` after every mutation. **The canvas itself is never
revalidated** — `CLAUDE.md` reserves `revalidatePath` for the non-realtime
surfaces, and the board view's invalidation story is Pusher in sub-project 6.

### The canvas: one reducer, and inverse-operation rollback

`components/board/board-canvas.tsx` is `'use client'` and owns the whole canvas
in a `useReducer`, seeded from the server read. Local state is the truth for the
session; a reload re-reads from the server. There is no client cache and no
TanStack Query — `CLAUDE.md` admits it only where realtime cache reconciliation
needs it, and there is no realtime here.

**Rollback is by inverse operation, not by snapshot.** Snapshot-and-restore is
the obvious reading of `CLAUDE.md`'s "roll back on rejection", and it is wrong
under concurrency: restoring a snapshot also undoes any change that landed while
the failed one was in flight. The inverse of a move is a move back to the old
column and neighbours, of a create a delete, of a rename the previous title, of
a delete a re-insert at the old rank. It composes, and it costs about the same.

**Optimistic creates hold a client temp id.** A card still holding one renders
normally but is not draggable and its `⋯` menu is disabled, until the server
returns the real id and the reducer swaps it in. Otherwise a fast user drags a
card whose id the server has never seen.

**Failures are visible.** One polite `aria-live` status strip, owned by the
canvas — *"Couldn't move that card. Try again."* — in the interface's voice, per
`CLAUDE.md`'s copy rule, with no apology and no toast dependency. A revert the
user cannot account for is worse than the failure.

**A `viewer` gets no controls at all**: no "New card", no "Add card", no `⋯`
menus, no drag sensors. The role arrives as `assertBoardAccess`'s return value,
which the board page already has, and the server re-checks on every action
regardless — the absent button is presentation, not authorisation.

### Drag and drop, and a finding about dnd-kit

`CLAUDE.md`'s stack table names `@dnd-kit/core` + `@dnd-kit/sortable`. Those are
live at **6.3.1** and **10.0.0**, peer `react >=16.8.0`. Since that decision was
written, dnd-kit has shipped a **v2** — `@dnd-kit/react@0.5.0`, with a different
API (`DragDropProvider`, a `move()` helper, `useSortable` from
`@dnd-kit/react/sortable`) and an explicit `^19.0.0` React peer.

**This sub-project stays on v1, as `CLAUDE.md` specifies.** v2 is pre-1.0 with a
migration guide still being written against it, and the reason v1 was chosen
over react-beautiful-dnd — that it is maintained and works on React 19 — is
undisturbed. Recorded here so the next person who reads the stack table and then
reads npm does not think it went unnoticed.

**Neither has been run against React 19.2.8 in this repository.** The v1 peer
range permits it; a permitted range is not evidence. Section E opens with a
throwaway spike that drags one card between two columns and nothing else, and
the section does not proceed until that is observed working. If v1 fails on
React 19, that spike is where v2 gets reconsidered, before any real work rests
on it.

The wiring, per `CLAUDE.md`: `PointerSensor` at ~5px activation so a click still
reaches the card body in sub-project 5; keyboard sensor enabled with dnd-kit's
`aria-roledescription` and announcements left intact; optimistic mutation in
`onDragEnd` before the action is called; the dragged card gets `scale(1.02)`, a
3° tilt and a real shadow; the drop settles over 180ms on transform only; and
`prefers-reduced-motion` drops the tilt and the rise.

### Responsive: scroll-snap, not a second tree

`CLAUDE.md`: *"Below 700px the board switches to one full-width column at a time
with a column switcher, and horizontal scroll is dropped rather than shrunk."*

Every column stays mounted. Below 700px the board becomes a CSS scroll-snap
container at 100vw per column, and the switcher is a tab strip that
`scrollIntoView`s the column you pick. No `matchMedia`, no
width-conditional components, no second render path, and drag keeps working
inside the visible column.

This reads that sentence as *do not shrink the columns* rather than *do not
scroll horizontally* — the shrinking is what it was written against, and 300px
columns squeezed onto a 360px screen is the failure it names. Recorded as an
interpretation so it is visible rather than assumed. The alternative, genuinely
rendering one column, needs `useSyncExternalStore` over `matchMedia` and a tree
that differs by viewport, which is a second thing to test for no behaviour the
snap container does not already give.

Cross-column moves on a collapsed board go through **Move to**, which exists at
every width and is specified above.

## Testing

Unit tests mock `@/lib/db`, as `lib/actions/boards.test.ts` already does: every
action's Zod boundary, the role ladder on each, that `moveCard` and `moveColumn`
write one row and rank between the neighbours they were given, that
`deleteColumn` rejects a cross-board target, a self target and the last column,
and that every action bumps `boards.updatedAt`.

The reducer is unit-tested without a database and without React: each action's
optimistic application, each inverse, that an inverse composes correctly when a
second mutation landed in between, and that a temp-id card is marked
undraggable.

What a mocked `db` cannot prove is that the SQL is right, so the claims that
matter are Playwright tests against the Neon dev branch:

- deleting a board with columns and cards succeeds and leaves no rows, and
  deleting a column holding cards is rejected — the referential-action proof;
- create a card from the header and from a column foot, rename it, delete it,
  and each survives a reload;
- drag a card to another column and it is still there after a reload;
- add, rename, reorder and delete a column, the last one into a named target,
  and its cards arrive there;
- a board renders its columns and cards in rank order;
- at 360px one column fills the viewport and the switcher reaches the others.

`e2e/support/session.ts` gains `seedCard()` and `boardColumns()` alongside the
existing `seedBoard()` and `seedMember()` — a seeded card needs the id of the
column it goes in, and only the database knows it. Cleanup needs nothing new: `cards.boardId` cascades from
`boards`, which cascades from `user`, so `removeSeededUser` already takes them.

## Sections and pull requests

One section, one branch, one PR, in order:

| | Scope | Ends with |
|---|---|---|
| **A** | The `cards` table, the migration, the referential-action proof, `getBoardWithColumns` reading cards and returning the role | The migration applied to production by hand and verified. No UI |
| **B** | `lib/actions/cards.ts`, `lib/actions/columns.ts`, all eight actions | The rules proven in unit tests. No UI |
| **C** | Cards render; header and per-column create; card `⋯` rename, delete, move to | E2E: create, rename, delete, move without dragging |
| **D** | Column `⋯` rename, add, move left/right, delete into a target | E2E: the four column operations |
| **E** | dnd-kit, the reducer's optimistic move, drag and settle motion | E2E: drag across columns, surviving a reload |
| **F** | Scroll-snap collapse and the column switcher | E2E at 360px |

Six sections is more than sub-project 3's four, and that is the point:
`CLAUDE.md` asks for more and smaller PRs, and C, D and E each stand alone and
each is separately revertible.

**Each section branches from `main`, not from its predecessor**, unless its
predecessor is genuinely still open — `CLAUDE.md` records why, and the two
stranded branches that taught it.

Per `CLAUDE.md`'s model table: implementation and per-task review on Sonnet, the
final whole-branch review on Opus. `frontend-design` is invoked at
implementation time for C, D and E, and deliberately not while writing this
spec.

## Verification

Done when, with output observed rather than assumed:

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass locally.
- [ ] Deleting a board that holds columns and cards succeeds and leaves no rows
      in any of the three tables — run against the dev branch, and the
      referential action confirmed in `pg_constraint` rather than only in
      `schema.ts`.
- [ ] Deleting a column that holds cards, without naming a target, is refused by
      the database and not only by `deleteColumn`.
- [ ] A card dragged to another column is in that column after a reload, and
      exactly one `cards` row changed.
- [ ] A rejected move puts the card back where it was and says so in the status
      strip — forced by making the action fail, not by hoping.
- [ ] A `viewer` sees a board with no create buttons, no `⋯` menus, and cannot
      drag; and the actions refuse a `viewer` even when called directly.
- [ ] The board is usable at 360px in a real browser: one column fills the
      viewport, the switcher reaches every other column, and no horizontal
      overflow escapes the snap container.
- [ ] `docker compose up --build` still reaches a healthy app container with the
      new migration applied — confirmed with `\dt` against the container's
      Postgres, not on `db:migrate`'s success line.

## Open decisions carried forward

- **Whether the card body opens the modal or a page first.** Sub-project 5
  decides; this spec only commits to leaving the body inert and clickable-in
  -future, with the 5px drag activation already sized for it.
- **Column drag.** Not rejected on principle, only deferred against its cost.
  The ranks and `moveColumn`'s signature already support it.
- **Card count per column in the header.** Wanted the moment a board has real
  cards on it, and not specified here because `CLAUDE.md`'s type scale gives
  counts to Roboto Mono but nothing says where the count sits. Raise it during
  Section D's design pass.

## Settled while brainstorming

Recorded so they are not re-litigated in the plan or in sub-project 5:

- **`description` and `dueDate` ship in this migration**, with the reasoning
  under "Schema".
- **Column reorder is a menu action**, with the reasoning under "Columns
  reorder from a menu".
- **"Move to" exists at every width**, not only on a collapsed board.
- **Card activity bumps `boards.updatedAt`**, written rather than derived.
- **dnd-kit stays on v1**, with the v2 finding recorded rather than acted on.
- **Rollback is by inverse operation**, not by snapshot.

## Sequencing with the author

Section A's migration is applied to production by hand, by whoever merges it —
`MIGRATE_URL="$(npx neonctl@4 connection-string main --project-id <id>)" pnpm
db:migrate`, then `\dt` against production rather than trusting the success
line. Vercel deploys from a push to `main`, so the deployed app expects the
`cards` table before CI can prove anything about it.

Nothing else in this sub-project needs an external account, a credential or a
dashboard. Pusher is still not required — it arrives in sub-project 6.
