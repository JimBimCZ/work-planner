import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The seeded-session harness opens its own pool from the runner process, which
// Playwright does not give the .env files Next reads for itself. Precedence
// matches Next: a real environment variable beats .env.local, which beats .env
// — so CI's job-level DATABASE_URL still wins and local runs reach the Neon dev
// branch instead of a docker Postgres that may not be running.
const fromEnvironment = new Set(Object.keys(process.env));
for (const file of ['.env', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (match && !fromEnvironment.has(match[1])) process.env[match[1]] = match[2];
  }
}

const isCI = Boolean(process.env.CI);
// Defaults to 3000 so CI and every existing local workflow are unchanged;
// E2E_PORT exists for a machine where something else already holds 3000 —
// `next start` reads the `PORT` env var (Next 16 CLI reference, `next start`:
// "-p or --port <port> ... default: 3000, env: PORT"), and webServer.env below
// merges into, rather than replaces, the process env the server inherits.
const port = process.env.E2E_PORT ?? '3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    // Readiness probes /api/health, not '/'. The root renders the demo board,
    // which is a fixture: it answers 200 without the database being reachable,
    // so it would report ready before the seeded-session harness — which does
    // need the database — could seed anything. The health route touches it.
    url: `http://localhost:${port}/api/health`,
    // Always start a fresh production server: reusing a stray `next dev` on
    // port 3000 would run the suite against dev overlays instead of the
    // build this config exists to test.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: port },
  },
});
