import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

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
      await expect(
        page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }),
      ).toBeVisible();
    }
  } finally {
    await removeSeededUser(userId);
  }
});

test('the footer is on sign in, signed out', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' })).toBeVisible();
});

test('the board drops the footer but keeps privacy in the account menu', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await expect(page.getByRole('contentinfo')).toHaveCount(0);

    // CLAUDE.md requires the privacy link reachable from every route; the board
    // view locks body scroll, so the account menu is where it lives.
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('the board shows its five seeded columns in order', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Progress',
      'In Testing',
      'In Review',
      'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test("the board shows each column's cards in rank order", async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Second', rank: 'a1' });
  await seedCard(ready.id, { boardId, createdById: userId, title: 'First', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-title')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});

// The highest-value test here. It asserts the status code, not just the absent
// name: a page rendering "you cannot see this" with a 200 would pass a
// text-only assertion while still confirming the board exists.
test('a non-member gets a 404, not a board', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Not yours');
  await context.clearCookies();
  const stranger = await seedSession(context);
  try {
    const response = await page.goto(`/boards/${boardId}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByText('Not yours')).toBeHidden();
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(stranger.userId);
  }
});
