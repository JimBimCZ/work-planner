import { expect, test, type Page } from '@playwright/test';

import { closeSeedPool, removeSeededUser, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// Signed out on purpose: no seedSession, no context cookies. If any of these
// need a session to pass, the demo is not a demo.
test('a stranger gets the board at /', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Launch checklist' })).toBeVisible();
  await expect(page.locator('[data-column-id]')).toHaveCount(5);
  await expect(page.getByTestId('card-title').first()).toBeVisible();
});

test('the demo offers no way to change the board', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'New card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Card actions/ })).toHaveCount(0);
});

// The card route lives under /boards/[boardId] and is signed-in only, so a
// link on a demo card face is a trap. See board-card.test.tsx.
test('no card on the demo board is a link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-card-id] a')).toHaveCount(0);
});

test('says that nothing is saved, and offers the way in', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Nothing here is saved')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

// CLAUDE.md requires the privacy link reachable from every route. The demo is
// a board — fixed viewport, no footer — and a signed-out visitor has no
// account menu, so the bar carries it.
test('keeps privacy reachable without a footer', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible();
});

test('sends a signed-in visitor to their own boards', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  try {
    await page.goto('/');
    await expect(page).toHaveURL(/\/boards$/);
  } finally {
    await removeSeededUser(userId);
  }
});

// dnd-kit's PointerSensor has a 5px activation distance and only starts the
// drag once it has seen the pointer move, so Playwright's dragTo is silently
// ignored. This is the sequence board-dnd.spec.ts proved works — without
// written(), because the demo issues no request to wait for.
async function dragCard(page: Page, title: string, columnId: string) {
  const card = page.locator('[data-card-id]').filter({ hasText: title });
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute('style', /translate3d/);
  await page.locator(`[data-column-id="${columnId}"]`).hover();
  await page.mouse.up();
}

test('a card dragged on the demo lands where it was dropped', async ({ page }) => {
  await page.goto('/');

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');

  await expect(
    page.locator('[data-column-id="demo-col-progress"]').getByTestId('card-title'),
  ).toContainText(['Search cards across a board']);
});

// The whole feature in one assertion: the drag was real, and it was never
// written anywhere.
test('a reload puts it back', async ({ page }) => {
  await page.goto('/');

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');
  await page.reload();

  await expect(
    page.locator('[data-column-id="demo-col-ready"]').getByTestId('card-title'),
  ).toContainText(['Search cards across a board']);
  await expect(
    page.locator('[data-column-id="demo-col-progress"]').getByTestId('card-title'),
  ).not.toContainText(['Search cards across a board']);
});

test('a demo card opens and closes', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Move attachments to the EU bucket' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/EU-jurisdiction endpoint/)).toBeVisible();
  await expect(dialog.getByText('Rin Okabe')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Closing is state, not history: the board is still the board.
  await expect(page).toHaveURL(/\/$/);
});

test('dragging the demo issues no request of any kind', async ({ page }) => {
  await page.goto('/');

  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });

  await dragCard(page, 'Search cards across a board', 'demo-col-progress');
  await page.waitForTimeout(500);

  expect(posts).toEqual([]);
});
