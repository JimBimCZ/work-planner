import { expect, test, type Page } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// A server action is a POST back to the page's own URL, and the optimistic
// update lands well before it resolves. Reloading in between aborts the write
// in flight, so every test that reloads waits on the round trip first.
const written = (page: Page) => page.waitForResponse((r) => r.request().method() === 'POST');

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

test('rename a card, and the new title survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Typo' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Typo' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Card title').fill('Fixed');
    const saved = written(page);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('card-title')).toHaveText(['Fixed']);
    await saved;
    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveText(['Fixed']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('delete a card, and it stays gone', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Doomed' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Doomed' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const removed = written(page);
    await page.getByRole('button', { name: 'Delete card' }).click();

    await expect(page.getByTestId('card-title')).toHaveCount(0);
    await removed;
    await page.reload();
    await expect(page.getByTestId('card-title')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

// Move to is the pointer-free path at every width, and the only cross-column
// move once the board collapses in Section F.
test('move a card to another column without dragging', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Travelling' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Card actions for Travelling' }).click();
    await page.getByRole('menuitem', { name: 'Move to' }).click();
    const moved = written(page);
    await page.getByRole('menuitem', { name: 'In Progress' }).click();

    const target = page.locator(`[data-column-id="${inProgress.id}"]`);
    await expect(target.getByTestId('card-title')).toHaveText(['Travelling']);

    await moved;
    await page.reload();
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Travelling']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no card menu', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Read only' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-title')).toHaveText(['Read only']);
    await expect(page.getByRole('button', { name: /^Card actions for/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});
