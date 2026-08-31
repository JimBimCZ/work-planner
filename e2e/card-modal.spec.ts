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

test('clicking a card opens it over a board that is still there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    await expect(page).toHaveURL(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    // The board is behind the modal, not replaced by it.
    await expect(page.locator(`[data-column-id="${ready.id}"]`)).toBeAttached();
  } finally {
    await removeSeededUser(userId);
  }
});

test('browser-back closes the card and leaves the board mounted', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(`/boards/${boardId}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('card-title')).toHaveText(['Ship it']);
  } finally {
    await removeSeededUser(userId);
  }
});

// The half that fails silently: a broken intercept looks like a working
// full-page navigation, so this asserts the absence of the dialog.
test('a cold load of the card URL renders a page, not a modal', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);

    // The writer's title lives in the editable input now — CardBody carries
    // no heading of its own once CardModal supplies the dialog's accessible
    // name (Task 6), and this page never mounts CardModal.
    await expect(page.getByRole('textbox', { name: 'Card title' })).toHaveValue('Ship it');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-column-id]')).toHaveCount(0);
    // The cold load has no history entry to go back to, so the page needs its
    // own way back to the board.
    await expect(page.getByRole('link', { name: 'Back to board' })).toHaveAttribute(
      'href',
      `/boards/${boardId}`,
    );
  } finally {
    await removeSeededUser(userId);
  }
});

// The URL carries both ids. Pairing someone else's card with a board you can
// read must not open it.
test('a card id from another board is not found', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const mine = await seedBoard(userId, 'Mine');
  const other = await seedBoard(userId, 'Other');
  const [otherFirst] = await boardColumns(other);
  const strayId = await seedCard(otherFirst.id, { boardId: other, createdById: userId });

  try {
    const response = await page.goto(`/boards/${mine}/cards/${strayId}`);
    expect(response?.status()).toBe(404);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer opens a card and cannot edit its fields', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: owner.userId, title: 'Ship it' });

  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    // The canonical page never mounts CardModal, so this is CardBody's own
    // heading, plain and visible.
    await expect(page.getByRole('heading', { name: 'Ship it' })).toBeVisible();
    // A viewer's body has no inputs at all, so this heading is a real one.
    await expect(page.getByRole('textbox', { name: 'Card title' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

// The whole architecture rests on the canvas staying mounted behind the modal.
// A fresh remount would satisfy `[data-column-id]` being attached just as
// well, so this proves it with state that lives only in board-canvas.tsx and
// nowhere on the server: the "Add card" composer's open flag.
test('the board keeps client-only state alive behind the modal', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await expect(page.getByLabel('Card title')).toBeVisible();

    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goBack();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    // A remount would have closed the composer along with everything else.
    await expect(page.getByLabel('Card title')).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a title edited in the modal changes the card behind it', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    const title = page.getByRole('textbox', { name: 'Card title' });
    await title.fill('Ship it twice');
    // The promise is created before the action that fires the POST, the same
    // pattern the description test below already uses.
    const saved = written(page);
    await title.blur();
    await saved;

    await page.goBack();
    await expect(page.getByTestId('card-title')).toHaveText(['Ship it twice']);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a description survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    const description = page.getByRole('textbox', { name: 'Description' });
    await description.fill('Because the board is the product');
    // The promise is created before the action that fires the POST. Created
    // after, it can miss the response and hang to timeout.
    const saved = written(page);
    await description.blur();
    await saved;

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Because the board is the product',
    );
  } finally {
    await removeSeededUser(userId);
  }
});

// A card's temp id is not addressable until the create round trip settles —
// clicking it navigates to a card that does not exist yet. useSortable already
// disables dragging on `card.pending`; the title must not stay an active link
// either, the same way that guard already treats a pending card as not there.
test('a pending card is not a link', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);

    let releaseCreate: () => void = () => {};
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route(`**/boards/${boardId}`, async (route) => {
      if (route.request().method() === 'POST') await createGate;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Add card to Ready to Work' }).click();
    await page.getByLabel('Card title').fill('Ship it');
    await page.getByLabel('Card title').press('Enter');

    const pendingCard = page.locator('article[aria-disabled="true"]').filter({ hasText: 'Ship it' });
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.locator('a')).toHaveCount(0);

    const saved = written(page);
    releaseCreate();
    await saved;
  } finally {
    await removeSeededUser(userId);
  }
});

// commitField's success and failure branches both write local state after an
// await, so a slow save must not clobber whatever the user typed since.
test('typing after a save starts keeps the newer text once the response lands', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);

    let releaseSave: () => void = () => {};
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(`**/boards/${boardId}/cards/${cardId}`, async (route) => {
      if (route.request().method() === 'POST') await saveGate;
      await route.continue();
    });

    const title = page.getByRole('textbox', { name: 'Card title' });
    await title.fill('First save');
    await title.blur();

    await title.fill('Second edit');
    const saved = written(page);
    releaseSave();
    await saved;

    await expect(title).toHaveValue('Second edit');
  } finally {
    await removeSeededUser(userId);
  }
});

test('Escape on a dirty title reverts the field without closing the modal', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    const title = page.getByRole('textbox', { name: 'Card title' });
    await title.fill('Changed but not saved');
    await title.press('Escape');

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(title).toHaveValue('Ship it');
  } finally {
    await removeSeededUser(userId);
  }
});

test('Escape on a clean title closes the modal', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();

    const title = page.getByRole('textbox', { name: 'Card title' });
    await title.focus();
    await title.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a due date set in the modal appears on the card face', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    const saved = written(page);
    await page.getByLabel('Due date').fill('2026-09-01');
    await saved;

    await page.goBack();
    // The month only: formatDue follows the viewer's locale, and Playwright
    // defaults to en-US ("Sep 1") rather than en-GB ("1 Sep"). The exact date
    // is pinned by the west-of-Greenwich test below, through the input value.
    await expect(page.locator('[data-card-id]').filter({ hasText: 'Ship it' })).toContainText(
      'Sep',
    );
  } finally {
    await removeSeededUser(userId);
  }
});

// The one-day drift this module exists to prevent, proved in a browser that is
// actually west of Greenwich rather than in a unit test that reasons about it.
test.describe('west of Greenwich', () => {
  test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-GB' });

  test('a due date reads as the day it was set to', async ({ page, context }) => {
    const { userId } = await seedSession(context);
    const boardId = await seedBoard(userId, 'Roadmap');
    const [ready] = await boardColumns(boardId);
    const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

    try {
      await page.goto(`/boards/${boardId}/cards/${cardId}`);
      const saved = written(page);
      await page.getByLabel('Due date').fill('2026-09-01');
      await saved;
      await page.reload();

      await expect(page.getByLabel('Due date')).toHaveValue('2026-09-01');
    } finally {
      await removeSeededUser(userId);
    }
  });
});
