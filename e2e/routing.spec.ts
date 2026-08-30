import { expect, test } from '@playwright/test';

test('signed out, the board list sends you to sign in', async ({ page }) => {
  await page.goto('/boards');
  await expect(page).toHaveURL('/signin?callbackUrl=%2Fboards');
});

test('signed out, the root lands on sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
});

test('the health route reaches the database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
