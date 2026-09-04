# Spec: Demo board

Status: approved, not yet implemented
Brainstormed: 2026-09-04

## Goal

Let someone who has never signed in see the board, and move a card on it, before they are asked
for an account.

Today `app/page.tsx` is a bare `redirect('/boards')`, `proxy.ts` bounces `/boards/*` without a
session cookie, and `(app)/layout.tsx` redirects again — so the first and only thing a visitor
sees is two OAuth buttons. The product is a board, and nobody has looked at one. This spec gives
`/` a real board, rendered from a fixture in the repository, that a signed-out visitor can drag
cards around on.

**No board content a visitor produces is written anywhere.** Not to a database, not to a
session, not to `localStorage`. A drag mutates the client's reducer and stops there; a reload
restores the board exactly as it shipped. The one thing that *is* stored is a flag recording
that the guided tour has been seen (`docs/specs/demo-tour.md`) — not board content, not sent
anywhere, and not readable by the server.

## Non-goals

- **No anonymous write reaches the server.** No server action, no route handler, no `db` query on
  behalf of a visitor. Not "rejected if it happens" — never called.
- **No hole in `lib/permissions.ts`.** `assertBoardAccess` is not touched, not special-cased and
  not consulted: the demo never asks it a question, because there is no board row to ask about.
  A `DEMO_BOARD_ID` env var was considered and rejected — see "Settled while brainstorming".
- **No schema change, no migration, no seed script, no board row.**
- **No realtime.** The demo opens no Pusher connection. `/api/pusher/auth` is unchanged and keeps
  rejecting everything unauthenticated.
- **No members, no activity drawer, no attachments, no label filter, no comment composer, no card
  creation, deletion or renaming.** The demo is a board you can read and drag.
- **No `/demo` alias.** One route, `/`.
- **No marketing page.** No hero copy, no feature grid, no pricing, no OG image work, no
  sitemap. The board is the pitch — which is why the guided tour in
  `docs/specs/demo-tour.md` points at the board rather than describing the product.
- **No change to `/signin`.** `CLAUDE.md` says that screen offers the two providers and nothing
  else, and it still does.

## Deliverables

### 1. The route

`app/page.tsx` is deleted and replaced by a new top-level route group, `app/(demo)/`, whose
`page.tsx` serves `/`.

```
app/(demo)/
  layout.tsx    # fixed viewport, no footer — the (board) treatment
  page.tsx      # auth() → redirect('/boards') when signed in; the demo otherwise
```

`page.tsx` is a Server Component. It calls `auth()` first: **a session redirects to `/boards`**,
so nothing changes for anyone who already has an account, and the demo is only ever rendered to a
visitor with no session. Signed out, it resolves the fixture against `new Date()` and renders the
canvas.

The page is dynamic rather than static, and does not need `force-dynamic` to say so: `auth()`
reads cookies. That is what makes the relative due dates in deliverable 2 work.

`proxy.ts` is untouched. Its matcher is `/boards/:path*`, so `/` was never in it — this is the
reason the demo lives at `/` and not at `/boards/demo`, which would need an exception carved into
the one file that exists to have no exceptions.

### 2. The fixture

New module `lib/demo-board.ts`. It imports nothing from `lib/db` and nothing from
`lib/permissions`, in the manner of `lib/labels-limits.ts`, so it is safe in a client bundle and
cannot grow a database read by accident. It takes `BoardWithCards` from `lib/boards.ts` with
**`import type`, never a value import**: that module builds on `lib/db`, which opens a `pg` pool at
module scope, and `CLAUDE.md` records that `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass
on that mistake — only `pnpm build` catches it.

```ts
export function demoBoard(now: Date): BoardWithCards
export function demoCard(cardId: string): DemoCardDetail | null
```

`demoBoard` returns the exact `BoardWithCards` shape `lib/boards.ts` already exports and
`toBoardState` already consumes, so the canvas receives what it always receives.

- **Ids are stable and deliberately not uuids** — `demo-col-progress`, `demo-card-migrate`.
  Nothing here may reach a server action, and a non-uuid id makes an accidental call fail loudly
  at the Zod boundary instead of touching a real row. The same property keeps the id out of
  `/api/pusher/auth`'s channel regex, which demands a uuid.
- **Ranks are literal fractional-indexing keys** (`a0`, `a1`, `a2`, …) written into the fixture,
  not generated at render. They only have to be ascending by code point, which is the same
  contract Postgres enforces under `C.UTF-8` (`CLAUDE.md`, "Ordering: fractional ranks").
- **Due dates are day offsets, not absolute dates**, resolved against `now`. A fixture that
  hardcoded a date would read `3d over` in the week it shipped and `300d over` a year later. One
  card is three days overdue and one falls due tomorrow — `dueState` in `lib/due.ts` calls a date
  `soon` at one day out or less, not three — and the rest carry no date.
- `createdAt` is likewise an offset, so the card modal's relative timestamps stay plausible.

Content: the five seeded column names (Ready to Work, In Progress, In Testing, In Review, Done),
around twelve cards that read like one team's week rather than `Card 1`/`Card 2`, five labels,
descriptions on three cards, an attachment count on one, and two cards carrying comments. The
comment authors are invented people with stable ids, so `avatarHue` gives them consistent colours
inside the cool half of the wheel it is already constrained to.

The content is edited in a pull request, like any other file. That is the trade this spec makes
for having no board row anywhere.

### 3. A canvas whose writes go nowhere

Three separate behaviours ride on `BoardCanvas`'s single `canWrite` prop today, and the demo needs
the first without the other two: **drag yes, write controls no, server never.**

- `BoardCanvas` gains a `demo` prop. Every mutation but create already funnels through one helper,
  `run(action, call, message)` at `components/board/board-canvas.tsx:364` — in demo it dispatches
  the action and returns before the `startTransition`, so the reducer moves and no action is
  called. Create, delete and rename are unreachable regardless, since their controls stay hidden
  behind `canWrite`.
- `useSortable` is disabled on `!canWrite` (`components/board/board-card.tsx:145`), so
  `board-card.tsx` and `board-column.tsx` take a `canDrag` prop alongside `canWrite`. The canvas
  passes `canDrag={canWrite || demo}`. Everything else keyed off `canWrite` — the `⋯` menus, the
  composer, the column controls — stays off, which is what makes the demo read-only in every
  direction except the one it is demonstrating.
- The card face is a `Link` to `/boards/…/cards/…` (`components/board/board-card.tsx:194`), and
  in demo it must not be. The intercepting route does not exist under `/`, so that link opens a
  signed-in-only URL and bounces a visitor to `/signin` — from a middle-click, a long-press or the
  status bar they read before clicking. Section A therefore renders the title as plain text in
  demo mode, from the same branch the `pending` case already uses; Section C turns that into a
  button once there is a panel for it to open. At no point is it a link.

**`RealtimeProvider` accepts `boardId: string | null`, and null never opens a socket.** The
canvas calls `useRealtime()` unconditionally, so the provider has to be present; without this
change every anonymous visitor would open a Pusher connection and subscribe to a channel
`/api/pusher/auth` is guaranteed to reject — the board id is not a uuid — burning free-tier
connections to fail, on the app's most-visited route. Status stays `off`, which is the same
supported configuration a self-hoster without Pusher credentials already gets.

The canvas's reconnect catch-up needs nothing: it is gated on `reconnected === 0` returning early
(`board-canvas.tsx:292`), and with no connection `reconnected` never moves off zero, so
`readBoard` is never called.

### 4. The card, read-only

Clicking a card opens a dialog held in the demo page's local state — not the intercepting parallel
route, which does not exist here. `components/demo/demo-card.tsx` renders title, description, due
date, labels and comments, all read-only, inside the existing `components/ui/dialog.tsx`. Escape,
the backdrop and the close button dismiss it.

It deliberately does **not** reuse `components/board/card-body.tsx`. That component calls
`readComments` on mount through `CardComments`, mounts `CardAttachments`, and imports four server
actions plus `useRealtime` and `useBoardActions`; it is 388 lines that exist to talk to a server
the demo does not have. Threading "no server, no realtime, no viewer, nothing editable" through it
would make the real card surface harder to read in order to serve the fake one.

### 5. The top bar

The demo renders the real `components/app/top-bar.tsx`, whose four viewer props
(`userId`, `name`, `email`, `image`) collapse into a single optional `viewer` object. When it is
absent, no `AccountMenu` renders. Both existing call sites — `(app)/(chrome)/layout.tsx:14` and
`(app)/(board)/boards/[boardId]/layout.tsx:54` — pass the object instead of four props and are
otherwise unchanged.

The bar carries, left to right: the fixture's board name; a mono `--muted` note reading
**"Nothing here is saved"**; a **Privacy** link; and one accent **Sign in** button linking to
`/signin`.

Two notes on that bar. The honesty line is a requirement, not decoration — a visitor who drags a
card, reloads, and finds it back where it started has been lied to unless the interface said so
first. Below 700px it truncates to `Demo`, where the two OAuth buttons would not have fitted
anyway.

And the button is one **Sign in**, not the two provider buttons: `CLAUDE.md` reserves "Continue
with Google" and "Continue with GitHub" for the sign-in screen, which is one click away, and
duplicating them in a top bar spends the app's single accent twice to ask the same question. This
revises the design as approved during brainstorming, and is the one place it does.

### 6. The privacy link, and the footer that is not there

The demo is a board: fixed viewport height, body scroll locked, so a `SiteFooter` below it would
be unreachable — the same reason the board view drops it (`CLAUDE.md`, "Footer and legal pages").
The board view's escape hatch is the account menu, which a signed-out visitor does not have. So
the link lives in the top bar, per deliverable 5.

`e2e/board-view.spec.ts` names every route that must keep the footer, precisely so a new route
group's missing footer is caught rather than discovered. `/` joins the footer-free list there,
with its own assertion that Privacy is reachable.

## What this costs, and why it is accepted

**A second rendering of the card surface.** `components/demo/demo-card.tsx` will drift from
`card-body.tsx` — a field added to the real card will not appear on the demo one, and nothing will
fail. This is accepted rather than solved: the alternative is a `canWrite`-plus-`viewer`-plus-`live`
matrix inside a 388-line component whose whole job is talking to a server, and a demo card that
lags one field behind is cheaper than a real card that is harder to read. The demo card is a
fixture rendering a fixture; when the two diverge visibly, update it in the same pull request that
diverged them.

**`/` stops being a redirect.** Anyone who bookmarked `/` expecting `/boards` now gets one
`auth()` call and a redirect instead of a redirect — no behaviour change for a signed-in user, one
extra render for a signed-out one.

**`TopBar` grows an optional shape.** Two call sites change to pass an object. Small, and it
replaces four props that always travelled together.

## Accessibility

- The card face becomes a `button` rather than a `Link` in demo mode; both are focusable and
  operable, and dnd-kit's `role="group"` on the card, its `aria-roledescription` and its drag
  announcements are untouched, so keyboard drag works on the demo exactly as it does on a board.
- The honesty note is real text in the bar, not a `title` attribute or a tooltip.
- The dialog uses the existing `components/ui/dialog.tsx`, so focus trapping, the `DialogTitle`
  accessible name and Escape handling come with it.
- Contrast, focus rings and the 360px single-column behaviour are inherited from the board canvas
  and unchanged.

## Colour rules this stays inside

- The demo introduces **no new hue and no new token.** Columns take their flow hues from position
  exactly as a real board does, since the fixture has five columns.
- The single accent on the page is the `Sign in` button — `--flow-mid`, the app's one accent.
- The overdue card renders `--time-over` and the due-soon card `--time-soon`, which is warm at
  rest on a board surface: the one use `CLAUDE.md` permits, and the reason the fixture carries a
  due date at all.
- No new gradient. The flow band and the header wash remain the whole budget.

## Testing

Component tests (`jsdom` pragma, hand-wired `afterEach(cleanup)`, per `CLAUDE.md`):

- `demoBoard(now)` returns columns in rank order, and card ranks ascend by code point within each
  column.
- For a `now` the test supplies, the offsets resolve to one `over` and one `soon` under
  `dueState`. The same assertion runs against a `now` a year later, and still reads `3d over` —
  this is the test that fails if someone replaces an offset with a literal date.
- **The demo canvas dispatches without calling the server**: render with `demo`, drag or invoke a
  move, and assert with the actions module mocked that no export was called. This is the spec's
  central claim and the one test that must not be skipped.
- `TopBar` with no `viewer` renders no account menu; with one, it does.
- `RealtimeProvider` with `boardId={null}` never constructs a Pusher client.
- `demo-card.tsx` renders description, labels, due date and comments, and offers no editable
  control.
- A card face in demo mode renders no `link` role — asserted from Section A onward, because the
  link is present today and only its absence is the correct behaviour here.

End-to-end, a new `e2e/demo.spec.ts`, signed out — no `seedSession`:

- `/` renders the demo board with its five columns and its cards.
- A card dragged to another column lands there.
- **A reload puts it back.** The proof that nothing persisted, and the reason this file exists.
- No "New card" button, no `⋯` menu on a card or a column, no composer.
- A card opens the panel and closes on Escape.
- Privacy is reachable from the top bar and no `contentinfo` is present.
- A signed-in visitor to `/` lands on `/boards` — this one seeds a session.

`pnpm build` must pass: `lib/demo-board.ts` is imported by a client component, so anything it
pulls in reaches the browser bundle. That is what would catch a `lib/db` import, and only a build
would.

## Sections and pull requests

One section, one branch, one PR, per `CLAUDE.md`.

- **Section A — the board a stranger can see.** The route group, the fixture, the top bar's
  optional viewer, the privacy link, `RealtimeProvider`'s nullable board id, the card title as
  plain text, and the canvas rendered read-only with no drag. Branch `feat/demo-board-route`.
- **Section B — the drag that goes nowhere.** `canDrag`, `run`'s demo short-circuit, and the e2e
  test that reloads. Branch `feat/demo-board-drag`, from `main` once A has landed.
- **Section C — the card.** `demo-card.tsx`, `demoCard`, and the card title promoted from plain
  text to the button that opens it. Branch `feat/demo-board-card`, from `main` once B has landed.

A before B before C, each independently shippable: A is a legible static board, B is the feature's
point, C is the surface a visitor asks for once B has made them curious. Branch each from `main`
rather than stacking — `CLAUDE.md` records two stacks that stranded a child PR.

## Verification

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, each exit code read directly
      rather than through a pipe.
- [ ] `pnpm test:e2e`, with the number that ran compared against the number collected.
- [ ] A signed-out browser at `/` can drag a card, and a reload puts it back — observed by hand,
      not only in Playwright.
- [ ] The network panel shows no request to a server action and no Pusher connection while
      dragging on `/`. This is the claim the spec is built on and the one thing a test asserts
      only indirectly.
- [ ] `/` at 360px shows one column and the switcher, with the bar's note truncated to `Demo`.
- [ ] Both themes, observed by hand.
- [ ] A signed-in browser at `/` still lands on `/boards`.
- [ ] Screenshots of the demo board in both themes and at 360px, for the PRs.

## Documentation changed in the same pull requests

`CLAUDE.md`:

- **"Layout"** — add the `(demo)` group and say `/` is the demo for a signed-out visitor.
- **"Footer and legal pages"** — `/` joins the board view as a route with no footer, and says
  where its privacy link lives instead.
- **"Realtime"** — record that `RealtimeProvider` takes a nullable board id and that null is how
  a surface opts out of the socket entirely.
- **"Open decisions"** — add the demo board to the settled list, pointing here.

## Settled while brainstorming

- **The demo is a fixture, not a board row.** A real board behind `DEMO_BOARD_ID` would keep
  content editable without a deploy, but it buys that with a deliberate hole in
  `assertBoardAccess` — the one module `CLAUDE.md` calls the single source of truth for access —
  and with a production row that anyone can reach. Editing content in a pull request is the
  cheaper price.
- **Drag persists nothing.** A shared sandbox with real writes was considered and rejected: it
  needs anonymous write auth, rate limiting, abuse handling, and a reset that Vercel's lack of
  scheduled jobs would force onto the read path.
- **The demo lives at `/`, not `/demo`.** `/` was a redirect nobody wanted, `proxy.ts` never
  matched it, and a product that shows itself before asking for a login is the entire point.
- **The card panel is local state, not the intercepting route.** The parallel route exists so
  cards have shareable URLs; a demo card has nothing to share.
- **One `Sign in` button, not two provider buttons.** Revised from the approved design — see
  deliverable 5.

## Open decisions carried forward

None from this spec. Board archive versus hard delete remains the only open decision in
`CLAUDE.md`, untouched here.
