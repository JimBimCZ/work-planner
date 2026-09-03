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

test('the line shows where the card will land, before it lands', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Dragged', rank: 'a0' });
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Sitting', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    const target = page.locator(`[data-column-id="${inProgress.id}"]`);
    await expect(target.getByTestId('drop-indicator')).toHaveCount(0);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Dragged' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await expect(card).toHaveAttribute('style', /translate3d/);

    // Hover the card already sitting in the target column, so the line has a
    // neighbour to sit above rather than falling to the foot of the column.
    await target.locator('[data-card-id]').filter({ hasText: 'Sitting' }).hover();

    // The line exists while the pointer is still down. This is the whole
    // point of the section: today nothing renders until the drop.
    await expect(target.getByTestId('drop-indicator')).toBeVisible();
    await expect(page.getByTestId('drop-indicator')).toHaveCount(1);

    const moved = written(page);
    await page.mouse.up();
    await moved;

    // Where the line was is where the card went: it sat above 'Sitting', and
    // the card lands above 'Sitting'. One function decides both.
    await expect(target.getByTestId('card-title')).toHaveText(['Dragged', 'Sitting']);
    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer never sees a drop indicator', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Fixed', rank: 'a0' });
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${ready.id}"]`).hover();

    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
    await page.mouse.up();
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

// A filtered board disables dragging, because neighbours read from a filtered
// list put the card between two cards the user cannot see. No drag, no line.
test('a filtered board never sees a drop indicator', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: userId,
    title: 'Fixed',
    rank: 'a0',
  });
  const labelId = await seedLabel(boardId, 'bug');
  await assignLabel(cardId, labelId);

  try {
    // The param is `label`, repeated — parseLabelFilter reads getAll('label').
    await page.goto(`/boards/${boardId}?label=${labelId}`);

    const card = page.locator('[data-card-id]').filter({ hasText: 'Fixed' });
    await expect(card).toBeVisible();
    await card.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.locator(`[data-column-id="${ready.id}"]`).hover();

    await expect(page.getByTestId('drop-indicator')).toHaveCount(0);
    await page.mouse.up();
  } finally {
    await removeSeededUser(userId);
  }
});
