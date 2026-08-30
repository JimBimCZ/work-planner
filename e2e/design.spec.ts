import { expect, test } from '@playwright/test';

test('the proof sheet renders every token role', async ({ page }) => {
  await page.goto('/design');
  await expect(page.getByRole('heading', { name: 'Design tokens' })).toBeVisible();
  await expect(page.getByTestId('swatch-canvas')).toBeVisible();
  await expect(page.getByTestId('swatch-time-over')).toBeVisible();
});

test('the spectrum re-interpolates for each column count', async ({ page }) => {
  await page.goto('/design');
  await expect(page.getByTestId('spectrum-3').locator('[data-hue]')).toHaveCount(3);
  await expect(page.getByTestId('spectrum-5').locator('[data-hue]')).toHaveCount(5);
  await expect(page.getByTestId('spectrum-8').locator('[data-hue]')).toHaveCount(8);
});

test('the theme toggle flips the document attribute', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the chosen theme survives a reload', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('button', { name: 'Switch to dark' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
