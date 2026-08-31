import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

test.use({ viewport: { width: 360, height: 720 } });

test.afterAll(async () => {
  await closeSeedPool();
});

test('one column fills the viewport at 360px', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);

  try {
    await page.goto(`/boards/${boardId}`);

    const width = await page
      .locator(`[data-column-id="${ready.id}"]`)
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(320);
    expect(width).toBeLessThanOrEqual(360);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the switcher reaches a column that is off screen', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [, , , , done] = await boardColumns(boardId);
  await seedCard(done.id, { boardId, createdById: userId, title: 'Finished', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('tab', { name: 'Done' }).click();

    await expect(
      page.locator(`[data-column-id="${done.id}"]`).getByTestId('card-title'),
    ).toBeInViewport();
  } finally {
    await removeSeededUser(userId);
  }
});

// CLAUDE.md locks body scroll on the board route. The snap container scrolls;
// the page itself must not.
test('the page itself never scrolls sideways', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the switcher is gone on a wide viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByRole('tablist')).toBeHidden();
  } finally {
    await removeSeededUser(userId);
  }
});
