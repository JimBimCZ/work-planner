# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js application with no product features, whose design system, data wiring, test harness and container build are each proven by something that actually runs.

**Architecture:** App Router with Server Components by default. Dark mode is an explicit `data-theme` attribute on `<html>` stamped before first paint, never a CSS media query, so system preference and user choice are one code path. The colour flow spectrum is a pure function called on the server and emitted as an inline custom property, so it needs no client JavaScript and re-interpolates for any column count.

**Tech Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4, shadcn/ui, Drizzle ORM + drizzle-kit, node-postgres, Vitest, Playwright, Docker, GitHub Actions, Vercel.

**Spec:** `docs/specs/foundation.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Next.js 16, App Router, TypeScript strict. Server Components by default; `'use client'` only where interaction demands it.
- Tailwind CSS v4. `components.json` leaves the `tailwind.config` key empty — that is how the shadcn CLI expects v4 projects to be configured.
- No `any`, no non-null assertions to silence the compiler, no `@ts-expect-error` without an explanation on the line above.
- No unnecessary comments. Comment only non-obvious decisions.
- No barrel files. Prefer editing existing files over adding new ones.
- Do not add a state management library.
- Fonts are Roboto and Roboto Mono via `next/font/google`. Both OFL-1.1. Nothing font-related is committed, fetched or scripted.
- Copy: active voice, sentence case, no filler. Empty states are invitations, not apologies.
- Colour roles are exactly three — flow, accent (`--flow-mid`), time. No fourth role.
- Radii: control 8, card 10, modal 16.
- `.env*` is never committed. `.env.example` is the only env file in the repo.
- Before pushing anything: `pnpm typecheck && pnpm lint && pnpm test`.
- One section of this plan, one branch, one PR. Do not batch sections.

## File Structure

| File | Responsibility |
|---|---|
| `app/layout.tsx` | Root layout: fonts, the pre-paint theme script, `<html data-theme>` |
| `app/page.tsx` | Redirects `/` to `/boards` |
| `app/globals.css` | Every design token, the `dark` variant, the `@theme inline` bridge to Tailwind |
| `app/(app)/boards/page.tsx` | Placeholder board list |
| `app/design/page.tsx` | Temporary token proof sheet. Deleted at the close of sub-project 4 |
| `app/design/theme-toggle.tsx` | The only client component in Foundation |
| `app/api/health/route.ts` | `select 1` against the pool; 200 or 503 |
| `lib/flow.ts` | `flowHue` — pure, no imports, no side effects |
| `lib/db/index.ts` | The pooled client. The single permitted module-level singleton |
| `lib/db/schema.ts` | Intentionally empty until sub-project 2 |
| `lib/utils.ts` | shadcn's `cn` helper |
| `drizzle.config.ts` | drizzle-kit config, reads `DATABASE_URL_UNPOOLED` |
| `vitest.config.ts` | Node environment, unit tests only |
| `playwright.config.ts` | Builds and starts the app, then runs `e2e/` |
| `Dockerfile` | deps → build → runner on `node:22-alpine` |
| `docker-compose.yml` | App plus local Postgres |
| `.github/workflows/ci.yml` | typecheck, lint, unit, e2e on every PR |

`lib/flow.ts` deliberately has no imports: it is the one piece of the design system that later sub-projects call on every render, and keeping it dependency-free means it can be unit tested with no setup at all.

---

## Section A — Scaffold and test harness

Branch: `feat/foundation-scaffold`

### Task 1: Scaffold the application and its tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: the `pnpm` script names every later task runs — `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `db:studio`. The `@/*` path alias resolving to the repo root.

- [x] **Step 1: Scaffold into the existing repository**

The repo already contains `CLAUDE.md`, `LICENSE` and `docs/`, so scaffold into a
temporary directory and move the files in rather than letting the generator
refuse a non-empty target.

```bash
pnpm dlx create-next-app@latest scaffold-tmp \
  --ts --app --tailwind --eslint \
  --import-alias "@/*" --use-pnpm --disable-git

# create-next-app defaults to --agents-md, which writes AGENTS.md AND a stub
# CLAUDE.md containing only "@AGENTS.md". Merging that over the real CLAUDE.md
# destroys it. Delete both before the merge, not after.
rm -f scaffold-tmp/AGENTS.md scaffold-tmp/CLAUDE.md

rsync -a --exclude .git scaffold-tmp/ ./
rm -rf scaffold-tmp
```

The flags above are verified against `create-next-app@16.3.3`. Three plausible
flags do **not** work on this version, so do not reintroduce them: the target
directory cannot begin with a period (npm naming rules), `--src-dir=false` is
invalid because the flag is a boolean switch whose absence already means no
`src/`, `--no-git` is spelled `--disable-git`, and `--turbopack` no longer exists
because Turbopack is the default bundler (`--rspack` opts out).

Then confirm the pre-existing files are untouched before going further:

```bash
git status --short
git diff --stat -- CLAUDE.md LICENSE docs/
```

Expected: no changes to `CLAUDE.md`, `LICENSE` or `docs/`. If `CLAUDE.md` shows
as modified, the merge clobbered it — `git checkout -- CLAUDE.md` and find out
why before continuing.

The generated `package.json` takes its `name` from the temp directory. Set it to
`work-planner`.

- [x] **Step 2: Confirm the generated versions are what this plan assumes**

```bash
node -e "const p=require('./package.json');console.log('next',p.dependencies.next);console.log('react',p.dependencies.react);console.log('tailwind',p.devDependencies.tailwindcss)"
```

Expected: `next` on 16.x, `react` on 19.x, `tailwind` on 4.x. If `next` is not 16.x, stop and report it — the whole plan is written against 16.

- [x] **Step 3: Add the remaining dev dependencies**

```bash
pnpm add -D vitest vite-tsconfig-paths @playwright/test
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
pnpm exec playwright install --with-deps chromium
```

- [x] **Step 4: Write the scripts block**

Replace the `scripts` block in `package.json` with exactly this. The names are fixed by `CLAUDE.md`; `test` must be `vitest run` and not watch mode, or CI hangs.

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "next typegen && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

`typecheck` runs `next typegen` first because `app/layout.tsx` and other route files use typegen globals like `LayoutProps<"/">`, emitted into `.next/types/routes.d.ts`. That directory is gitignored, so on a clean checkout — including every CI run — a bare `tsc --noEmit` fails with `Cannot find name 'LayoutProps'` before a single real type error is checked.

- [x] **Step 5: Configure Vitest**

Node environment, not jsdom: Foundation has no component unit tests, so React Testing Library and jsdom would be unused dependencies. Component behaviour is covered by Playwright instead.

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts?(x)', 'app/**/*.test.ts?(x)'],
    passWithNoTests: true,
  },
});
```

The `include` pattern deliberately excludes `e2e/`, which Playwright owns. The
`?(x)` suffix collects both `.test.ts` and `.test.tsx`, so a future component
test isn't silently dropped from the suite — with `passWithNoTests` on, a
too-narrow glob would fail closed as a green build with nothing run.

`passWithNoTests` is required, not cosmetic: the first unit test does not arrive
until Task 5, and without it `vitest run` exits 1 on an empty suite — which would
fail every `&&`-chained gate in Sections A and B and the CI job in Task 9. Do not
satisfy this by adding a placeholder test; a test that asserts nothing is a
defect.

- [x] **Step 6: Write `.env.example`**

Every variable from the `CLAUDE.md` deployment section, including ones not used until later sub-projects, so this file is not revisited each time.

```bash
cat > .env.example <<'ENV'
# Pooled connection. Local development uses the Postgres from docker-compose.yml.
DATABASE_URL=postgres://kanban:kanban@localhost:5432/kanban
# Unpooled. Used by drizzle-kit only, never by the application.
DATABASE_URL_UNPOOLED=postgres://kanban:kanban@localhost:5432/kanban

AUTH_SECRET=
AUTH_TRUST_HOST=true
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

PUSHER_APP_ID=
PUSHER_SECRET=
NEXT_PUBLIC_PUSHER_KEY=
NEXT_PUBLIC_PUSHER_CLUSTER=

NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV
```

- [x] **Step 7: Ensure `.gitignore` covers env files and test output**

Append if not already present:

```
.env
.env.*
!.env.example
/test-results/
/playwright-report/
.superpowers/
```

The generated `.gitignore` may already contain a bare `.env*` with no exception,
which would silently make `.env.example` uncommittable. Ensure the `!.env.example`
negation is present and comes after the ignore lines.

- [x] **Step 8: Verify the toolchain**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all three succeed. `pnpm test` is expected to report no test files at this point; that is fine and is fixed in Task 2.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with test and db tooling"
```

### Task 2: Root redirect and the boards placeholder

**Files:**
- Create: `app/(app)/boards/page.tsx`, `e2e/routing.spec.ts`, `playwright.config.ts`
- Replace: `app/page.tsx` (currently the create-next-app template)

`app/layout.tsx` is deliberately not touched here; it is rewritten in Task 6.

**Interfaces:**
- Consumes: the `pnpm build` / `pnpm start` scripts from Task 1.
- Produces: the `/boards` route that sub-project 3 replaces with a real board list, and `playwright.config.ts` which every later e2e task adds specs to.

- [x] **Step 1: Configure Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    // Always start a fresh production server: reusing a stray `next dev` on
    // port 3000 would run the suite against dev overlays instead of the
    // build this config exists to test.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

The suite runs against a production build rather than `next dev`, because the redirect and the theme script behave differently under dev-only overlays. `reuseExistingServer` is `false` unconditionally — including locally — precisely so a stray `next dev` left running on port 3000 can never get silently substituted for the production build this config exists to test.

- [x] **Step 2: Write the failing test**

Create `e2e/routing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the root redirects to the board list', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/boards');
});

test('the empty board list invites rather than apologises', async ({ page }) => {
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
});
```

- [x] **Step 3: Run it and watch it fail**

```bash
pnpm test:e2e
```

Expected: both tests FAIL. The first because `/` renders the generator's default page instead of redirecting; the second with a 404 on `/boards`.

- [x] **Step 4: Write the minimal implementation**

Replace `app/page.tsx` entirely:

```tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/boards');
}
```

Create `app/(app)/boards/page.tsx`:

```tsx
export default function BoardsPage() {
  return (
    <main>
      <h1>Boards</h1>
      <p>Nothing here yet</p>
    </main>
  );
}
```

- [x] **Step 5: Run the tests and watch them pass**

```bash
pnpm test:e2e
```

Expected: 2 passed.

- [x] **Step 6: Commit**

```bash
git add app/page.tsx "app/(app)/boards/page.tsx" e2e/routing.spec.ts playwright.config.ts
git commit -m "feat: redirect the root to the board list"
```

### Section A gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [x] Open the PR with `gh pr create`, stating what was verified and the observed output.
- [x] Stop. Start Section B in a fresh session.

---

## Section B — Data layer and health

Branch: `feat/foundation-data-layer`

### Task 3: The pooled database client

**Files:**
- Create: `docker-compose.yml`, `lib/db/index.ts`, `lib/db/schema.ts`, `drizzle.config.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from Task 1's `.env.example`.
- Produces: `export const db` from `@/lib/db` — a Drizzle instance over a `pg.Pool`. Task 4 and every later server action import exactly this.

- [x] **Step 1: Add local Postgres**

Create `docker-compose.yml` with the database only. The app service is added in Task 8, once there is a Dockerfile to build.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: kanban
      POSTGRES_PASSWORD: kanban
      POSTGRES_DB: kanban
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U kanban']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

- [x] **Step 2: Start it and confirm it accepts connections**

```bash
cp -n .env.example .env
docker compose up -d postgres
docker compose exec -T postgres pg_isready -U kanban
```

Expected: `accepting connections`. If it is not, stop — nothing below can be verified without it.

- [x] **Step 3: Write the client**

Create `lib/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// The dev server re-evaluates modules on every hot reload, which would leak a
// pool per reload. Production gets a fresh module per cold start, so the cache
// is deliberately dev-only.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool =
  globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

export const db = drizzle({ client: pool });
```

This is the single permitted module-level singleton in the codebase. It holds no
request-scoped data.

Note what this deliberately does *not* do: it does not throw when `DATABASE_URL`
is missing. `next build` evaluates route modules to read their config, so a
module-scope throw would fail the Docker build, which has no database URL and
does not need one. `pg.Pool` connects lazily, so a missing or wrong URL surfaces
on the first query — which is exactly what the health route in Task 4 reports as
a 503. Do not "improve" this by adding an eager check.

- [x] **Step 4: Create the empty schema module**

Create `lib/db/schema.ts`:

```ts
// Foundation ships no tables. The first migration is the Auth.js adapter tables
// in sub-project 2; drizzle.config.ts points here so the path is settled now.
export {};
```

- [x] **Step 5: Configure drizzle-kit**

Create `drizzle.config.ts`. The shape below was verified against the `drizzle-kit` 0.31 published types: `dialect` plus `dbCredentials.url`, with no `driver` key. Older examples showing `driver: 'pg'` and `connectionString` are for a superseded major.

```ts
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error('DATABASE_URL_UNPOOLED is not set');
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
});
```

- [x] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [x] **Step 7: Commit**

```bash
git add docker-compose.yml lib/db drizzle.config.ts
git commit -m "feat: add the pooled database client and drizzle-kit config"
```

### Task 4: The health route

**Files:**
- Create: `app/api/health/route.ts`, `app/api/health/route.test.ts`
- Modify: `e2e/routing.spec.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`.
- Produces: `GET /api/health` returning `200 {"ok":true}` or `503 {"ok":false}`. Task 8's container healthcheck depends on exactly this contract.

- [x] **Step 1: Write the failing test**

Create `app/api/health/route.test.ts`. The database is mocked so the test asserts the route's branching, not Postgres — the real connection is proven by the e2e test in Step 5.

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const execute = vi.fn();
vi.mock('@/lib/db', () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

describe('GET /api/health', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  test('returns 200 when the query succeeds', async () => {
    execute.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test('returns 503 when the query fails', async () => {
    execute.mockRejectedValue(new Error('connection refused'));
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module './route'`.

- [x] **Step 3: Write the minimal implementation**

Create `app/api/health/route.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
```

`force-dynamic` matters: without it the route is statically evaluated at build time and the container healthcheck would report a cached success forever.

- [x] **Step 4: Run the tests and watch them pass**

```bash
pnpm test
```

Expected: 2 passed.

- [x] **Step 5: Add the end-to-end check against real Postgres**

Append to `e2e/routing.spec.ts`:

```ts
test('the health route reaches the database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
```

- [x] **Step 6: Run it with Postgres up**

```bash
docker compose up -d postgres
pnpm test:e2e
```

Expected: 3 passed. If this passes while `docker compose` is down, the route is not actually querying — investigate rather than proceeding.

- [x] **Step 7: Commit**

```bash
git add app/api/health e2e/routing.spec.ts
git commit -m "feat: add the health route backed by a real query"
```

### Section B gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass with Postgres running, output observed.
- [x] Confirm `/api/health` returns 503 with Postgres stopped, then restart it.
- [x] Open the PR. Stop. Start Section C in a fresh session.

---

## Section C — Design system

Branch: `feat/foundation-design-system`

### Task 5: The flow spectrum

**Files:**
- Create: `lib/flow.ts`, `lib/flow.test.ts`

**Interfaces:**
- Consumes: nothing. This module has no imports by design.
- Produces: `flowHue(index: number, total: number): number`. Sub-project 4 calls this per column to derive the column rule and header wash.

- [x] **Step 1: Write the failing test**

Create `lib/flow.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { flowHue } from './flow';

describe('flowHue', () => {
  test('a single column sits at the start of the spectrum', () => {
    expect(flowHue(0, 1)).toBe(225);
  });

  test('the first and last columns anchor the ends', () => {
    expect(flowHue(0, 5)).toBe(225);
    expect(flowHue(4, 5)).toBe(145);
  });

  test('the midpoint of five columns is the accent hue region', () => {
    expect(flowHue(2, 5)).toBe(185);
  });

  test('adding a column re-interpolates every position', () => {
    expect(flowHue(1, 3)).toBe(185);
    expect(flowHue(1, 5)).toBe(205);
  });

  test('hue decreases monotonically across any column count', () => {
    for (const total of [2, 3, 5, 8, 13]) {
      const hues = Array.from({ length: total }, (_, i) => flowHue(i, total));
      const sorted = [...hues].sort((a, b) => b - a);
      expect(hues).toEqual(sorted);
    }
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm test lib/flow.test.ts
```

Expected: FAIL — `Cannot find module './flow'`.

- [x] **Step 3: Write the minimal implementation**

Create `lib/flow.ts`:

```ts
const HUE_START = 225;
const HUE_END = 145;

export function flowHue(index: number, total: number): number {
  if (total <= 1) {
    return HUE_START;
  }
  return HUE_START + ((HUE_END - HUE_START) * index) / (total - 1);
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
pnpm test lib/flow.test.ts
```

Expected: 5 passed.

- [x] **Step 5: Commit**

```bash
git add lib/flow.ts lib/flow.test.ts
git commit -m "feat: derive column hue from position in the flow"
```

### Task 6: Tokens, fonts and the theme mechanism

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `components.json`, `lib/utils.ts` (both produced by the shadcn CLI)

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties and Tailwind colour utilities (`bg-canvas`, `text-ink`, `border-line`, `bg-flow-mid`, `text-time-over`) that every later component uses, and the `data-theme` contract on `<html>`.

- [x] **Step 1: Initialise shadcn/ui**

```bash
pnpm dlx shadcn@latest init
```

Answer with the neutral base colour and CSS variables enabled. Confirm afterwards that `components.json` has an empty `tailwind.config` value — that is required for Tailwind v4 and the CLI sets it automatically:

```bash
node -e "console.log(JSON.stringify(require('./components.json').tailwind,null,2))"
```

Expected: `"config": ""`.

- [x] **Step 2: Write the token layer**

Replace the contents of `app/globals.css` with the following. This intentionally
discards the palette the shadcn CLI generated — Step 3 puts its variable *names*
back, pointed at these tokens. Defining `@custom-variant dark` here also replaces
the CLI's class-based `(&:is(.dark *))` version; there must be exactly one.

```css
@import "tailwindcss";

@custom-variant dark ([data-theme="dark"] &);

:root {
  --canvas: #EDF0F5;
  --surface: #FFFFFF;
  --ink: #0E1319;
  --muted: #8A94A6;
  --line: #DCE1E9;

  --flow-1: #4468D8;
  --flow-mid: #12A594;
  --flow-last: #2E9E5B;

  --time-soon: #C98A17;
  --time-over: #C8492F;

  --radius-control: 8px;
  --radius-card: 10px;
  --radius-modal: 16px;
}

[data-theme="dark"] {
  --canvas: #10141A;
  --surface: #19202A;
  --ink: #E7EBF2;
  --line: #262E3A;
}

@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-flow-1: var(--flow-1);
  --color-flow-mid: var(--flow-mid);
  --color-flow-last: var(--flow-last);
  --color-time-soon: var(--time-soon);
  --color-time-over: var(--time-over);

  --font-sans: var(--font-roboto);
  --font-mono: var(--font-roboto-mono);
}

@layer base {
  body {
    background-color: var(--canvas);
    color: var(--ink);
    font-family: var(--font-roboto), system-ui, sans-serif;
  }

  :focus-visible {
    outline: 2px solid var(--flow-mid);
    outline-offset: 2px;
  }
}
```

`--muted` is defined once, outside the theme blocks: `CLAUDE.md` specifies the same value in both modes.

- [x] **Step 3: Retarget the shadcn variables**

Append these declarations to the `:root` block you wrote in Step 2, so every
shadcn component resolves to a project token and no untouched shadcn default
survives. They reference tokens declared earlier in the same block, so ordering
matters — put them last.

```css
:root {
  --background: var(--canvas);
  --foreground: var(--ink);
  --card: var(--surface);
  --card-foreground: var(--ink);
  --popover: var(--surface);
  --popover-foreground: var(--ink);
  --primary: var(--flow-mid);
  --primary-foreground: #FFFFFF;
  --muted-foreground: var(--muted);
  --border: var(--line);
  --input: var(--line);
  --ring: var(--flow-mid);
  --destructive: var(--time-over);
  --radius: var(--radius-control);
}
```

- [x] **Step 4: Wire the fonts and the pre-paint theme script**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Roboto, Roboto_Mono } from 'next/font/google';
import './globals.css';

const roboto = Roboto({
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-roboto-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Work Planner',
  description: 'A collaborative kanban board.',
};

// Runs before first paint so the page never renders in the wrong theme. Needs a
// nonce here if a Content-Security-Policy is ever added.
const themeScript = `(function(){try{var c=localStorage.getItem('theme');var d=c?c==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${roboto.variable} ${robotoMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` on `<html>` is required: the script mutates `data-theme` before React hydrates, so the server and client markup differ by that attribute on purpose.

- [x] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all pass.

Two failures to recognise rather than guess at:

- An error mentioning `next/font` and network or ENOTFOUND means the build host
  cannot reach Google Fonts. `next/font/google` downloads at build time.
- An error saying a `weight` is required means this version of Next does not
  treat Roboto as a variable font. In that case add `weight: ['400', '500', '600']`
  to the `Roboto` call and `weight: ['400', '500']` to `Roboto_Mono`. The Google
  Fonts CSS API does serve Roboto as a variable face spanning 100–900, so prefer
  the variable form and only fall back if the build rejects it.

- [x] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx components.json lib/utils.ts
git commit -m "feat: add design tokens, Roboto and the data-theme mechanism"
```

### Task 7: The token proof sheet

**Files:**
- Create: `app/design/page.tsx`, `app/design/theme-toggle.tsx`, `e2e/design.spec.ts`

**Interfaces:**
- Consumes: `flowHue` from `@/lib/flow`, and the tokens from Task 6.
- Produces: nothing later sub-projects depend on. This route is deleted at the close of sub-project 4.

- [x] **Step 1: Write the failing test**

Create `e2e/design.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the proof sheet renders every token role', async ({ page }) => {
  await page.goto('/design');
  await expect(page.getByRole('heading', { name: 'Design tokens' })).toBeVisible();
  await expect(page.getByTestId('swatch-canvas')).toBeVisible();
  await expect(page.getByTestId('swatch-time-over')).toBeVisible();
});

test('the spectrum re-interpolates for each column count', async ({ page }) => {
  await page.goto('/design');
  await expect(page.getByTestId('spectrum-3').locator('[data-hue]')).toHaveCount(3);
  await expect(page.getByTestId('spectrum-5').locator('[data-hue]')).toHaveCount(5);
  await expect(page.getByTestId('spectrum-8').locator('[data-hue]')).toHaveCount(8);
});

test('the theme toggle flips the document attribute', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the chosen theme survives a reload', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
```

The last test is the one that actually proves the pre-paint script works; the others would pass with a naive React-only toggle.

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm test:e2e e2e/design.spec.ts
```

Expected: all four FAIL with a 404 on `/design`.

- [x] **Step 3: Write the toggle**

Create `app/design/theme-toggle.tsx`. This is the only client component in Foundation.

```tsx
'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium"
    >
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  );
}
```

The initial state is read in an effect rather than during render because the attribute is set by the pre-paint script, which React does not know about.

- [x] **Step 4: Write the proof sheet**

Create `app/design/page.tsx`. A Server Component apart from the toggle.

```tsx
import { flowHue } from '@/lib/flow';
import { ThemeToggle } from './theme-toggle';

const TOKENS = [
  ['canvas', 'board background'],
  ['surface', 'cards, modal, top bar'],
  ['ink', 'primary text'],
  ['muted', 'secondary text'],
  ['line', 'borders, dividers'],
  ['flow-1', 'first column'],
  ['flow-mid', 'accent'],
  ['flow-last', 'last column'],
  ['time-soon', 'due soon'],
  ['time-over', 'overdue'],
] as const;

function Spectrum({ total }: { total: number }) {
  return (
    <div data-testid={`spectrum-${total}`} className="flex gap-3">
      {Array.from({ length: total }, (_, index) => {
        const hue = flowHue(index, total);
        const next = flowHue(Math.min(index + 1, total - 1), total);
        return (
          <div key={index} className="flex-1" data-hue={hue}>
            <div
              className="h-[3px] w-full"
              style={{
                background: `linear-gradient(90deg, hsl(${hue} 60% 45%), hsl(${next} 60% 45%))`,
              }}
            />
            <div
              className="h-20 px-2 pt-2 text-xs font-semibold uppercase tracking-[0.08em]"
              style={{
                background: `linear-gradient(hsl(${hue} 60% 45% / 0.06), transparent 80px)`,
              }}
            >
              Column {index + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-medium">Design tokens</h1>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Colour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TOKENS.map(([name, role]) => (
            <div key={name} data-testid={`swatch-${name}`} className="flex flex-col gap-1">
              <div
                className="h-14 rounded-[var(--radius-card)] border border-line"
                style={{ background: `var(--${name})` }}
              />
              <span className="font-mono text-xs">--{name}</span>
              <span className="text-xs text-muted">{role}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Flow spectrum</h2>
        <Spectrum total={3} />
        <Spectrum total={5} />
        <Spectrum total={8} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Type</h2>
        <p className="text-[22px] font-medium">Board title, 22 display</p>
        <p className="text-[15px]/6">Body copy at 15 on 24. Active voice, sentence case, no filler.</p>
        <p className="text-sm/5 font-medium">Card title, 14 on 20, weight 500</p>
        <p className="font-mono text-xs">card meta 12 mono &middot; 3d over</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Surfaces</h2>
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-64 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-sm">
            <p className="text-sm/5 font-medium">A card at radius 10</p>
            <p className="mt-2 font-mono text-xs text-muted">12 mono meta</p>
          </div>
          <div className="w-64 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm">
            <div className="h-[2px] w-full bg-time-over" />
            <div className="p-3">
              <p className="text-sm/5 font-medium">An overdue card</p>
              <p className="mt-2 font-mono text-xs text-time-over">3d over</p>
            </div>
          </div>
          <div className="w-64 rounded-[var(--radius-modal)] border border-line bg-surface p-4 shadow-lg">
            <p className="text-sm/5 font-medium">A modal at radius 16</p>
            <p className="mt-2 text-[15px]/6 text-muted">Body copy inside a modal.</p>
          </div>
          <button
            type="button"
            className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
          >
            Add card
          </button>
        </div>
      </section>
    </main>
  );
}
```

- [x] **Step 5: Run the tests and watch them pass**

```bash
pnpm test:e2e e2e/design.spec.ts
```

Expected: 4 passed.

- [x] **Step 6: Look at it**

```bash
pnpm dev
```

Open `http://localhost:3000/design` and confirm by eye, in both themes: the three spectrums form unbroken bands, the only warm colour on the page is the overdue card, and the focus ring is visible when tabbing. Stop the dev server when done.

- [x] **Step 7: Commit**

```bash
git add app/design e2e/design.spec.ts
git commit -m "feat: add a temporary proof sheet for the design tokens"
```

### Section C gate

- [x] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass, output observed.
- [ ] Screenshots of `/design` in both themes attached to the PR, per the rule that UI changes ship with screenshots.
- [x] Open the PR. Stop. Start Section D in a fresh session.

---

## Section D — Container and CI

Branch: `feat/foundation-container-ci`

### Task 8: The container image

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `next.config.ts`, `docker-compose.yml`

**Interfaces:**
- Consumes: `GET /api/health` from Task 4.
- Produces: a `kanban` image and an `app` compose service.

- [x] **Step 1: Enable standalone output**

Modify `next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

- [x] **Step 2: Write `.dockerignore`**

```
node_modules
.next
.git
.env
.env.*
!.env.example
e2e
test-results
playwright-report
docs
```

- [x] **Step 3: Write the Dockerfile**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

There is no font step and no `postinstall` hook: `next/font/google` fetches during
`pnpm build` in the build stage and bakes the files into the output.

There is also no `COPY … /app/public ./public` line. Section A deleted the unused
generator SVGs, leaving no `public/` directory at all, and `COPY` fails on a
missing source. If a later section adds a file under `public/`, restore that line
in the same change — a static asset that is never copied into the runner is a
404 that only appears in the container, never in `next dev`.

- [x] **Step 4: Add the app service**

Add to `docker-compose.yml`, alongside the existing `postgres` service:

```yaml
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgres://kanban:kanban@postgres:5432/kanban
      NEXT_PUBLIC_SITE_URL: http://localhost:3000
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

The healthcheck uses node's built-in `fetch` rather than curl, which `node:22-alpine` does not ship.

- [x] **Step 5: Verify the container actually becomes healthy**

```bash
docker compose up --build -d
docker compose ps
```

Expected: the `app` service reaches `healthy`, not merely `running`. Poll until it settles rather than reading it once:

```bash
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)")" = healthy ]; do docker compose ps --format '{{.Name}} {{.Status}}'; sleep 5; done; echo HEALTHY
```

Then confirm the app serves:

```bash
curl -s localhost:3000/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/design
```

Expected: `{"ok":true}` and `200`.

- [x] **Step 6: Shut it down**

```bash
docker compose down
```

Leave nothing running.

- [x] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore next.config.ts docker-compose.yml
git commit -m "feat: add the standalone container image and compose app service"
```

### Task 9: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every `pnpm` script from Task 1.
- Produces: the required status check on every PR.

- [x] **Step 1: Write the workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: kanban
          POSTGRES_PASSWORD: kanban
          POSTGRES_DB: kanban
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U kanban"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://kanban:kanban@localhost:5432/kanban
      DATABASE_URL_UNPOOLED: postgres://kanban:kanban@localhost:5432/kanban
      NEXT_PUBLIC_SITE_URL: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

There is no migration step: Foundation ships no migrations. The migrate-on-main job is added by sub-project 2.

- [x] **Step 2: Verify it passes on the pull request**

Push the branch, open the PR, and watch the run:

```bash
gh pr checks --watch
```

Expected: the `verify` job succeeds. Do not report this section complete on an unwatched run.

- [x] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify typecheck, lint, unit and e2e on every pull request"
```

### Section D gate

- [x] The container reached `healthy` and was then shut down, output observed.
- [x] The CI run on the PR passed, watched rather than assumed.
- [x] Open the PR. Stop. Start Section E in a fresh session.

Two deviations from this section's literal text, both verified before they were made:

- Task 8's `deps` stage copies `pnpm-workspace.yaml` alongside `package.json` and `pnpm-lock.yaml`.
  Without it `pnpm install --frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS`, because pnpm 11
  reads build-script approvals from that file rather than from `package.json`.
- Task 9 uploads `test-results/`, not `playwright-report/`. `playwright.config.ts` sets
  `reporter: 'list'`, and only the `html` reporter writes `playwright-report/`, so the step as
  written would have silently uploaded nothing on every failed run.

---

## Section E — Deploy

Branch: none. This section is a handoff, not a code change.

### Task 10: Vercel project and Neon database

**Files:** none.

**Interfaces:**
- Consumes: the merged output of Sections A through D on `main`.
- Produces: a preview URL, and the environment variables sub-project 2 will extend.

- [x] **Step 1: Create the Vercel project**

Create a project on the `JimBimCZ's projects` team linked to the `JimBimCZ/work-planner` GitHub
repository. Do not deploy yet — set the environment variables first.

The build itself does **not** need `DATABASE_URL`: `new Pool()` in `lib/db/index.ts` does not connect
eagerly and `/api/health` is `force-dynamic`, so nothing touches the database at build time. This was
verified twice in Section D — a clean clone built with no `.env` present, exit 0, and the Docker image
builds with no database at all. Deploying early therefore succeeds and leaves `/api/health` returning
503 at runtime: a preview that fails the exact check Step 4 exists to make.

Prerequisite, discovered the hard way: the Vercel GitHub App must have access to this repository, or
project creation fails with `bad_request` — "To link a GitHub repository, you need to install the
GitHub integration first." The app being installed for other repositories is not enough when its
access is scoped to selected ones. Add `work-planner` at https://github.com/apps/vercel first.

- [x] **Step 2: Hand off to the author**

Report the project name and ask for a Neon project with two connection strings: the pooled endpoint for `DATABASE_URL` and the direct endpoint for `DATABASE_URL_UNPOOLED`. Per the spec, Neon and Vercel should both be pinned to an EU region so the privacy policy's data-location answer stays simple.

- [x] **Step 3: Set the environment variables**

Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `NEXT_PUBLIC_SITE_URL` for production, preview and development.

- [x] **Step 4: Verify the preview**

```bash
curl -s https://<preview-url>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<preview-url>/design
```

Expected: `{"ok":true}` and `200`. Then open `/design` in a browser and confirm both themes render, since a status code does not prove the fonts or tokens loaded.

- [x] **Step 5: Record the outcome**

Tick the Foundation verification list in `docs/specs/foundation.md` and report the preview URL.

### Section E gate

- [x] The preview serves `/design` in both themes and `/api/health` returns `ok`, observed in a browser and not inferred.

### Section E outcome

Steps 1 through 3 were carried out while Sections D and the privacy-policy branch were in flight, so
this section verified them rather than performing them. Project `work-planner` on
`JimBimCZ's projects`, linked to `JimBimCZ/work-planner`; Neon wired through the Vercel integration,
which supplies `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to Production and Preview, and to
Development from the `dev` branch created in PR #12.

Deployment `dpl_A3aRz74Fikd9FcruKrJXMjcsK1CA`, `main` at `a4e3306`, state READY. Observed:

```
$ curl -s https://work-planner-seven.vercel.app/api/health
{"ok":true}
$ curl -s -o /dev/null -w '%{http_code}\n' https://work-planner-git-main-jimbimczs-projects.vercel.app/design
200
```

`/design` was then opened in Chrome against
`work-planner-git-main-jimbimczs-projects.vercel.app` under an emulated `prefers-color-scheme` of
`dark` and of `light`. Both render: the token swatches, the three flow spectrums re-interpolating
across 3, 5 and 8 columns, Roboto and Roboto Mono, and the footer's privacy link. URLs:

- Production: https://work-planner-seven.vercel.app
- `main` branch alias: https://work-planner-git-main-jimbimczs-projects.vercel.app

Two things this section found:

- `NEXT_PUBLIC_SITE_URL` was set in all three Vercel environments and in `.env.example`, but no code
  read it, so `CLAUDE.md`'s description of it was an intention rather than a fact. Fixed rather than
  carried: `lib/site-url.ts` resolves it into the root layout's `metadataBase`.
- Section C's gate still has one unticked box: screenshots of `/design` were never attached to PR #6,
  which is merged. Both themes are now verified on the deployment and recorded above, but the box
  stays unticked because the thing it asks for did not happen.

---

## Definition of done

Foundation is complete when every checkbox above is ticked and:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass on `main`.
- `docker compose up --build` reaches a healthy app container.
- The Vercel preview serves `/design` in both themes and `/api/health` returns `ok`.

Carried forward to sub-project 2, and not to be decided while executing this plan: whether `assigneeId` and `wipLimit` are real requirements, and whether the product gets a user-facing theme toggle beyond `/design`.
