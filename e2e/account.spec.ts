import { expect, test } from '@playwright/test';

import {
  boardColumns,
  closeSeedPool,
  commentAuthorId,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedComment,
  seedMember,
  seedSession,
  userRowCounts,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a wrong email is refused and nothing is deleted', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/account');
    await page.getByLabel(/type .* to confirm/i).fill('not-my@example.test');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('That is not your email address.', { exact: false })).toBeVisible();
    expect((await userRowCounts(userId)).user).toBe(1);
  } finally {
    await removeSeededUser(userId);
  }
});

test('deleting takes the account, its boards and everything on them', async ({ page, context }) => {
  const { userId, email } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Doomed board');
  const [firstColumn] = await boardColumns(boardId);
  const cardId = await seedCard(firstColumn.id, { boardId, createdById: userId });
  await seedComment(cardId, userId);

  await page.goto('/account');
  await page.getByLabel(/type .* to confirm/i).fill(email);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForURL('**/signin');

  // The cascade chain: user -> boards -> columns and cards -> comments. The
  // cards.column_id constraint is NO ACTION, and this is the first delete that
  // makes Postgres resolve it with cards and columns going in one statement.
  expect(await userRowCounts(userId)).toEqual({ user: 0, account: 0, session: 0, members: 0 });
  expect(await boardColumns(boardId)).toEqual([]);

  // The old cookie is still in the jar and must no longer open anything.
  await page.goto('/boards');
  await expect(page).toHaveURL(/\/signin/);
});

test("comments on someone else's board outlive the account that wrote them", async ({
  page,
  context,
}) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, "Someone else's board");
  const [firstColumn] = await boardColumns(boardId);
  const cardId = await seedCard(firstColumn.id, { boardId, createdById: owner.userId });

  // A second browser context, so the guest has their own cookie.
  const guestContext = await page.context().browser()!.newContext();
  const guest = await seedSession(guestContext);
  await seedMember(boardId, guest.userId, 'member');
  const commentId = await seedComment(cardId, guest.userId, 'Still here');

  const guestPage = await guestContext.newPage();
  try {
    await guestPage.goto('/account');
    await guestPage.getByLabel(/type .* to confirm/i).fill(guest.email);
    await guestPage.getByRole('button', { name: 'Delete account' }).click();
    await guestPage.waitForURL('**/signin');

    expect((await userRowCounts(guest.userId)).user).toBe(0);
    await expect(commentAuthorId(commentId)).resolves.toBeNull();

    // The owner can still read it, and it carries no name.
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByText('Still here')).toBeVisible();
    await expect(page.getByText('Deleted account')).toBeVisible();
  } finally {
    await guestContext.close();
    await removeSeededUser(owner.userId);
    await removeSeededUser(guest.userId);
  }
});

test('owning a board someone else is on blocks the delete', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Shared board');
  const otherContext = await page.context().browser()!.newContext();
  const other = await seedSession(otherContext);
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto('/account');
    await expect(page.getByRole('link', { name: 'Shared board' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
    expect((await userRowCounts(userId)).user).toBe(1);
  } finally {
    await otherContext.close();
    await removeSeededUser(other.userId);
    await removeSeededUser(userId);
  }
});
