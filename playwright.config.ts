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
    // Readiness probes /api/health, not '/'. The root redirects into the
    // auth-gated routes, so probing it makes suite startup depend on whichever
    // page that chain currently ends at — a signed-out run lands on /signin,
    // and any 4xx there stalls the whole suite behind a webServer timeout.
    url: 'http://localhost:3000/api/health',
    // Always start a fresh production server: reusing a stray `next dev` on
    // port 3000 would run the suite against dev overlays instead of the
    // build this config exists to test.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
