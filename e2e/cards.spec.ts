import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedMember,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('add a card from the column, and it survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await page.getByLabel('Card title').fill('Ship the migration');
    await page.getByLabel('Card title').press('Enter');

    await expect(page.getByTestId('card-title')).toHaveText(['Ship the migration']);

    // The optimistic card keeps its temp id until the server answers and
    // card.settle swaps in the real one. Reloading before that aborts the
    // in-flight write, so this is the write landing, not a timeout.
    await expect(page.locator('[data-card-id^="tmp-"]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveText(['Ship the migration']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the composer stays open for the next card', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await page.getByLabel('Card title').fill('First');
    await page.getByLabel('Card title').press('Enter');
    await page.getByLabel('Card title').fill('Second');
    await page.getByLabel('Card title').press('Enter');

    await expect(page.getByTestId('card-title')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the header button adds to the first column', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'New card' }).click();
    await page.getByLabel('Card title').fill('From the header');
    await page.getByLabel('Card title').press('Enter');

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['From the header']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no way to add a card', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  // Replace the owner's cookie with a viewer's on the same board.
  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('column-name').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New card' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add card to/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
