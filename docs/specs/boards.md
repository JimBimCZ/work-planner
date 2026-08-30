# Spec: Boards & permissions

Status: drafted, awaiting review
Date: 2026-08-30
Sub-project: 3 of 7

## Goal

Boards that belong to someone. The `boards`, `board_members` and `columns`
tables, `lib/permissions.ts` as the single place any access question is
answered, a board list you can create, rename and delete from, and a
permission-checked board route that renders the five seeded columns and nothing
else yet.

Sub-project 4 inherits a board route it fills in rather than builds, a rank
helper already in the repository, and a permission function every server action
it writes will call.

## Non-goals

Cards and comments, and their tables. Column CRUD — rename, reorder, add,
delete — is sub-project 4, even though the `columns` table lands here. No drag
and drop. No realtime: a board's changes are visible to a teammate on their next
load, and `revalidatePath` is the only invalidation.

**No invite flow, and no second member.** Adding someone by email, storing a
pending invite for an address with no account, and resolving it at first
sign-in, is a subsystem of its own: it reaches back into the Auth.js sign-in
callback, needs its own table and its own expiry rules, and nothing in
sub-projects 4 or 5 needs a second member to exist. It becomes its own
sub-project after the canvas. Until then every board has exactly one member —
its owner — and the `member` and `viewer` roles exist in the schema and in the
ladder without a way to hand them out.

That is a deliberate asymmetry, not an oversight: the role ladder is the part
that is expensive to retrofit, because every action written from here on calls
it. The UI that assigns a role is cheap by comparison.

No column switcher at 360px — see "The board route loses the footer here".

## Deliverables

### Schema and the second migration

Three tables, added to `lib/db/schema.ts` and generated with `pnpm db:generate`.

```ts
export const boardRole = pgEnum('board_role', ['owner', 'member', 'viewer']);

export const boards = pgTable('boards', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
});

export const boardMembers = pgTable('board_members', {
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: boardRole('role').notNull(),
}, (t) => [
  primaryKey({ columns: [t.boardId, t.userId] }),
  index('board_members_user_id_idx').on(t.userId),
]);

export const columns = pgTable('columns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rank: text('rank').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('columns_board_id_rank_idx').on(t.boardId, t.rank)]);
```

Five of those lines are decisions rather than transcription:

- **Two naming conventions coexist on purpose.** The Auth.js tables are singular
  and camelCase because `@auth/drizzle-adapter` builds its queries from its own
  defaults, and a rename breaks every adapter query with no type error to catch
  it — `lib/db/schema.test.ts` pins them for that reason. Our own tables are
  snake_case and plural, matching the data model in `CLAUDE.md`. Do not
  "harmonise" the two.
- **`role` is a Postgres enum, not free text.** The database rejects a typo, and
  Drizzle infers the TypeScript union from `boardRole.enumValues`, so `minRole`
  cannot be handed a string that is not a role. A fourth role later is an
  `ALTER TYPE`.
- **`columns` lands here; its CRUD does not.** Creating a board seeds five rows,
  so the table has to exist. Rename, reorder, add and delete are sub-project 4.
- **`ownerId` and an `owner` row in `board_members` are both written.**
  `CLAUDE.md`'s data model defines both, so the duplication is deliberate: the
  membership table answers "may this person act", and `ownerId` answers "whose
  board is this" without a join. They can drift, so they are written in one
  transaction and a test pins that every board has exactly one `owner` row whose
  `userId` equals `ownerId`.
- **`updatedAt` is maintained by Drizzle's `$onUpdate`**, not a database
  trigger, so the behaviour lives beside the schema rather than in a migration
  nobody re-reads.

**Deleting a board destroys its cards, and that does not contradict
`CLAUDE.md`.** The rule that a column may never cascade-delete its cards is
about column deletion, which must name a target column to move them into; it
stands untouched. Board deletion is the opposite case — the owner asked for the
whole thing to be gone — so the foreign keys cascade from `boards`, and the
name-typed confirmation is what makes the request deliberate.

`fractional-indexing` and `lib/rank.ts` are **pulled forward from sub-project
4**, because seeded columns need ranks and inventing a placeholder scheme now to
replace it later is worse than building the real one. Seeding is one call:
`generateNKeysBetween(null, null, 5)`.

`zod` is not currently a dependency. `CLAUDE.md` mandates it and nothing has
needed it until now; it arrives with the first server action that takes input.

### Permissions

```ts
export type BoardRole = (typeof boardRole.enumValues)[number];

export class BoardAccessError extends Error {
  constructor(readonly reason: 'FORBIDDEN' | 'NOT_FOUND') { super(reason); }
}

export async function assertBoardAccess(
  userId: string, boardId: string, minRole: BoardRole,
): Promise<BoardRole>;
```

One query, against `board_members`, keyed on the pair. No row throws
`NOT_FOUND`; a row whose role ranks below `minRole` throws `FORBIDDEN`. It
returns the caller's role, so a caller that needs it does not ask twice — the
board page learns it is the owner in the same call that authorised it, and that
is what decides whether "Delete board" renders.

**A non-member sees 404, not 403.** A 403 confirms the board exists, which tells
anyone who guesses an id that they guessed right. This falls out of the design
rather than being enforced on top of it: the function never asks whether the
board exists, only whether the caller is on it. `FORBIDDEN` is then reserved for
what it should mean — a member of the board whose role is too low, which today
can only happen if a row is seeded by hand, and from the invite sub-project
onward will be a viewer trying to mutate.

**One throw, two presentations.** Server Components let `BoardAccessError` reach
a `notFound()` boundary. Server actions catch it through a small
`boardAccessResult(error)` helper exported alongside, which converts it to the
`{ ok: false, error }` discriminated result the convention block in `CLAUDE.md`
mandates. No wrapper function around actions: a wrapper would need the
`boardId`, which lives inside the not-yet-parsed input, so it would have to
parse too — inverting the session → parse → check ordering that makes the
convention auditable.

Rejected: enforcing access in the query layer by joining `board_members` into
every read. Unauthorised reads would return no rows, which is elegant, but the
role ladder does not fall out of a join, so it would become a second mechanism
beside the first — and it depends on exactly the inlined membership query
`CLAUDE.md` forbids.

### Server actions and reads

`lib/actions/boards.ts`, following the existing convention exactly — session,
Zod parse, access check, transaction, discriminated result:

| Action | Minimum role | Notes |
|---|---|---|
| `createBoard` | — (session only) | No board to authorise yet. Writes the board, the `owner` member row and five seeded columns in one transaction, so a half-created board is impossible |
| `renameBoard` | `member` | Name trimmed, 1–80 characters |
| `deleteBoard` | `owner` | Takes the typed confirmation name and rejects a mismatch server-side |

`deleteBoard` re-checking the typed name matters: the dialog asks the owner to
type the board's name, and if only the dialog checks it, the guard is theatre a
client can skip.

Reads live in `lib/boards.ts` — `listBoardsForUser(userId)` and
`getBoardWithColumns(boardId)` — called from Server Components, the latter only
after `assertBoardAccess`. `revalidatePath('/boards')` after every mutation;
there is no realtime in this sub-project.

### Routes

| Route | Behaviour |
|---|---|
| `/boards` | Boards you are a member of, `updatedAt` descending. "New board" top-right. Footer stays |
| `/boards/[boardId]` | Access-checked, `notFound()` on throw. Board title in the top bar, five seeded columns below. No footer |

**The list.** Each row carries the board name, its relative updated time in
Roboto Mono, and a role badge **only when you are not the owner** — a badge on
every row is noise once every row says the same thing. A row's `⋯` menu, using
the dropdown primitive the account menu already installed, offers Rename and
Delete to owners. Rename is a dialog; Delete is the name-typed confirmation.
The empty state is an invitation per the copy rule — **"Create your first
board"** above the same button. "Nothing here yet" moves to where it belongs:
inside an empty column.

**The board.** The title moves into the top bar, which the auth spec parked for
sub-project 4; it arrives here because there is now a board to name. Below it,
the five columns at 300px with 12px gutters, each with its 3px flow-spectrum
rule, the 6% hue wash fading over ~80px, a 12/600 uppercase header, and "Nothing
here yet" inside. `lib/flow.ts` computes the hues and is already unit-tested;
this is its first real consumer. No drag and drop, no card creation, no column
editing.

`frontend-design` is invoked at implementation time for both screens, per
`CLAUDE.md`. It is deliberately not invoked while writing this spec.

### The board route loses the footer here, not in sub-project 4

`docs/specs/foundation.md` files "dropping `SiteFooter` on the board route" as
due in sub-project 4. It falls due the moment a fixed-viewport board route
exists, which is here: the board locks body scroll, so a footer below it is
unreachable, and shipping it knowingly unreachable for a whole sub-project is
worse than closing the decision early. The privacy link stays reachable through
the account menu, which `e2e/shell.spec.ts` already asserts.

**The 360px column switcher stays in sub-project 4.** It is coupled to column
CRUD and card interaction, and building it against a read-only shell means
building it twice. Until then the board scrolls horizontally at every width:
usable, not final. This is a known gap, recorded so it does not read as an
oversight.

### Testing

Unit tests mock `@/lib/db`, as `app/api/health/route.test.ts` already does. That
proves the ladder — every role against every `minRole`, no row → `NOT_FOUND`, a
lower role → `FORBIDDEN` — the Zod boundaries, the typed-name check, that
`generateNKeysBetween` yields five ascending keys, and the one-owner-row
invariant.

What a mocked `db` cannot prove is that the SQL is right, so every claim that
matters is a Playwright test against the Neon dev branch:

- a second seeded user opening the first user's board gets a 404, not a board;
- create a board and it appears in the list; rename it and the new name survives
  a reload; delete it with the typed name and it is gone;
- the board renders exactly the five seeded columns, in order;
- the footer is present on `/boards` and absent on the board route.

`e2e/support/session.ts` gains `seedBoard()` and `seedMember()`. Cleanup needs
nothing new: `boards.ownerId` cascades from `user`, so the existing
`removeSeededUser` already takes the boards with it.

### Sections and pull requests

One section, one branch, one PR, in order:

| | Scope | Ends with |
|---|---|---|
| **A** | `fractional-indexing`, the three tables, the generated migration, `lib/rank.ts` | The migration applied to production by hand, and verified |
| **B** | `zod`, `lib/permissions.ts`, `lib/boards.ts`, the three actions. No UI | The ladder proven in unit tests |
| **C** | `/boards`: list, create, rename, delete, empty state | E2E: create, rename, delete |
| **D** | `/boards/[boardId]`: the shell, the title in the top bar, footer drop and scroll lock | E2E: the 404, and the five columns |

Per `CLAUDE.md`'s model table: implementation and per-task review on Sonnet, the
final whole-branch review on Opus.

## Verification

Done when, with output observed rather than assumed:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass locally.
- A board created in a browser shows its five columns in the order
  `Ready to Work, In Progress, In Testing, In Review, Done`.
- A second account, signed in for real, gets a 404 on the first account's board
  URL — observed in a browser, not only in the Playwright run.
- Deleting a board removes its `board_members` and `columns` rows; a `select`
  against production or the dev branch confirms no orphans.
- `docker compose up --build` still reaches a healthy app container with the new
  migration applied.

## Open decisions carried forward

- **When the invite sub-project lands**, and whether it comes before or after
  the card modal. Not decided here; this spec only establishes that it is
  separate.
- **Whether a board can change owner.** `ownerId` is written once and never
  updated in this sub-project. Transfer is a real feature with real questions
  (does the old owner stay a member?) and no requirement yet.
- **Board archive.** Rejected here in favour of hard delete, and recorded under
  "Settled while brainstorming" rather than left open — but if the app ever
  takes users who lose work to a misclick, that is the evidence that reopens it.

## Settled while brainstorming

Recorded so they are not re-litigated in the plan or in sub-project 4:

- **Hard delete, not archive.** It matches the grain `CLAUDE.md` already sets
  for cards and comments. A nullable `archivedAt` is a filter every later query
  must remember; forget it once and archived boards leak back into a list.
  Adding archive later is one migration, and archive never replaces delete
  anyway — GDPR erasure still needs the real thing. Today a board holds nothing,
  so the blast radius is the smallest it will ever be.
- **Invites deferred**, with the reasoning under "Non-goals".
- **404 over 403** for a non-member, with the reasoning under "Permissions".
- **`assigneeId` and `wipLimit` stay dropped.** `docs/specs/foundation.md` files
  the decision as due in this sub-project; it was already resolved in
  sub-project 2, Section A, and nothing here changes it. No requirement needs
  either column.

## Sequencing with the author

Section A's migration is applied to production by hand, by whoever merges it —
`DATABASE_URL_UNPOOLED=<production> pnpm db:migrate`, exactly as sub-project 2
did it. Vercel deploys from a push to `main`, so the deployed app expects these
tables before CI can prove anything about them; the window is minutes and costs
nothing until the service has users.

Nothing else in this sub-project needs an external account, a credential, or a
dashboard. It is buildable and verifiable against the Neon dev branch and the
Docker Compose Postgres alone.
