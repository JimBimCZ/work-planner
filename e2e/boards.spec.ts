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

test('creating a board adds it to the list', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByLabel('Board name').fill('Roadmap');
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();

  await removeSeededUser(userId);
});

test('a board with no name cannot be created', async ({ page, context }) => {
  const { userId } = await seedSession(context);

  await page.goto('/boards');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByRole('button', { name: 'Create board' }).click();

  await expect(page.getByText('Enter a name for the board')).toBeVisible();

  await removeSeededUser(userId);
});

test('renaming a board keeps the new name after a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Board name').fill('Q3 roadmap');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('link', { name: 'Q3 roadmap' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Q3 roadmap' })).toBeVisible();

  await removeSeededUser(userId);
});

test('deleting a board needs its name typed exactly', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  await seedBoard(userId, 'Roadmap');

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();

  await page.getByLabel('Type the board name to confirm').fill('roadmap');
  await page.getByRole('button', { name: 'Delete board' }).click();
  await expect(
    page.getByText('That is not the board name. Type it exactly to delete.'),
  ).toBeVisible();

  // The modal marks the page behind it aria-hidden, so the surviving row is
  // only reachable once the dialog is closed — and the row surviving is the
  // actual proof that the near-miss did not delete.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeVisible();

  await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByLabel('Type the board name to confirm').fill('Roadmap');
  await page.getByRole('button', { name: 'Delete board' }).click();

  await expect(page.getByRole('link', { name: 'Roadmap' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();

  await removeSeededUser(userId);
});
