import { expect, test } from '@playwright/test';

import {
  assignLabel,
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedLabel,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('a member puts a label on a card and the card face shows it', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Tagged');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });
  await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    const applied = written(page);
    await page.getByRole('checkbox', { name: 'bug' }).check();
    await applied;

    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-labels')).toHaveText('bug');
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees the labels and is offered no way to change them', async ({
  page,
  context,
  browser,
}) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();

  const boardId = await seedBoard(owner.userId, 'Read only');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });
  const labelId = await seedLabel(boardId, 'bug');
  await assignLabel(cardId, labelId);

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByText('bug')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'bug' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
