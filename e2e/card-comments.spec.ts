import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedComment,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a comment appears immediately and survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await page.getByRole('textbox', { name: 'Add a comment' }).fill('This needs a test');
    const posted = written(page);
    await page.getByRole('button', { name: 'Comment' }).click();

    await expect(page.getByTestId('comment-body')).toHaveText(['This needs a test']);

    await posted;
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveText(['This needs a test']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the thread reads oldest first', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId });
  await seedComment(cardId, userId, 'First');
  await seedComment(cardId, userId, 'Second');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByTestId('comment-body')).toHaveText(['First', 'Second']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer can comment', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await page.getByRole('textbox', { name: 'Add a comment' }).fill('Reads fine to me');
    const posted = written(page);
    await page.getByRole('button', { name: 'Comment' }).click();
    await posted;
    await page.reload();

    await expect(page.getByTestId('comment-body')).toHaveText(['Reads fine to me']);
    // ...and still cannot touch the fields.
    await expect(page.getByRole('textbox', { name: 'Card title' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

test("the author edits and deletes their own comment", async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId });
  await seedComment(cardId, userId, 'Typo here');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);

    await page.getByRole('button', { name: 'Edit comment: Typo here', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit comment: Typo here', exact: true }).fill('Fixed now');
    const edited = written(page);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await edited;
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveText(['Fixed now']);

    await page.getByRole('button', { name: 'Delete comment: Fixed now', exact: true }).click();
    const removed = written(page);
    await page.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await removed;
    await page.reload();
    await expect(page.getByTestId('comment-body')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test("a member is offered nothing on someone else's comment", async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId });
  await seedComment(cardId, owner.userId, 'Mine');

  await context.clearCookies();
  const other = await seedSession(context);
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByTestId('comment-body')).toHaveText(['Mine']);
    await expect(page.getByRole('button', { name: 'Edit comment: Mine', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete comment: Mine', exact: true })).toHaveCount(0);
  } finally {
    await removeSeededUser(other.userId);
    await removeSeededUser(owner.userId);
  }
});
