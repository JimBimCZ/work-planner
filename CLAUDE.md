# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repository.

## Project

A collaborative kanban board application, JIRA-board style.

Repository: `https://github.com/JimBimCZ/work-planner`

- Multiple boards per user; multiple users collaborate on the same board.
- Columns are per-board and editable (rename, reorder, add, delete). New boards are seeded with: Ready to Work, In Progress, In Testing, In Review, Done.
- Cards drag and drop between columns and reorder within a column.
- A "New card" action sits in the board header, near the top of the screen.
- A card opens in a modal with: name, description, comments, due date.
- Auth is OAuth only — Google and GitHub. No password login.
- Production runs on Vercel. A Docker image exists for local development and self-hosting — see "Deployment".

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript strict | Server Components by default. Was pinned to 15; moved to 16 at project start because 16 was already stable and `next-auth@5` declares `^16.0.0` as a supported peer |
| Styling | Tailwind CSS v4 + shadcn/ui | Radix primitives under the hood |
| Drag and drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Not react-beautiful-dnd (unmaintained, no React 19 support) |
| Auth | Auth.js v5 (`next-auth@5`) | Google + GitHub providers, database sessions. Deliberately not Neon Auth — see "Auth and permissions" |
| DB | Neon Postgres | Same `node-postgres` driver against Neon's pooled endpoint and against local Postgres — no driver switch by environment |
| ORM | Drizzle ORM + drizzle-kit | Typed schema, SQL-first migrations |
| Data fetching | Server Components + Server Actions | TanStack Query only where realtime cache reconciliation needs it |
| Realtime | Pusher Channels (hosted pub/sub) | Not `LISTEN/NOTIFY` — see "Realtime" |
| Validation | Zod | One schema per action, shared client/server |
| Tests | Vitest (unit), Playwright (e2e) | Component tests get a DOM via `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` and `@testing-library/user-event`, scoped per file with a `// @vitest-environment jsdom` pragma at the top rather than by changing the global `environment: 'node'`. `vitest.config.mts` does not set `globals: true`, so Testing Library's automatic `afterEach(cleanup)` — which only wires itself up when it detects a global `afterEach` — never registers; wire `afterEach(cleanup)` by hand at the top of each component test file, or DOM from one test leaks into the next |
| Hosting | Vercel (production) | Docker image for local dev and self-host |

Do not add a state management library. Server state lives on the server; local UI state uses `useState`/`useReducer`.

## Commands

One-time setup for the agent workflow:

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

```bash
pnpm dev                # dev server on :3000
pnpm build              # production build
pnpm lint               # eslint
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest
pnpm test:e2e           # playwright
pnpm env:pull [target]  # pull Neon connection strings from Vercel into .env.local
pnpm db:dev-branch      # create the Neon dev branch, point Vercel Development at it
pnpm db:generate        # generate SQL migration from schema changes
pnpm db:migrate         # apply migrations
pnpm db:studio          # drizzle studio

docker compose up --build          # app + postgres locally
docker build -t kanban .           # app image only, self-host
```

`db:migrate` uses `DATABASE_URL_UNPOOLED` and never runs at application startup. CI runs it against its own throwaway Postgres on every pull request, which proves the migration applies to an empty database. **Production is migrated by hand.** Vercel deploys straight from a push to `main`, so CI can race that promotion but cannot gate it; rather than describe a gate that does not exist, run `pnpm db:migrate` against production yourself **in the same sitting as the merge that carries the migration** — not at the end of the sub-project, and not when the feature that reads the new tables lands.

That sentence used to end "the window ... is minutes, and costs nothing until the service has users." Both halves were wrong, and the labels sub-project proved it. Migration `0005` (the `labels` and `card_labels` tables) landed on `main` in Section A's PR #82 at 19:20 on 2026-09-01 and was never applied. Section B merged the board query that joins `card_labels` at 19:56, Vercel promoted it, and from **20:41 to 20:44 production answered `/boards/[boardId]` with `relation "card_labels" does not exist`** — eleven times, to a real user, who then stopped. It was found the next day, by checking rather than by a report. The window is as long as nobody looks, and the service already has users.

So: **verify, do not assume.** The success line lies about the target (see `MIGRATE_URL` below), and it says nothing at all about a migration that never ran. Read the table list back:

```bash
select table_name from information_schema.tables where table_schema='public';
```

The count of applied rows in `drizzle.__drizzle_migrations` must equal the number of files in `lib/db/migrations/`. Five against six is what this incident looked like from the outside.

`drizzle.config.ts` loads `.env.local` itself and lets it override `.env`. drizzle-kit only auto-loads
`.env`, so without that the app talks to Neon while migrations silently hit the docker Postgres in
`.env` — the two drift with no error.

**`MIGRATE_URL` names the database outright, and is how production is migrated:**

```bash
MIGRATE_URL="$(npx --yes neonctl@4 connection-string main --project-id withered-glade-54206401 --org-id org-silent-block-21833986)" pnpm db:migrate
```

It exists because provenance cannot be inferred. drizzle-kit loads `.env` into `process.env` before
the config evaluates, and dotenv does not overwrite a variable the shell already set — so a value that
*differs* from `.env`'s must have come from the shell, but a value *equal* to it is undecidable. The
config used to guess by exactly that comparison, and it broke in the one case `.env` exists to
describe: `DATABASE_URL_UNPOOLED=postgres://kanban:kanban@localhost:5432/kanban pnpm db:migrate`
matched `.env`, read as "not from the shell", and migrated the Neon dev branch while printing
`migrations applied successfully!`. `MIGRATE_URL` carries no value to be confused with.

`lib/db/migrate-target.ts` holds the rule and its tests.

`--org-id` is not decoration. The account reaches Neon through the Vercel integration, so `neonctl`
now resolves more than one organisation and asks which — an interactive prompt the surrounding `$( )`
swallows exactly the way it swallows the `npx` confirmation below. The command appears to hang, and
`MIGRATE_URL` ends up empty.

`--yes` is not decoration either. `npx` re-resolves `neonctl` on every invocation — it is never
cached — and an interactive terminal answers that with a confirmation prompt the surrounding
`$( )` swallows, so the command appears to hang forever and `MIGRATE_URL` ends up empty.
Installing `neonctl` globally avoids both the prompt and the six seconds it costs.

`DATABASE_URL_UNPOOLED` still works from the shell when its value differs from `.env`'s — that is what
CI relies on — but prefer `MIGRATE_URL` when it matters, and confirm with `\dt` rather than the
success line. Also note `drizzle-kit migrate` exits 1 with an empty stderr
when `lib/db/migrations/` does not exist; the first `db:generate` creates it.

`MIGRATE_URL` set but empty — a failed command substitution, most often — is a hard error rather than
a silent fallback to another database, because a fallback there is this same failure mode again.

Before declaring any task done, run `pnpm typecheck && pnpm lint && pnpm test`. Do not report success on output you have not seen.

## Layout

```
app/
  (auth)/signin/            # OAuth entry, no credentials form
  (app)/                    # session check only; each group below renders its
                            # own TopBar, because the board needs a title in it
    (chrome)/               # normal page scroll, SiteFooter below the content
      boards/               # board list
      account/              # who you are signed in as, and the delete danger zone
    (board)/                # fixed viewport height, no footer
      boards/[boardId]/     # board view — its layout resolves the board title
        @card/
          default.tsx       # returns null; without it a hard load 404s
                            # the whole board — the spike proved this
          (.)cards/[cardId]/  # intercepted — renders as modal over the board
        cards/[cardId]/     # canonical card page — the intercept target, and
                            # what a shared link opens on a cold load
  (legal)/
    privacy/page.tsx        # Privacy Policy
    terms/page.tsx          # optional, same layout
  api/
    auth/[...nextauth]/
    pusher/auth/            # private-channel authorisation
    attachments/[attachmentId]/  # re-checks board access, 302s to a presigned
                            # GET. Everything that goes wrong answers 404
    health/                 # container healthcheck
components/
  board/                    # Board, Column, Card, CardModal, dnd wiring
  site-footer.tsx           # rendered by each route-group layout, not the root
                            # one; see "Footer and legal pages"
  ui/                       # shadcn primitives
lib/
  auth.ts                   # Auth.js config, exports auth/signIn/signOut
  db/
    schema.ts               # Drizzle tables
    index.ts                # pooled db client — the one permitted module-level
                            # singleton; see "Deployment"
    migrations/
  actions/                  # 'use server' modules, one per aggregate
    labels.ts               # createLabel, renameLabel, deleteLabel, setCardLabels
    attachments.ts          # requestUpload, confirmUpload, deleteAttachment
  permissions.ts            # single source of truth for access checks
  rank.ts                   # fractional index helpers
  events.ts                 # Pusher publish helpers + event types
  labels.ts                 # label caps, boardLabels read
  storage.ts                # only module that speaks S3: presign, head, delete
  attachments.ts            # reads: cardAttachments, boardUsage, uploaderUsage
  attachments-limits.ts     # attachment caps; imports nothing, see "Data model"
docs/
  specs/                    # brainstorm output, one per feature
  plans/                    # implementation plans with checkboxes
proxy.ts                    # Next 16's renamed middleware: cookie-presence
                            # redirect on /boards/*. Imports nothing from lib/
```

The card modal is an intercepting parallel route, so cards have shareable URLs and browser-back closes the modal. Both halves are required: the intercept renders the modal over the board for in-app navigation, and the canonical `/boards/[boardId]/cards/[cardId]` page is what a pasted link opens on a cold load. Do not replace either with local modal state.

The `(.)` marker counts route segments, and neither a parallel slot (`@card`) nor a route group (`(board)`) is a segment — so the canonical page has to sit at the same segment depth as the intercepting route for `(.)` to be the documented case, which is why both live directly under `boards/[boardId]/`.

## Data model

```
users              id, name, email, image                      (Auth.js)
accounts,
sessions,
verificationTokens                                             (Auth.js adapter tables)

boards             id, name, ownerId, createdAt, updatedAt
board_members      boardId, userId, role ('owner'|'member'|'viewer')   PK (boardId, userId)
board_invites      id, boardId, email, role, invitedById, createdAt
columns            id, boardId, name, rank, createdAt
cards              id, boardId, columnId, title, description,
                   dueDate, rank, createdById, createdAt, updatedAt
comments           id, cardId, authorId, body, createdAt, updatedAt
labels             id, boardId, name, createdAt                        unique (boardId, lower(name))
card_labels        cardId, labelId                                     PK (cardId, labelId)
attachments        id, boardId, cardId, uploaderId, key, filename,
                   contentType, size, status ('pending'|'ready'),
                   createdAt                                           unique (key)
```

Rules:

- `cards.boardId` is denormalised deliberately — every permission check and every realtime event keys off the board, and this avoids a join on the hot path. Keep it consistent with `columnId`'s board in every write.
- `comments.authorId` is nullable and sets null on delete, not cascade: `/privacy` promises that boards owned by other people keep your comments when your account is deleted. A comment with no author can be edited and deleted by nobody.
- `cards.createdById` is nullable and sets null on delete, not cascade: `comments.cardId` cascades from `cards`, so a cascading `createdById` would delete every comment on a card once its creator's account is gone — including comments left by other people, on boards the creator never owned.
- Deleting a column requires a target column to move its cards into. Never cascade-delete cards with the column.
- Comments and cards are soft-delete free for now: hard delete, but only via an action that checks role.
- Index `cards(columnId, rank)`, `cards(boardId)`, `comments(cardId, createdAt)`, `board_members(userId)`, `board_invites(email)`.
- `board_invites` holds an invite only while it is pending — accept, decline and revoke all end with the row gone. It carries a unique `(boardId, email)` and a check constraint, `board_invites_role_not_owner`, refusing `owner`: ownership moves through `transferOwnership` and nowhere else. Expiry is filtered at read time against `INVITE_TTL_DAYS` (30) rather than purged, because Vercel rules out a scheduled job — so an expired row still holds its pair, which is why `inviteMember` upserts rather than inserts. `invitedById` sets null on delete; the board itself cascades.
- Labels are capped twice, in `lib/labels-limits.ts`: `LABEL_NAME_MAX` (32) and `LABELS_PER_BOARD` (50). Neither is a check constraint — both are tunable product limits rather than invariants — but `LABELS_PER_BOARD` is load-bearing: a card's label ids travel in a `card.labelled` payload, and fifty ids at 36 bytes stays far under `PAYLOAD_CEILING`. The module imports nothing, because the filter popover is a client component and needs the name cap.
- `labels.boardId` cascades from `boards`: a label is board vocabulary, gone when the board is. `card_labels.labelId` and `card_labels.cardId` both cascade too, for different reasons — deleting a label takes it off every card, which is the promise a managed set makes (nothing dangles referencing a label that no longer exists); deleting a card takes its label assignments with it, the same way it takes its comments.
- `cards.assigneeId` and `columns.wipLimit` were **dropped, not deferred.** Both were speculative — no requirement, no UI, no enforcement rule — and YAGNI says an unused column is a liability, not a head start. Adding either later is one migration; carrying a column nothing writes to costs a permanent explanation. Do not reintroduce them without a requirement that needs them.
- `attachments.boardId` and `attachments.cardId` both cascade from their parent: an attachment is denormalised the same way `cards.boardId` is, so every permission check and a board-wide bucket sweep can read the object keys without joining through `cards`, and both rows going with their parent is the same promise `card_labels` makes. `attachments.uploaderId` sets null on delete, not cascade — it follows `comments.authorId`, because `/privacy` promises boards owned by other people keep your contributions after you delete your account. `key` is unique and shaped `boards/<boardId>/<attachmentId>`; `status` (`pending`|`ready`) exists because the browser writes bytes to the bucket directly and the server only learns what actually landed via a `HEAD` — a row can outlive an abandoned upload, which is what `PENDING_TTL_MINUTES` bounds.
- Attachments are capped six ways, in `lib/attachments-limits.ts`, which imports nothing for the same reason `lib/labels-limits.ts` does — the file picker is a client component and needs the size cap. `ATTACHMENT_SIZE_MAX` (10 MB) and `ATTACHMENTS_PER_CARD` (10) bound one upload and one card. `STORAGE_PER_BOARD` (1 GB) and `STORAGE_PER_ACCOUNT` (2 GB) bound total bytes and are derived, not picked: ten boards filled to `STORAGE_PER_BOARD` is exactly Cloudflare R2's 10 GB-month free tier, so the service cannot produce a surprising bill, only a slowly growing legible one; `STORAGE_PER_ACCOUNT` is twice that because it counts one uploader across every board they can reach, which the per-board cap alone can't see, and at 2,147,483,648 it lands one byte **over** `int4`'s maximum (2,147,483,647) — nowhere near `bigint`'s ceiling. Postgres's `sum(int4)` already returns `bigint` on its own, so the hazard is never the default behaviour; it's an explicit `::int` cast on a size sum, the pattern this repo otherwise uses for counts (`e2e/schema.spec.ts:33`). The rule: never cast a size sum to `int`. `FILENAME_MAX` (200) and `PENDING_TTL_MINUTES` (15) round out the six. None of the six is a check constraint, matching the label caps.

## Ordering: fractional ranks

`columns.rank` and `cards.rank` are `text`, generated with the `fractional-indexing` package, ordered lexicographically.

Reason: two users dragging cards at the same time must not need a table-wide reindex. A move writes exactly one row — the moved card gets a rank between its new neighbours.

```ts
// lib/rank.ts
import { generateKeyBetween } from 'fractional-indexing';
export const rankBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);
```

Ranks are compared in two places — Postgres (`order by rank`) and JavaScript (`before.rank >= after.rank`) — so they agree only while the database collates by code point. **Verified 2026-08-31: both the `main` and `dev` branches of `withered-glade-54206401` are `C.UTF-8`, and `select 'Zz' < 'a0'` returns true.** That case is reachable, not hypothetical: `generateKeyBetween(null, 'a0')` is `'Zz'`, so two drops at the top of a column produce `Zy < Zz < a0`, which a locale-aware collation would order the other way and hand `createCard` the wrong last rank. If a database is ever created outside Neon — the `postgres:17-alpine` in `docker-compose.yml` pins no locale — check it before trusting the ordering.

Never store integer positions and never renumber siblings on move. If two ranks ever collide, break the tie on `createdAt` then `id`, and let the next move resolve it.

Column reordering uses the same helper against sibling columns. There is one ordering mechanism in this codebase, not two.

## Drag and drop

- `DndContext` wraps the board; each column is a `useDroppable`, each card a `useSortable`.
- Optimistic update first: mutate local state in `onDragEnd`, then call the server action, then roll back on rejection. Dragging must never wait on the network.
- The server action receives `{ cardId, toColumnId, beforeCardId, afterCardId }` — not an index. Indexes are stale the moment another user moves something.
- Use `PointerSensor` with an activation distance of ~5px so clicking a card still opens the modal.
- Keyboard sensor stays enabled. Cards need `aria-roledescription` and drag announcements; do not strip dnd-kit's accessibility props.

## Realtime

Hosted pub/sub, one private channel per board: `private-board-<boardId>`.

Postgres `LISTEN/NOTIFY` over SSE is **not** viable here. It needs a dedicated, long-lived, non-pooled database connection; Vercel functions are short-lived and Neon's pooled endpoint doesn't forward notifications. Do not reintroduce it while the target is Vercel.

- Every mutating server action calls `publish(boardId, event)` after its transaction commits.
- Clients subscribe with `pusher-js`; `/api/pusher/auth` authorises the channel by re-checking board membership. Channel names are never trusted — the route derives access from the session.
- Client ignores events it caused itself, matched on a client-generated `mutationId` echoed in the payload. **Attachments are the one deliberate exception:** `components/board/card-attachments.tsx` generates its id with a bare `crypto.randomUUID()` rather than `useRealtime().claim()`, so the provider hands this client back its own `attachment.added`. That echo is the only thing that moves the count on the uploader's own card face — the component writes into the modal's local state, and `board-actions.tsx` carries no attachment bridge to the canvas reducer the way it does for labels. `e2e/attachments.spec.ts` asserts the actor's own count for exactly this reason, so switching that line to `claim()` fails a test rather than silently freezing the uploader's own board.
- Events, all twenty-one: `card.created`, `card.updated`, `card.moved`, `card.deleted`, `column.created`, `column.updated`, `column.moved`, `column.deleted`, `comment.created`, `comment.created.truncated`, `comment.updated`, `comment.deleted`, `member.added`, `member.updated`, `member.removed`, `label.created`, `label.updated`, `label.deleted`, `card.labelled`, `attachment.added`, `attachment.removed`. `lib/events.ts`'s `BoardEvent` union and `components/board/realtime.tsx`'s `EVENT_NAMES` must list the same set — an event missing from the second is published and never delivered, and nothing at runtime can notice, because Pusher simply never calls a handler nobody bound. **The guard is `EveryEventIsBound` in `realtime.tsx`**, an `Exclude<…> extends never` assertion behind a `T extends true` constraint: adding a member to `BoardEvent` without adding its name fails `pnpm typecheck` on that line. `EVENT_NAMES`'s own `satisfies` catches the reverse. `lib/events.test.ts` still reads the file for the same twenty-one names, but that test is a hand-written list and cannot see a twenty-second event — it is a second opinion, not the guarantee.
- The three `member.*` events carry a `userId` and, except for `member.removed`, the new role. `components/board/membership-watch.tsx` sends a member who was removed back to `/boards` and refreshes the board when their own role changes, because `canWrite` is computed in the layout from the role it fetched. `inviteMember` and `revokeInvite` publish nothing: only the owner ever sees a pending invite. A transfer publishes `member.updated` twice rather than earning a fourth event.
- Payloads carry the changed entity, not a full board refetch, and stay under `PAYLOAD_CEILING` (8,192 bytes, headroom under Pusher's documented 10KB). The two fields that cannot fit are handled by saying so and letting the reader ask:
  - `card.updated` carries `descriptionChanged: boolean` rather than the description; an open card calls `readCardDescription`.
  - `comment.created` degrades to `comment.created.truncated` — id and cardId only — when the whole event would exceed the ceiling; an open thread calls `readComments`. `publishComment` in `lib/events.ts` is the only place that branch lives. The body cap and the ceiling measure different things: `maxLength`/Zod count UTF-16 units, the guard counts UTF-8 bytes, so 2,000 emoji is a legal 4,000-unit comment weighing 8,355 bytes.
- Presence channels (who else is viewing the board) are a later addition, not part of the first build.

Last-write-wins on card fields is acceptable. Do not build OT/CRDT text merging for descriptions.

Ably is an acceptable substitute if Pusher's free tier proves too small. Polling is not — a 5s poll of a full board burns more function invocations than the pub/sub costs.

## Auth and permissions

- `lib/auth.ts` exports `auth`, `handlers`, `signIn`, `signOut`. Drizzle adapter, `session.strategy = 'database'`.
- `proxy.ts` protects `/boards/*` and redirects unauthenticated users to `/signin`. Next 16 renamed the `middleware` convention to `proxy`; it defaults to the Node.js runtime and its `runtime` option cannot be set. It checks only that a session cookie is present and imports nothing from `lib/`, because Next's own documentation warns that this file may be deployed away from the app runtime and must not rely on shared modules — `lib/db` holds a connection pool.
- **Every server action and route handler independently re-checks permission.** The proxy is routing, not authorisation.
- **`lib/permissions.ts` is server-only, and so is anything that imports it.** It imports `lib/db`, which builds a `pg` pool at module scope, so a `'use client'` file importing *any* value from it — `atLeast` included — pulls the driver into the browser bundle and the build dies on `dns`/`fs`/`net`/`tls`. `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass on that code; only bundling catches it. Client components take a derived boolean (`canWrite`) computed on the server, never a role they resolve themselves. `import type` is erased and stays safe.
- All checks go through `lib/permissions.ts`: `assertBoardAccess(userId, boardId, minRole)`. Never inline a membership query in an action.
- `viewer` can read and comment; `member` can mutate cards and columns; `owner` can manage members and delete the board.
- A comment's own author, and nobody else — not the board owner — can edit or delete it.
- An attachment is the deliberate exception to that rule: its **uploader or the board owner** can
  delete it. The owner is accountable for the bytes on their board and needs a way to clear a file
  whose uploader has deleted their account — `attachments.uploaderId` sets null, so otherwise nobody
  could. Reading one only needs `viewer`: seeing the card is seeing its files.
- Invite flow: an owner invites by email address, whether or not an account exists for it. The invite is keyed on the address, not on a user id, and resolves when the invitee accepts it from `/boards` — there is no sign-in callback doing it for them. `acceptInvite` and `declineInvite` are the only actions that reach a board without `assertBoardAccess`, because the invitee is not on the board yet by definition; they are scoped by the session's own email matched against the invite row. An invite that has expired, never existed, or is addressed to somebody else all answer `NOT_FOUND`, so a guessed id learns nothing.

**Neon Auth is deliberately not used, and stays disabled on every Neon branch.** The Vercel-managed
Neon integration provisions it automatically, so it may come back — if it does, disable it rather than
adopting it. Two reasons, both structural:

- It is a *hosted* service reached over a Neon-managed endpoint, so it cannot run against the plain
  Postgres in `docker-compose.yml`. Adopting it would break local development and self-hosting, which
  "Deployment" commits to supporting.
- Neon documents that foreign keys must reference `neon_auth.user(id)` and that its constraints may
  change in future updates, breaking those references and blocking migrations. `boards.ownerId`,
  `board_members.userId`, `cards.createdById` and `comments.authorId` all point at users; that is not
  a table to hand to a vendor.

**Current state, verified 2026-08-30 on project `withered-glade-54206401`:** Neon Auth is *not*
enabled. `neonctl neon-auth status` reports "not configured" on both the `main` and `dev` branches,
and no `NEON_AUTH_BASE_URL` or `VITE_NEON_AUTH_URL` exists in any Vercel environment. Nothing needs
disabling today.

What *does* exist is a leftover `neon_auth` schema — nine tables (`user`, `session`, `account`,
`organization`, `member`, `invitation`, `jwks`, `verification`, `project_config`) — on the `main`
branch, which `dev` inherited when it was branched. It is inert: it lives in its own namespace, our
tables are in `public`, and nothing in this repository references it. It is deliberately left in
place rather than dropped, because dropping it is permanent and buys nothing.

To check, and to remove it if it ever comes back:

```bash
npx neonctl@4 neon-auth status  --project-id <id> --branch <branch>
npx neonctl@4 neon-auth disable --project-id <id> --branch <branch>
```

`disable` turns the service off but leaves the schema behind. Removing the schema as well is
`--delete-data`, or `DROP SCHEMA neon_auth CASCADE` — both permanent, so neither runs without a
deliberate decision. Check the Vercel project for `NEON_AUTH_BASE_URL` and `VITE_NEON_AUTH_URL`
too; the integration adds them when it provisions the service, and they are absent today.

## Server action conventions

```ts
'use server';

const schema = z.object({ /* ... */ });

export async function moveCard(input: unknown) {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  await assertBoardAccess(session.user.id, parsed.data.boardId, 'member');
  // db write in a transaction, then publish once it has committed
  return { ok: true, data } as const;
}
```

- Actions return a discriminated result object. Do not throw for expected failures.
- Never trust `boardId` or `userId` from the client for authorisation — derive the user from the session, then verify the board.
- Publish **after** the transaction commits, never inside it. A rolled-back write that already announced itself puts every other client into a state the database disagrees with.
- `revalidatePath` is for non-realtime surfaces (board list). The board view updates over Pusher.

## Design

Invoke the `frontend-design` skill when building or reshaping UI. Note that Superpowers' brainstorming skill forbids invoking it during brainstorming — design comes after the spec is approved, at implementation time.

The brief: a board a developer stares at for eight hours a day. Its job is to answer "where does everything stand" without being read. Chrome recedes, cards are the content, and colour is functional — never decorative.

### Tokens

```
--canvas      #10141A / #EDF0F5     board background (dark / light)
--surface     #19202A / #FFFFFF     cards, modal, top bar
--ink         #E7EBF2 / #0E1319     primary text
--muted       #8A94A6               secondary text, both modes
--line        #262E3A / #DCE1E9     borders, dividers

--flow-1      #4468D8   indigo   — first column
--flow-mid    #12A594   teal     — midpoint, and the app's single accent
--flow-last   #2E9E5B   green    — last column

--time-soon   #C98A17   amber
--time-over   #C8492F   rust
```

Three colour roles, and only three:

1. **Flow** — cool hues, position in the pipeline.
2. **Accent** — `--flow-mid`. Primary buttons, focus rings, active states. Nothing else is teal.
3. **Warning** — `--time-soon` and `--time-over`, the only warm hues in the app. Two uses, and only
   two: **due dates**, and **destructive or failed actions** — a Delete menu item, a delete button, an
   error in the status strip.

   The two coexist because they differ in persistence, not in hue. A due date is *painted on the board
   surface and stays there*, so an overdue card still pulls the eye across a board nobody is reading
   closely — that claim was the reason for the rule and it survives. The destructive uses are
   transient and local: they live inside an open menu or dialog the user is already looking at, or in
   a status strip that clears. Nothing warm is ever at rest on the board except a due date.

   So the constraint that matters is not "warm means time" but **warm is never decorative, and never
   at rest on the board**. Do not spend it on a badge, a highlight, a count, or a hover state.

   The tokens keep their `--time-*` names, which predate the second use. Renaming them would touch
   `globals.css` and every consumer to say the same thing, so the name is stale and the rule above is
   the authority.

Do not add a fourth role. If something needs emphasis, it needs hierarchy or spacing, not a new hue.

**Labels are deliberately colourless** — a mono line on the card face, plain checkboxes in the picker
and the filter. The conventional coloured chip is exactly a fourth role, and it would compete with the
due-date signal on the one surface that must stay readable at a glance. `docs/specs/labels.md` holds
the reasoning; do not add a `colour` column to `labels` without reopening it.

Avatar colours are the one exception, and they are constrained: derive them by hashing the user id onto the **cool** half of the wheel only (180°–300°). They must never stray warm, or they'd compete with the warning signal, and they must never land on the accent teal.

### Signature: the flow spectrum

Column hue is derived from the column's position, interpolating hue 225° → 145° across however many columns the board has. Five default columns land at roughly indigo → blue → teal → sea-green → green. Add a sixth and every column re-interpolates. The board is one continuous spectrum, so the eye reads left-to-right as progress, and a card physically moves toward green as it gets closer to done.

This is where the gradient budget is spent, and it is the whole budget:

- A 3px rule at the top of each column, gradient from its own hue to the next column's. Side by side they form one unbroken band across the board.
- A hue wash behind the column header at 6% alpha, fading to transparent over ~80px.

Nothing else in the app gets a gradient. No gradient buttons, no gradient text, no gradient card surfaces, no mesh or aurora backgrounds. The restraint is what makes the one gradient mean something.

Hue is never the only signal — column names are always visible, and overdue carries a mono `3d over` label alongside its colour.

### Type

Three roles, two families. The roles are functional and stay; the families are
deliberately boring so that no time is spent on font licensing.

- **Display** — Roboto 500, used only for board titles, empty states, and the sign-in screen. It shares a family with body text, so the role is carried by size and tighter tracking rather than a different face. Restraint is the point; it never appears on a card.
- **UI and body** — Roboto, 400/500/600. Roboto ships as a variable font (100–900), so every weight in the scale below is real, not synthesised.
- **Data** — Roboto Mono, for dates, card ids, counts, WIP limits. A dev tool should signal what's data and what's prose, and the subject's own world already reads monospace. This is the one distinction worth a second family.

Both are OFL-1.1 and load through `next/font/google`, which self-hosts them at
build time — no runtime request to Google, and nothing to commit.

This replaces an earlier brief that specified Clash Grotesk and General Sans from
Fontshare. That licence forbids redistributing the files through a public
repository, and this repo is public. Roboto was chosen to make the question go
away rather than to win a typography argument — so do not re-litigate it, and do
not add a third family. If display ever needs to look genuinely distinct again,
Roboto Serif and Roboto Condensed are OFL and stay inside this decision.

Scale: card title 14/20 500 · card meta 12 mono · column header 12 600 uppercase, 0.08em tracking · body 15/24 · board title 22 display.

### Surfaces and motion

- Radii: card 10, control 8, modal 16. Not zero (that's a broadsheet affectation) and not pills everywhere.
- Cards are `--surface` with a 1px `--line` border and a shadow so soft it's felt rather than seen. The card being dragged gets a real shadow, `scale(1.02)`, and a 3° tilt — the one place the interface acknowledges physicality.
- Drop settle: 180ms `cubic-bezier(0.2, 0, 0, 1)`, transform only, never layout properties.
- Cards arriving in a column — created locally or pushed from a teammate — fade in over 200ms with a 4px rise.
- When a teammate's change arrives over Pusher, the affected card fades a 1.5s ring in that user's avatar colour. Quiet, but you always know something moved and who moved it.
- `prefers-reduced-motion`: no tilt, no rise, no ring animation — cards appear in place, and the ring fades in and out without transform.

### Constraints

- Dark and light both ship. Default to system preference. Every token above has both values; nothing is hardcoded.
- The account menu carries the theme control: System / Light / Dark. "System" **clears** the stored preference rather than storing a resolved value, which is what lets the pre-paint script's `matchMedia` fallback apply again — storing "light" would pin the choice forever. Choosing "System" resolves the theme once, at the click; a later OS change lands on the next load, matching what the pre-paint script already does. One behaviour, not two.
- Re-tokenise shadcn/ui rather than using its defaults. Untouched shadcn is instantly recognisable and undoes everything above.
- Quality floor, unannounced: keyboard focus visible everywhere (2px accent ring, 2px offset), 4.5:1 on body text, board usable at 360px by collapsing to one column with a column switcher.

### Copy

Active voice, sentence case, no filler. A control says what happens: "Add card", not "Submit". The name survives the whole flow — the button that says "Save changes" produces "Changes saved".

Empty states are invitations, not apologies: an empty column reads "Nothing here yet"; a new board reads "Add your first card." Errors say what happened and what to do, in the interface's voice, and never apologise. Sign-in offers "Continue with Google" and "Continue with GitHub" — nothing else on the screen.

## UI conventions

- Server Components by default. `'use client'` only where interaction demands it — the board canvas, the modal, forms.
- Dates: store UTC `timestamptz`, render in the viewer's locale. Due dates are date-only in the UI.
- The board scrolls horizontally, columns scroll vertically inside a fixed viewport height. Body scroll stays locked on the board route.
- Columns are 300px fixed width with 12px gutters on desktop. Below 700px the board switches to one full-width column at a time with a column switcher, and horizontal scroll is dropped rather than shrunk.
- Optimistic UI everywhere for card and comment creation.
- Density is comfortable by default; don't add a density toggle.
- Loading states are skeletons matching final layout, not spinners.

## Deployment

**Vercel is production.** Docker exists for local development and for anyone self-hosting; it is not the deployment path, so don't optimise the app for a long-lived process.

What that constrains:

- No in-memory state between requests — no module-level caches, no per-process job queues, no open sockets held across invocations. The pooled db client in `lib/db/index.ts` is the single deliberate exception: it's a connection pool reused within a warm instance, not state, and it must hold no request-scoped data.
- Migrations do **not** run at boot, and never from `instrumentation.ts` or a route handler. CI runs `pnpm db:migrate` against its own throwaway Postgres on every pull request, which proves the migration applies to an empty database — it does not gate production. **Production is migrated by hand:** Vercel deploys straight from a push to `main`, so CI can race that promotion but cannot block it. Run `pnpm db:migrate` against production yourself in the same sitting as the merge, and read the table list back to confirm it — see "Commands" for the incident that makes both halves of that a rule rather than advice.
- Use Neon's pooled connection string in `DATABASE_URL`; drizzle-kit uses the direct (unpooled) URL via `DATABASE_URL_UNPOOLED`.
- `vercel.json` pins `regions: ["fra1"]`. Functions defaulted to `iad1` — observed as
  `x-vercel-id: fra1::iad1::…`, where the first segment is only the edge PoP — which put every read
  and write of board data in the US while Neon sits in `eu-central-1`. `/privacy` now names Frankfurt
  as the processing region, so this is a claim in a published legal document, not a latency
  preference. `app/(legal)/privacy/page.test.tsx` asserts the two agree. Verify a change here with
  the header on a **function** response (`/api/health`), never a static one.
- `/privacy` names Cloudflare R2's attachment storage as EU, jurisdiction-restricted — the same shape
  of claim as the `fra1` region note above, and it needs the same kind of verification, not a reading
  of the dashboard. Production is configured with the account's **EU-jurisdiction** endpoint,
  `https://<account_id>.eu.r2.cloudflarestorage.com`, and a bucket created against that endpoint is
  reachable *only* through it — the plain `r2.cloudflarestorage.com` host cannot see the bucket at
  all, it doesn't 403, it has no knowledge of it. That is what makes the claim true rather than
  aspirational: it isn't a setting that could quietly drift, it's a different endpoint the bucket
  doesn't exist behind. Verify a change here by requesting the bucket against the plain endpoint and
  confirming it cannot be found, the same way `fra1` is verified from a response header rather than
  from `vercel.json`. The bucket is `work-planner`; its account id lives only in Vercel's
  `S3_ENDPOINT` and is deliberately not written down here, since this repository is public.
  **Partially verified 2026-09-03:** the CORS preflight above answers `204` on the `.eu.` host and
  `403` on the plain one, which is what "the plain host has no knowledge of this bucket" looks like
  from outside. That is evidence, not proof — an unauthenticated `GET` cannot discriminate, because
  both hosts answer `400 InvalidArgument: Authorization`, checking the signature before the bucket.
  The conclusive check is an authenticated `HeadBucket` against the plain endpoint expecting
  `NoSuchBucket` rather than `AccessDenied`, and it has not been run.
- The browser PUTs a presigned upload straight to R2, which makes it a cross-origin request, and
  Cloudflare documents that a bucket with no CORS policy refuses that upload even though the presigned
  URL itself is valid (https://developers.cloudflare.com/r2/buckets/cors/). Neither local MinIO nor
  CI's MinIO catches a missing policy — both default to allowing every origin — so a green e2e run
  proves nothing about R2. **Verified 2026-09-03** against the production bucket from the outside,
  with an unauthenticated `OPTIONS` preflight rather than a dashboard reading: both production aliases
  (`work-planner-seven.vercel.app`, `work-planner-jimbimczs-projects.vercel.app`) answer `204` with
  `Access-Control-Allow-Origin` echoing the origin, `Allow-Methods: PUT`, `Allow-Headers:
  content-type`, `Max-Age: 3600`; an unlisted origin answers `403`, so the policy is scoped rather
  than open. `content-type` is the whole of `AllowedHeaders` because it is the only header the
  uploader sets (`components/board/card-attachments.tsx:50`), and `PUT` the whole of `AllowedMethods`
  because downloads are an `<a href>` and an `<img src>` to `/api/attachments/[id]`, which no
  preflight covers. Preview deployments each get their own origin and are deliberately **not** listed:
  a preview that could upload would write into the production bucket. Re-run the preflight after any
  change to the policy or to the production domain.
- **A malformed `S3_*` value reads to the user as a network failure, not a misconfiguration.**
  `lib/storage.ts` checks only that the five variables are *present*; an `S3_ENDPOINT` that does not
  parse throws `TypeError: Invalid URL` inside the server action, which rejects rather than returning
  a refusal, and `lib/attempt.ts` maps any rejection to `UNREACHABLE` — rendered as "Could not reach
  the server. Try again." Production hit exactly this on 2026-09-03 by storing the literal
  `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` placeholder. The evidence was in Vercel's runtime
  errors, which name the offending `input`; the message in the browser points at the wrong layer, so
  read the logs before believing it.
- **After changing a production variable, redeploy *and* reload the tab.** Vercel pins a page's
  server-action requests back to the deployment that rendered it, so an open tab keeps calling the old
  build and its old environment. The same 2026-09-03 fix appeared not to work for exactly this reason:
  the alias already pointed at the new deployment while the failing request was still being served by
  the previous one, which the error group's `lastDeployment` is what revealed.
- Preview deployments get their own Neon branch. OAuth callback URLs must include the preview domain pattern or sign-in will fail on previews — expect to test auth on a stable preview alias.
- Local development uses the Neon `dev` branch, never production `main`. The integration scopes its variables to Production and Preview only, so a bare `vercel env pull` finds nothing; `pnpm db:dev-branch` creates the branch and registers it as Development-scoped, and `pnpm env:pull development` refreshes `.env.local` from it.
- `AUTH_URL`/`AUTH_TRUST_HOST` need care on previews. Set `AUTH_TRUST_HOST=true` and let Auth.js infer the host rather than hardcoding.

Docker (local/self-host): multi-stage deps → build → runner on `node:22-alpine`, `output: 'standalone'` enabled by `DOCKER_BUILD=1` in the build stage (Vercel builds must use Next's default output), non-root `nextjs` user, `HOSTNAME=0.0.0.0`. `docker-compose.yml` runs app + local Postgres + a `minio` service for attachment storage, plus a one-shot `minio-init` (`minio/mc`) that creates the `kanban-attachments` bucket and exits — the app must never create its own bucket, since that would be boot-time state, which this section's constraints rule out. Add `/api/health` for the container healthcheck. Keep secrets out of `NEXT_PUBLIC_*` — those are inlined at build time. A self-hoster who wants realtime supplies `NEXT_PUBLIC_PUSHER_KEY` and `NEXT_PUBLIC_PUSHER_CLUSTER` as `docker compose` build arguments (`docker-compose.yml`'s `app.build.args`), not just runtime environment — the build stage inlines them, so a runtime-only value ships an undefined key to the client. Absent the five `S3_*` variables the app builds and runs correctly with no attachment surface at all, which is the supported no-bucket configuration for a self-hoster who doesn't want the extra service.

CI starts MinIO with an explicit `docker run` step rather than a `services:` entry, because GitHub Actions' `services:` block cannot override a container's command and `minio/minio` needs `server /data` to actually serve. CI also has no `minio-init` equivalent, so it creates the bucket itself with `mc` after waiting on the health endpoint — `.github/workflows/ci.yml`'s "Start MinIO" step does both in one place.

Env vars:

```
DATABASE_URL                  # pooled
DATABASE_URL_UNPOOLED         # migrations only
MIGRATE_URL                   # optional, names the target for one db:migrate run
AUTH_SECRET
AUTH_TRUST_HOST
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
AUTH_GITHUB_ID / AUTH_GITHUB_SECRET
PUSHER_APP_ID / PUSHER_SECRET
NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER   # cluster is read by both sides
NEXT_PUBLIC_SITE_URL          # canonical URL, used in the policy and metadata
S3_ENDPOINT                   # MinIO locally/self-host; R2's EU-jurisdiction endpoint in production
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY          # absent, any of the five: no attachment surface renders
```

`.env.example` is committed and stays in sync. `.env*` is not.

## Footer and legal pages

A `SiteFooter` with a link to `/privacy` renders on every route **except the board view**, signed in or not. Keep it low-weight: a server component, no client JS.

It is rendered by each route-group layout — `(app)/(chrome)`, `(auth)`, `(legal)` and `app/design` — rather than by the root layout. A child layout cannot remove a parent's footer, so the board view can only opt out if the root layout never adds one. The cost is that a **new top-level route group has no footer until you give it a layout**; `e2e/board-view.spec.ts` names every route that must keep it, so add to that list rather than discovering the gap in review.

The board is the exception because it locks body scroll to a fixed viewport height, so a footer below it would be unreachable. There, the privacy link lives in the account menu instead. The link must be reachable from every route one way or the other — that is the requirement, not the footer specifically.

`/privacy` is a static page (`export const dynamic = 'force-static'`), plain content in the repo rather than a CMS, with a "last updated" date that is edited whenever the policy changes. `/terms` follows the same shape if it gets added.

The policy is a real legal document, not filler text. It must cover what the app actually does:

- **Controller and contact** — who operates the service and an email for data requests.
- **What is collected**: OAuth profile data from Google/GitHub (name, email address, avatar URL, provider account id); board, column, card and comment content the user creates; session cookie.
- **Why, and on what legal basis** — contract performance for the account and board data; legitimate interest for security and abuse prevention. There is no marketing use.
- **Cookies** — session cookie plus Auth.js CSRF/callback cookies only. All strictly necessary, so no consent banner is needed. **If analytics, session replay, or any third-party script is ever added, this changes and a consent mechanism becomes required** — flag it rather than shipping it quietly.
- **Sub-processors** — Vercel (hosting), Neon (database), Pusher (realtime), Google and GitHub (authentication). Name them, and say where data is hosted; pin Neon and Vercel to an EU region so this stays a simple answer.
- **Content visibility** — anything written on a shared board is visible to that board's other members. Users should be told this plainly.
- **Retention and deletion** — how long data is kept, and that deleting an account removes their boards and anonymises or removes their comments. Whatever the policy claims here must actually be implemented; do not write a deletion promise the code cannot honour.
- **GDPR rights** — access, rectification, erasure, portability, objection, and the right to complain to a supervisory authority (Úřad pro ochranu osobních údajů for a Czech controller).
- **Changes to the policy** and how users are notified.

If a claim in the policy and the behaviour of the code disagree, the code is the bug or the policy is — either way, stop and raise it. Don't let them drift.

This file is guidance for building the page, not legal advice; the final text should be reviewed by someone qualified before the app takes real users.

## Working rules for the agent

### Never assume — prove it

This rule outranks everything else in this file. If you find yourself about to state something you have not verified, stop and verify it.

- Don't claim code works, a bug is fixed, or something is wired up until you've run it and read the output. "Should work" is not a status.
- Don't guess at an API surface, a library's behaviour, a config option, or a type signature. Read the source, the types, or the current docs. A plausible-looking method name that doesn't exist costs more than the lookup would have.
- Don't assume a file's contents, that a value is present, that a migration ran, that an env var is set, or that the schema matches what this document says. Check.
- Don't assume the cause of a failure. Reproduce it, find the root cause, then fix — never patch at the first symptom that makes the error message go away.
- When you can't verify something, say so explicitly and say what would be needed to verify it. An honest "I haven't confirmed this" is useful; a confident wrong answer is not.
- Report what you actually observed, not what you expected to observe. If the test output was ambiguous, that's the finding.
- **Read the exit code, and make sure it is the one you think it is.** A shell pipeline exits with the
  status of its *last* command, so `pnpm exec playwright test | tail -5` reports `tail`'s success and a
  failing suite announces itself as "exited with code 0". `vitest`, `tsc` and `eslint` pipe the same
  way. Redirect to a file and echo `$?`:

  ```bash
  pnpm exec playwright test --reporter=line > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/e2e.log
  ```

  This is not hypothetical. Three failing e2e tests survived three commits during Section E of the
  board canvas behind a piped "code 0", and were only caught when a count disagreed — 46 passing
  against 49 collected. **A summary line is not an exit code, and a passing count is not a passing
  suite.** Compare the number that ran against the number that exists when it matters.
  (`set -o pipefail` fixes the pipeline, but reading `$?` directly is what actually gets checked.)

Uncertainty stated plainly is always preferable to fluent guessing. I would rather be asked than told something untrue.

### Workflow — brainstorm, then plan, then implement

This project uses the **Superpowers** plugin. Do not jump from a request to code.

1. `/superpowers:brainstorm` — Socratic questioning until the requirement is actually understood, ending in a spec written to `docs/specs/<feature>.md` and reviewed by me before anything else happens. If the request is vague, that is the signal to brainstorm harder, not to guess.
2. `/superpowers:write-plan` — decompose the approved spec into small, individually verifiable tasks with exact file paths, the failing test, the minimal implementation, and a commit message. The plan lives in `docs/plans/<feature>.md` with checkboxes.
3. `/superpowers:execute-plan` — work the plan in batches, checking boxes as you go. The checkboxes are the state log; if a session dies, they're how the next one knows where to resume.
4. `/superpowers:review` before the branch is considered finished.

Consequences to accept, not work around:

- TDD is red-green-refactor. Test first, watch it fail, then the minimal code. Don't write implementation and backfill tests.
- YAGNI. Build the simplest thing that satisfies the spec. The spec's out-of-scope list is the answer to every "it would be nice to also…" impulse.
- If a feature turns out to be several independent subsystems, say so and decompose it into sub-projects, each with its own spec → plan → implementation cycle. Don't spec a whole platform in one pass.
- No skipping stages because something looks trivial. The deceptively simple requests are the ones that turn into scope creep.

### Model selection

Fixed, and not a per-task judgement call:

| Work | Model |
|---|---|
| Brainstorming, planning, writing specs | Opus |
| Final whole-branch review, before a section's PR | Opus |
| Per-task review and scoped re-review | Sonnet |
| Implementation | Sonnet |

This applies to the main session and to every subagent. Always pass the model
explicitly when dispatching a subagent: an omitted model silently inherits the
caller's, which defeats the whole table.

The split between the two review rows is deliberate. A per-task review reads one
task's diff against one brief — a narrow, well-bounded question that Sonnet
answers reliably. The final review reads the whole branch against the spec, the
plan and this file at once, and that is where breadth pays for itself.

The evidence is from this repository. During Section A the per-task reviews
passed the scaffold as compliant, and each was right about the diff it was given.
The final review then found that `pnpm typecheck` succeeded locally but would
fail on every clean checkout and in CI, because `app/layout.tsx` used
`LayoutProps`, a Next 16 typegen global emitted into gitignored `.next/types/`.
Seeing that needed the branch, the CI job planned three sections later, and the
pre-push gate this file mandates — none of which is visible in a single task's
diff. Do not economise on the final review.

Implementation is the opposite case: when a plan carries the exact code to write,
implementation is transcription plus verification, and Sonnet does it at a
fraction of the cost with no observed quality loss across Section A's four
implementation dispatches.

### Increments

- Work in small increments. One coherent change at a time, verified, committed, then the next.
- Do not produce huge blocks of output or rewrite half the app in a single step. Large uninterrupted stretches burn context, bury mistakes, and are miserable to review.
- Prefer many small commits over one large one. Each should leave the app in a working state.
- If a task is growing past what fits comfortably in one step, stop and split it rather than pushing through.

### Branches and pull requests

Remote: `https://github.com/JimBimCZ/work-planner`

One section of the plan, one branch, one PR. Ship the PR as soon as the section is done — don't batch several sections into one branch, and don't keep working past the point where a section is reviewable. More, smaller PRs is the explicit goal: it keeps reviews cheap, keeps each change revertible, and keeps a session from carrying a huge amount of context that will be lost anyway when it ends.

- Never commit directly to the default branch. Branch per section: `feat/<feature>-<section>`, `fix/<what>`, `chore/<what>`.
- Before pushing anything: `pnpm typecheck && pnpm lint && pnpm test`. A PR whose checks you haven't watched pass is not ready.
- Commit as you go, one concern per commit, imperative subject line. Each commit leaves the app working.
- Tick the plan's checkboxes in the same PR that does the work, so the plan document and the branch never disagree.
- Open the PR with `gh pr create`. The body states: which spec and plan section this implements, what was verified and how (actual observed output, not intent), anything deliberately left out, and screenshots for any UI change.
- **If the section carried a migration, apply it to production the moment the PR merges**, and confirm by reading the table list back. The merge is the deploy; a migration sitting unapplied is a production outage waiting for the next reader. See "Commands".
- Then stop and hand back. Opening the PR is the checkpoint — start the next section in a fresh session from the plan document rather than continuing on a full context.
- Do not merge your own PR. Wait for review.
- If a section depends on one still in review, stack it: branch from that branch and set the PR base to it. Say so in the body.
- **A stack merges child first, then parent.** The child's PR targets the parent
  branch, so merging the parent into `main` first consumes the base and the
  child's later merge lands in a branch `main` no longer tracks. GitHub still
  reports it as merged, and nothing in the PR list looks wrong. This has
  happened twice — Section C via #36, then Section D via #38, both stranded on
  `feat/boards-permissions` and both needing a recovery PR. Prefer branching the
  next section from `main` once its parent has landed; stack only while the
  parent is genuinely still open, and merge bottom-up. Before starting a
  section, confirm its base is real:
  `git merge-base --is-ancestor <parent-tip> origin/main`.
- Never force-push a branch that has an open PR, and never rebase a branch someone may have pulled.
- If the Vercel preview or CI fails, fix it on the same branch. Don't open a replacement PR.
- Nothing secret is ever committed. `.env*` stays ignored; `.env.example` is the only env file in the repo.

`/superpowers:finishing-a-development-branch` handles verification and branch cleanup at the end — use it rather than hand-rolling the wrap-up.

### External tools

- Anything you open, you close. Dev browsers, headless browser sessions, background dev servers, tunnels, docker containers spun up for a check, database sessions — shut them down when the task that needed them is done.
- Don't leave a process running "in case it's useful later". Restart it when it's needed.
- Clean up temporary files, scratch branches, and test data you created.

### Code

- **No unnecessary comments.** Comment only non-obvious decisions — a rank tie-break, a cache invalidation subtlety. Never narrate what the code plainly says.
- Read the surrounding files before editing. Match existing patterns rather than introducing a second way of doing the same thing.
- Prefer editing existing files over adding new ones. No barrel files.
- No `any`, no non-null assertions to silence the compiler, no `@ts-expect-error` without an explanation on the line above.
- Schema changes go through `db:generate` — never hand-edit generated migrations, never `db:push` against anything but a scratch branch.
- If a requirement here conflicts with what you're being asked to build, say so and stop. Don't quietly pick one.
- Keep this file current. When an architectural decision changes, update the relevant section in the same change.

## Open decisions

Not settled yet — raise these rather than deciding unilaterally:

- Activity log.
- Board archive vs hard delete.

**Account deletion is settled** and built: self-service from `/account`, immediate, hard delete, in
one transaction. It is blocked while the user still owns a board someone else is a member of; the
way out is to delete that board or hand it to one of its members from that board's members dialog —
the danger zone offers both. The same transaction deletes any pending `board_invites` addressed to
the departing address, because invites key on an address and no foreign key cascades them. Comments
on other people's boards survive with `authorId` null, so a request to remove those has to reach the
mailbox `/privacy` names *before* the account goes; the danger zone says so, because afterwards
nothing links them back. `docs/specs/account-deletion.md` holds the reasoning.

**Labels are settled** and built: a per-board vocabulary, applied from the card modal, filtered from
the board header, managed from the filter popover, and kept live over four Pusher events.
`docs/specs/labels.md` holds the reasoning — including why they carry no colour.

**Attachments are settled** and built: a per-card file list in the card modal, uploaded straight to
the bucket from the browser against a presigned PUT and confirmed server-side with a `HEAD`, served
back through `/api/attachments/[attachmentId]`, capped six ways in `lib/attachments-limits.ts`, and
kept live over two Pusher events with a count on the card face. The uploader or the board owner may
delete one — the single place a board owner outranks an author, and "Auth and permissions" says why.
`docs/specs/attachments.md` holds the reasoning.

Remaining sub-projects: member management and invites is shipped in full, Sections A–D; labels the
same, Sections A–D; attachments the same, Sections A–D. Nothing is queued behind them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
