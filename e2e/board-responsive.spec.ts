import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
  written,
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

test('at 360px a card still drags within the visible column', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'First', rank: 'a0' });
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Second', rank: 'a1' });

  try {
    await page.goto(`/boards/${boardId}`);
    const column = page.locator(`[data-column-id="${ready.id}"]`);
    await expect(column.getByTestId('card-title')).toHaveText(['First', 'Second']);

    // Dropping over a card inserts before it, so the reorder is dragging the
    // second card up onto the first.
    const card = page.locator('[data-card-id]').filter({ hasText: 'Second' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await expect(card).toHaveAttribute('style', /translate3d/);
    await page.locator('[data-card-id]').filter({ hasText: 'First' }).hover();
    const moved = written(page);
    await page.mouse.up();

    await expect(column.getByTestId('card-title')).toHaveText(['Second', 'First']);
    await moved;
    await page.reload();
    await expect(column.getByTestId('card-title')).toHaveText(['Second', 'First']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('at 360px Move to is how a card crosses columns', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Travelling', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Card actions for Travelling' }).click();
    const submenu = page.getByRole('menuitem', { name: 'Move to' });
    await submenu.click();

    // A pointer path, not a jump. At 360px the submenu collision-flips to the
    // left, and Radix keeps a flipped submenu open only while the recorded
    // direction of travel matches the side it opened on — which a teleporting
    // click never records.
    const target = page.getByRole('menuitem', { name: 'In Progress' });
    const from = await submenu.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('no box');
    const y = to.y + to.height / 2;
    for (const x of [from.x + 10, to.x + to.width - 4, to.x + to.width / 2]) {
      await page.mouse.move(x, y);
    }
    const moved = written(page);
    await page.mouse.down();
    await page.mouse.up();

    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Travelling']);
    await moved;
    await page.reload();
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Travelling']);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});
