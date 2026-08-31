import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

test('drag a card into another column, and it stays there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Dragged', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Dragged' });
    await card.hover();
    await page.mouse.down();
    // Past the 5px activation distance first, so the sensor starts a drag
    // rather than a click.
    await page.mouse.move(0, 0);
    // dnd-kit puts a transform on the card once the drag is actually running.
    // Moving to the target before that lands the pointermove on a context that
    // has not started dragging yet, and the drop is silently ignored.
    await expect(card).toHaveAttribute('style', /translate3d/);
    await page.locator(`[data-column-id="${inProgress.id}"]`).hover();
    const moved = written(page);
    await page.mouse.up();

    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Dragged']);

    await moved;
    await page.reload();
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Dragged']);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a click still opens nothing but does not move the card', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Clicked', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    // The 5px activation distance exists so a click reaches the card body,
    // which sub-project 5 makes open the modal.
    await page.locator('[data-card-id]').filter({ hasText: 'Clicked' }).click();

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Clicked']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer cannot drag', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Fixed', rank: 'a0' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${inProgress.id}"]`).hover();
    await page.mouse.up();

    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Fixed']);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});

// dnd-kit names the drag instructions with useUniqueId, which falls back to a
// module-level counter when DndContext carries no id. The counter lives in the
// server process and climbs with every render, so the second render of a board
// ships an id the freshly-started client counter never produces — and React
// does not patch a mismatched attribute. The card then points aria-describedby
// at an element that is not on the page.
test('the drag instructions are still reachable on a second render', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Announced');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Described', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.reload();

    // dnd-kit only renders the instructions after its own mount effect, so the
    // assertion polls rather than reading once.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('[data-card-id]')].map((card) => {
            const id = card.getAttribute('aria-describedby');
            return id ? (document.getElementById(id)?.textContent?.trim() ?? null) : null;
          }),
        ),
      )
      .toEqual([expect.stringContaining('press the space bar')]);
  } finally {
    await removeSeededUser(userId);
  }
});
