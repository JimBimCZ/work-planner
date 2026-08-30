import { expect, test } from '@playwright/test';

import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('an empty board list invites you to create one', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');

  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();

  await removeSeededUser(userId);
});

test('the list shows the boards you are a member of', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');

  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeHidden();

  await removeSeededUser(userId);
});

test('someone else’s board never appears in your list', async ({ page, context }) => {
  const owner = await seedSession(context);
  await seedBoard(owner.userId, 'Not yours');
  await context.clearCookies();
  const viewer = await seedSession(context);

  await page.goto('/boards');

  await expect(page.getByText('Not yours')).toBeHidden();

  await removeSeededUser(owner.userId);
  await removeSeededUser(viewer.userId);
});
