import { expect, test } from '@playwright/test';
import { closeSeedPool, removeSeededUser, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a signed-in session sees the board list and the top bar', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/boards');
    await expect(page.getByText('Nothing here yet')).toBeVisible();
    await expect(page.getByRole('banner').getByText('Work Planner')).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});
