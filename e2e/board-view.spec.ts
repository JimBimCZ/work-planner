import { expect, test } from '@playwright/test';
import { closeSeedPool, removeSeededUser, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// Splitting the app into route groups moves the footer out of the root layout
// and into each group. That is invisible when it works and silent when it does
// not, so every route that must keep the footer is named here.
test('the footer survives the move off the root layout', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    for (const path of ['/boards', '/privacy', '/design']) {
      await page.goto(path);
      await expect(page.getByRole('contentinfo')).toBeVisible();
      await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' })).toBeVisible();
    }
  } finally {
    await removeSeededUser(userId);
  }
});

test('the footer is on sign in, signed out', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' })).toBeVisible();
});
