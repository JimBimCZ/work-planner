# Spec: Foundation

Status: approved, not implemented
Date: 2026-08-30
Sub-project: 1 of 7

## Why this is one sub-project of seven

`CLAUDE.md` describes a platform, not a feature: auth, boards with membership and
roles, columns and cards on fractional ranks, drag and drop, an intercepted-route
modal, hosted realtime, legal pages, and a dual Vercel/Docker deployment. The
working rules forbid speccing that in one pass, so it is decomposed into seven
sub-projects, each with its own spec, plan, branch and PR:

| # | Sub-project | Scope |
|---|---|---|
| 1 | **Foundation** | this document |
| 2 | Auth | Auth.js v5, Google + GitHub, database sessions, middleware, sign-in screen, account menu |
| 3 | Boards & permissions | boards, board_members, roles, `lib/permissions.ts`, board list, create board with seeded columns, invite by email |
| 4 | Board canvas | columns CRUD and reorder, cards CRUD, `lib/rank.ts`, dnd-kit with optimistic moves, responsive collapse |
| 5 | Card modal | intercepting parallel route plus canonical `/cards/[cardId]`, description, due date, comments |
| 6 | Realtime | Pusher, `/api/pusher/auth`, `lib/events.ts`, mutationId echo, teammate ring |
| 7 | Legal | `/privacy`, `SiteFooter`, board-route account-menu link |

1 through 6 are sequential. 7 may land any time after 1.

## Goal

A deployable Next.js application with no product features, whose design system,
data wiring, test harness and container build are all proven by something that
actually runs. Every later sub-project builds on this without revisiting it.

## Non-goals

Authentication, boards, columns, cards, comments, realtime, and the privacy
policy. No database tables and no migrations. No marketing or landing page.

## Deliverables

### Routes

| Route | Behaviour |
|---|---|
| `/` | redirects to `/boards` |
| `/boards` | placeholder reading "Nothing here yet" |
| `/design` | temporary token proof sheet, see below |
| `/api/health` | `200 { ok: true }` after a successful `select 1`; `503 { ok: false }` if the query fails |

Only the `(app)` route group is created. The `(auth)` and `(legal)` groups arrive
with sub-projects 2 and 7 rather than sitting empty.

`/design` is scaffolding with a defined end: it is deleted at the close of
sub-project 4, once a real board demonstrates the same tokens. It renders the
full token table in both themes, the flow spectrum at 3, 5 and 8 columns, all
three typefaces at the scale defined in `CLAUDE.md`, card/control/modal radii and
shadows, the focus ring, and the overdue strip.

### Theme mechanism

Dark mode is driven by a `data-theme` attribute on `<html>`, not by
`prefers-color-scheme` in CSS. A blocking inline script in `<head>` resolves the
theme once — `localStorage` override first, `matchMedia` fallback — and stamps
the attribute before first paint. Tailwind gets one variant:

```css
@custom-variant dark ([data-theme="dark"] &);
```

Rationale: a single source of truth, so "system says dark" and "the user chose
dark" are not two code paths that can disagree; no flash of the wrong theme; and
the `/design` toggle is an attribute flip. The cost is an inline script, which
will need a nonce if a Content-Security-Policy is added later. That cost is
recorded here so it is not rediscovered.

### Design tokens

Every token in the `CLAUDE.md` design section is defined once on `:root` and
`[data-theme="dark"]`, then exposed to Tailwind through `@theme inline`.

shadcn/ui is installed and immediately re-tokenised, per the standing rule that
untouched shadcn is recognisable: `--primary` maps to `--flow-mid`, `--ring` to
the accent, `--radius` to the 8px control radius, with card at 10 and modal at
16. `components.json` leaves the `tailwind.config` key empty, which is how the
CLI expects Tailwind v4 projects to be configured.

The flow spectrum is a pure function:

```ts
// lib/flow.ts
export function flowHue(index: number, total: number): number; // 225 -> 145
```

Called on the server and emitted as an inline custom property per column. No
client JavaScript, and any column count re-interpolates without extra work.

### Fonts

`scripts/fetch-fonts.ts` downloads Clash Grotesk and General Sans from the
Fontshare API into a gitignored `app/fonts/`, run from `postinstall` and from the
Docker deps stage. JetBrains Mono is OFL and is committed to the repo. All three
are wired through `next/font/local`.

Rationale, and this is a licence constraint rather than a preference: the ITF
Free Font License section 02 forbids redistributing the font files through a
"repository" or "publicly accessible servers", and this repository is public.
Section 01 explicitly permits self-hosting on your own infrastructure for your
own site, so serving them from the deployed app is fine; committing the `.woff2`
files is not. Section 02 also forbids subsetting and format conversion, which is
why `next/font/local` is correct here and `next/font/google` would not be.

CI asserts the font files are present and fails loudly if they are missing, so a
Fontshare outage produces a red build rather than a silent fallback to system
metrics.

### Data layer

Drizzle ORM and drizzle-kit configured against `node-postgres`. The pooled client
in `lib/db/index.ts` is the single permitted module-level singleton and holds no
request-scoped data. drizzle-kit uses `DATABASE_URL_UNPOOLED`.

No tables and no migrations. The first migration is the Auth.js adapter tables in
sub-project 2. `/api/health` runs `select 1` so the connection is proven rather
than merely configured.

### Testing

Vitest covers `flowHue` — including the single-column and two-column edge cases —
and the health route. Playwright runs one smoke spec: `/` redirects to `/boards`,
and `/design` renders in both themes.

### Container and CI

Multi-stage Dockerfile on `node:22-alpine`, deps then build then runner,
`output: 'standalone'`, non-root `nextjs` user, `HOSTNAME=0.0.0.0`.
`docker-compose.yml` runs the app plus a local Postgres. The container healthcheck
targets `/api/health`.

GitHub Actions runs `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` on
every pull request. The migrate-on-main workflow is deferred to sub-project 2,
when there is a migration for it to run.

`.env.example` is committed and lists every variable in the `CLAUDE.md`
deployment section, including the ones not yet used, so it does not need
revisiting each sub-project. `.env*` stays ignored.

### Deployment

A Vercel project linked to `JimBimCZ/work-planner` on the existing Pro team, and
a Neon project with pooled and unpooled connection strings set as environment
variables. Foundation is complete when the preview URL serves `/design` and
`/api/health` returns `ok`.

## Verification

Foundation is done when, with output observed rather than assumed:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass locally.
- `docker compose up --build` serves the app and its healthcheck reports healthy.
- The Vercel preview serves `/design` in both themes and `/api/health` returns `ok`.
- A fresh `pnpm install` on a clean checkout produces the font files.

## Open decisions carried forward

Not settled here, and not to be settled unilaterally later:

- **`assigneeId` and `wipLimit`.** `CLAUDE.md` requires these confirmed as
  requirements or dropped before the first migration. Foundation ships no
  migration, so they fall due in sub-project 3.
- **A user-facing theme toggle.** `/design` has one because it must show both
  themes. Whether the product exposes one belongs to sub-project 2, when there is
  an account menu to hold it.
- **Pusher account.** Does not exist yet. Needed for sub-project 6, and
  `.env.example` carries the variable names in the meantime.

## Prerequisites the author must supply

- Neon pooled and unpooled connection strings for `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED`.
- Confirmation to create the Vercel project against the existing team.
