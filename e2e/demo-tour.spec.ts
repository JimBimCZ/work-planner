import { expect, test } from '@playwright/test';

const openTour = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'What can I try?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

test('opens from the top bar and closes on Escape', async ({ page }) => {
  await page.goto('/');
  await openTour(page);

  await expect(page.getByText('A board you can poke at')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lights the element the step is about', async ({ page }) => {
  await page.goto('/');
  await openTour(page);
  await page.getByRole('button', { name: 'Next' }).click();

  const spotlight = page.locator('[aria-hidden][style*="box-shadow"]');
  const card = page.locator('[data-card-id="demo-card-migrate"]');
  await expect(spotlight).toBeVisible();

  const lit = await spotlight.boundingBox();
  const target = await card.boundingBox();
  expect(lit).not.toBeNull();
  expect(target).not.toBeNull();
  // The spotlight is inset by PAD on every side.
  expect(Math.abs(lit!.x + 4 - target!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(lit!.y + 4 - target!.y)).toBeLessThanOrEqual(1);
});

test('walks the whole sequence and finishes', async ({ page }) => {
  await page.goto('/');
  await openTour(page);

  await expect(page.getByText('1 of 5')).toBeVisible();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('5 of 5')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// The assertion that proves the scroll rather than assuming it: at 360px the
// Done column starts far off-screen, and the step about it must bring it in.
test('scrolls a far target into view at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/');
  await openTour(page);

  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Columns are yours')).toBeVisible();

  const column = page.locator('[data-column-id="demo-col-done"]');

  // The scroll is smooth by design, so this is eventually true rather than
  // immediately true — sampling once races the animation.
  await expect
    .poll(async () => (await column.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(360);

  const box = await column.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeGreaterThan(0);
});

test('the step card never covers the element it points at', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'What can I try?' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  const spotlight = page.locator('[aria-hidden][style*="box-shadow"]');
  await expect(spotlight).toBeVisible();
  const lit = await spotlight.boundingBox();
  const card = await page.getByRole('dialog').boundingBox();

  expect(lit).not.toBeNull();
  expect(card).not.toBeNull();
  const overlaps =
    lit!.x < card!.x + card!.width &&
    card!.x < lit!.x + lit!.width &&
    lit!.y < card!.y + card!.height &&
    card!.y < lit!.y + lit!.height;
  expect(overlaps).toBe(false);
});

test('a target too tall to clear keeps its top visible', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'What can I try?' }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Columns are yours')).toBeVisible();

  const spotlight = page.locator('[aria-hidden][style*="box-shadow"]');
  await expect(spotlight).toBeVisible();
  const lit = await spotlight.boundingBox();
  const card = await page.getByRole('dialog').boundingBox();

  expect(lit).not.toBeNull();
  expect(card).not.toBeNull();
  // The column is taller than the viewport, so the card cannot clear it. What
  // must hold is that the column's header and first cards stay readable above
  // the card rather than under it.
  expect(card!.y - Math.max(lit!.y, 0)).toBeGreaterThanOrEqual(200);
});

test('the board is interactive again after the tour closes', async ({ page }) => {
  await page.goto('/');
  await openTour(page);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Move attachments to the EU bucket' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
