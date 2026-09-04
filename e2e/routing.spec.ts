import { expect, test } from '@playwright/test';

test('signed out, the board list sends you to sign in', async ({ page }) => {
  await page.goto('/boards');
  await expect(page).toHaveURL('/signin?callbackUrl=%2Fboards');
});

// / is not here: it serves the demo board signed out and redirects to /boards
// signed in, and e2e/demo.spec.ts holds both directions.

test('the health route reaches the database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
