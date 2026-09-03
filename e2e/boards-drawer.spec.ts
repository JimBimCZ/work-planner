import { expect, test } from '@playwright/test';

import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('the drawer switches boards and creates one without leaving the board', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const roadmapId = await seedBoard(userId, 'Roadmap');
  await seedBoard(userId, 'Bugs');

  try {
    await page.goto(`/boards/${roadmapId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();

    // Nothing of the list is in the page until the drawer is opened.
    await expect(page.getByRole('link', { name: 'Bugs' })).toBeHidden();
    await page.getByRole('button', { name: 'Boards' }).click();

    await expect(page.getByRole('link', { name: 'Roadmap' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('button', { name: 'New board' }).click();
    await page.getByLabel('Board name').fill('Backlog');
    await page.getByRole('button', { name: 'Create board' }).click();
    await expect(page.getByRole('link', { name: 'Backlog' })).toBeVisible();

    await page.getByRole('link', { name: 'Bugs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bugs' })).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

// A refresh here would re-render the layout onto a board that no longer
// exists and answer the user a 404 from inside their own top bar.
test('deleting the board you are looking at sends you back to the list', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const roadmapId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${roadmapId}`);
    await page.getByRole('button', { name: 'Boards' }).click();
    await page.getByRole('button', { name: 'Board actions for Roadmap' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByLabel('Type the board name to confirm').fill('Roadmap');
    await page.getByRole('button', { name: 'Delete board' }).click();

    await expect(page).toHaveURL(/\/boards$/);
    await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

// The drawer lists what you can reach, not what exists — it reads through
// listBoardsForUser, the same query /boards does.
test('someone else’s board never appears in the drawer', async ({ page, context }) => {
  const owner = await seedSession(context);
  await seedBoard(owner.userId, 'Not yours');
  await context.clearCookies();
  const viewer = await seedSession(context);
  const ownId = await seedBoard(viewer.userId, 'Mine');

  try {
    await page.goto(`/boards/${ownId}`);
    await page.getByRole('button', { name: 'Boards' }).click();

    await expect(page.getByRole('link', { name: 'Mine' })).toBeVisible();
    await expect(page.getByText('Not yours')).toBeHidden();
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
