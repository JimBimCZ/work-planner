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

test('the account menu carries the email, the privacy link and sign out', async ({
  page,
  context,
}) => {
  const { userId, email } = await seedSession(context);
  try {
    await page.goto('/boards');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('signing out returns you to sign in', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/boards');
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin/);
  } finally {
    await removeSeededUser(userId);
  }
});
