import { expect, test } from '@playwright/test';

test('the root redirects to the board list', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/boards');
});

test('the empty board list invites rather than apologises', async ({ page }) => {
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
});
