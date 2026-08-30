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
| Tests | Vitest (unit), Playwright (e2e) | |
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

`db:migrate` uses `DATABASE_URL_UNPOOLED` and never runs at application startup. CI runs it against its own throwaway Postgres on every pull request, which proves the migration applies to an empty database. **Production is migrated by hand.** Vercel deploys straight from a push to `main`, so CI can race that promotion but cannot gate it; rather than describe a gate that does not exist, run `pnpm db:migrate` against production yourself when a migration lands. The window in which the deployed app expects tables that are not there yet is minutes, and costs nothing until the service has users.

`drizzle.config.ts` loads `.env.local` itself and lets it override `.env`. drizzle-kit only auto-loads
`.env`, so without that the app talks to Neon while migrations silently hit the docker Postgres in
`.env` — the two drift with no error. A variable set in the shell outranks both, so
`DATABASE_URL_UNPOOLED=<production> pnpm db:migrate` migrates what it names — **this is how production
is migrated.** That override is not cosmetic: the config used to replace `process.env` unconditionally,
so the same command migrated the `.env.local` database and still printed `migrations applied
successfully!`. Because drizzle-kit has already loaded `.env` before the config evaluates, "set in the
shell" is decided by comparing against `.env`'s own value, not by presence in `process.env`. Also note `drizzle-kit migrate` exits 1 with an empty stderr
when `lib/db/migrations/` does not exist; the first `db:generate` creates it.

Before declaring any task done, run `pnpm typecheck && pnpm lint && pnpm test`. Do not report success on output you have not seen.

## Layout

```
app/
  (auth)/signin/            # OAuth entry, no credentials form
  (app)/                    # session check only; each group below renders its
                            # own TopBar, because the board needs a title in it
    (chrome)/               # normal page scroll, SiteFooter below the content
      boards/               # board list
    (board)/                # fixed viewport height, no footer
      boards/[boardId]/     # board view — its layout resolves the board title
        @card/(.)cards/[cardId]/  # intercepted — renders as modal over the board
    cards/[cardId]/         # canonical card page — the intercept target, and what
                            # a shared link opens on a cold load
  (legal)/
    privacy/page.tsx        # Privacy Policy
    terms/page.tsx          # optional, same layout
  api/
    auth/[...nextauth]/
    pusher/auth/            # private-channel authorisation
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
  permissions.ts            # single source of truth for access checks
  rank.ts                   # fractional index helpers
  events.ts                 # Pusher publish helpers + event types
docs/
  specs/                    # brainstorm output, one per feature
  plans/                    # implementation plans with checkboxes
proxy.ts                    # Next 16's renamed middleware: cookie-presence
                            # redirect on /boards/*. Imports nothing from lib/
```

The card modal is an intercepting parallel route, so cards have shareable URLs and browser-back closes the modal. Both halves are required: the intercept renders the modal over the board for in-app navigation, and the canonical `/cards/[cardId]` page is what a pasted link opens on a cold load. Do not replace either with local modal state.

## Data model

```
users              id, name, email, image                      (Auth.js)
accounts,
sessions,
verificationTokens                                             (Auth.js adapter tables)

boards             id, name, ownerId, createdAt, updatedAt
board_members      boardId, userId, role ('owner'|'member'|'viewer')   PK (boardId, userId)
columns            id, boardId, name, rank, createdAt
cards              id, boardId, columnId, title, description,
                   dueDate, rank, createdById, createdAt, updatedAt
comments           id, cardId, authorId, body, createdAt, updatedAt
```

Rules:

- `cards.boardId` is denormalised deliberately — every permission check and every realtime event keys off the board, and this avoids a join on the hot path. Keep it consistent with `columnId`'s board in every write.
- Deleting a column requires a target column to move its cards into. Never cascade-delete cards with the column.
- Comments and cards are soft-delete free for now: hard delete, but only via an action that checks role.
- Index `cards(columnId, rank)`, `cards(boardId)`, `comments(cardId, createdAt)`, `board_members(userId)`.
- `cards.assigneeId` and `columns.wipLimit` were **dropped, not deferred.** Both were speculative — no requirement, no UI, no enforcement rule — and YAGNI says an unused column is a liability, not a head start. Adding either later is one migration; carrying a column nothing writes to costs a permanent explanation. Do not reintroduce them without a requirement that needs them.

## Ordering: fractional ranks

`columns.rank` and `cards.rank` are `text`, generated with the `fractional-indexing` package, ordered lexicographically.

Reason: two users dragging cards at the same time must not need a table-wide reindex. A move writes exactly one row — the moved card gets a rank between its new neighbours.

```ts
// lib/rank.ts
import { generateKeyBetween } from 'fractional-indexing';
export const rankBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);
```

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
- Client ignores events it caused itself, matched on a client-generated `mutationId` echoed in the payload.
- Events: `card.created`, `card.updated`, `card.moved`, `card.deleted`, `column.*`, `comment.created`.
- Payloads carry the changed entity, not a full board refetch. Keep them under Pusher's 10KB message limit — long descriptions ship as `{ id, updatedAt }` and the client refetches that card.
- Presence channels (who else is viewing the board) are a later addition, not part of the first build.

Last-write-wins on card fields is acceptable. Do not build OT/CRDT text merging for descriptions.

Ably is an acceptable substitute if Pusher's free tier proves too small. Polling is not — a 5s poll of a full board burns more function invocations than the pub/sub costs.

## Auth and permissions

- `lib/auth.ts` exports `auth`, `handlers`, `signIn`, `signOut`. Drizzle adapter, `session.strategy = 'database'`.
- `proxy.ts` protects `/boards/*` and redirects unauthenticated users to `/signin`. Next 16 renamed the `middleware` convention to `proxy`; it defaults to the Node.js runtime and its `runtime` option cannot be set. It checks only that a session cookie is present and imports nothing from `lib/`, because Next's own documentation warns that this file may be deployed away from the app runtime and must not rely on shared modules — `lib/db` holds a connection pool.
- **Every server action and route handler independently re-checks permission.** The proxy is routing, not authorisation.
- All checks go through `lib/permissions.ts`: `assertBoardAccess(userId, boardId, minRole)`. Never inline a membership query in an action.
- `viewer` can read and comment; `member` can mutate cards and columns; `owner` can manage members and delete the board.
- Invite flow: owner adds a member by email. If no user exists with that email, store a pending invite keyed on email and resolve it at first sign-in.

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
3. **Time** — the only warm colour in the entire app, reserved exclusively for due dates. Because nothing else is warm, an overdue card pulls the eye across the whole board with a 2px strip and no badge shouting.

Do not add a fourth role. If something needs emphasis, it needs hierarchy or spacing, not a new hue.

Avatar colours are the one exception, and they are constrained: derive them by hashing the user id onto the **cool** half of the wheel only (180°–300°). They must never stray warm, or they'd compete with the time signal, and they must never land on the accent teal.

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
- Migrations do **not** run at boot, and never from `instrumentation.ts` or a route handler. CI runs `pnpm db:migrate` against its own throwaway Postgres on every pull request, which proves the migration applies to an empty database — it does not gate production. **Production is migrated by hand:** Vercel deploys straight from a push to `main`, so CI can race that promotion but cannot block it. Run `pnpm db:migrate` against production yourself when a migration lands.
- Use Neon's pooled connection string in `DATABASE_URL`; drizzle-kit uses the direct (unpooled) URL via `DATABASE_URL_UNPOOLED`.
- Preview deployments get their own Neon branch. OAuth callback URLs must include the preview domain pattern or sign-in will fail on previews — expect to test auth on a stable preview alias.
- Local development uses the Neon `dev` branch, never production `main`. The integration scopes its variables to Production and Preview only, so a bare `vercel env pull` finds nothing; `pnpm db:dev-branch` creates the branch and registers it as Development-scoped, and `pnpm env:pull development` refreshes `.env.local` from it.
- `AUTH_URL`/`AUTH_TRUST_HOST` need care on previews. Set `AUTH_TRUST_HOST=true` and let Auth.js infer the host rather than hardcoding.

Docker (local/self-host): multi-stage deps → build → runner on `node:22-alpine`, `output: 'standalone'` enabled by `DOCKER_BUILD=1` in the build stage (Vercel builds must use Next's default output), non-root `nextjs` user, `HOSTNAME=0.0.0.0`. `docker-compose.yml` runs app + local Postgres. Add `/api/health` for the container healthcheck. Keep secrets out of `NEXT_PUBLIC_*` — those are inlined at build time.

Env vars:

```
DATABASE_URL                  # pooled
DATABASE_URL_UNPOOLED         # migrations only
AUTH_SECRET
AUTH_TRUST_HOST
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
AUTH_GITHUB_ID / AUTH_GITHUB_SECRET
PUSHER_APP_ID / PUSHER_SECRET
NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER   # cluster is read by both sides
NEXT_PUBLIC_SITE_URL          # canonical URL, used in the policy and metadata
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
- Then stop and hand back. Opening the PR is the checkpoint — start the next section in a fresh session from the plan document rather than continuing on a full context.
- Do not merge your own PR. Wait for review.
- If a section depends on one still in review, stack it: branch from that branch and set the PR base to it. Say so in the body.
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

- Labels/tags, attachments, activity log.
- Whether comments need editing/deletion beyond the author's own.
- Board archive vs hard delete.
- Account deletion mechanics — self-service in the UI, or on request by email. The privacy policy has to describe whichever is real.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
