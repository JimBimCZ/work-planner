# Work Planner

A collaborative kanban board application, JIRA-board style. Multiple boards per
user, multiple users collaborating on the same board.

This is Foundation-stage: a scaffold, a design system proof sheet, and a health
route. There is no auth, no boards, and no cards yet.

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4 with shadcn/ui,
Drizzle ORM against Neon Postgres, Auth.js v5 for OAuth-only sign-in, Pusher
Channels for realtime, Vitest and Playwright for tests.

See `CLAUDE.md` for the full stack table and architectural decisions.

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
pnpm dev            # dev server
pnpm build           # production build
pnpm start           # run a production build
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest
pnpm test:watch      # vitest, watch mode
pnpm test:e2e        # playwright
pnpm db:generate     # generate a SQL migration from schema changes
pnpm db:migrate      # apply migrations
pnpm db:studio       # drizzle studio
```

## Docker

`docker compose up --build` runs the app and a local Postgres together.
`docker build -t kanban .` builds the app image alone, for self-hosting.

Vercel is production. Docker is for local development and self-hosting, not
the deployment path.

## CI

Every pull request runs typecheck, lint, unit tests, and end-to-end tests.

## Contributing

`docs/specs/` holds feature specs, `docs/plans/` holds implementation plans.
`CLAUDE.md` is the contributor guide — read it before making changes.
