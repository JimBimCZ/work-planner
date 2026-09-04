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

  const column = await page.locator('[data-column-id="demo-col-done"]').boundingBox();
  expect(column).not.toBeNull();
  expect(column!.x).toBeLessThan(360);
  expect(column!.x + column!.width).toBeGreaterThan(0);
});

test('the board is interactive again after the tour closes', async ({ page }) => {
  await page.goto('/');
  await openTour(page);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Move attachments to the EU bucket' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
