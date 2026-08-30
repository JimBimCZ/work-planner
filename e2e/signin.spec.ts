import { expect, test } from '@playwright/test';

test('sign-in offers both providers and nothing else', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
});

test('the refusal names the provider that owns the address', async ({ page }) => {
  await page.goto('/signin?error=account-exists&provider=google');
  await expect(
    page.getByText('That email already signs in with Google. Continue with Google instead.'),
  ).toBeVisible();
});

test('any other error explains itself without apologising', async ({ page }) => {
  await page.goto('/signin?error=Configuration');
  await expect(page.getByText('Something went wrong signing you in. Try again.')).toBeVisible();
});
