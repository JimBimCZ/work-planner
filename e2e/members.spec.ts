import { expect, test } from '@playwright/test';

import {
  boardMemberRoles,
  boardOwnerId,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedMember,
  seedSession,
  written,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// seedSession writes the session cookie into the context it is handed, so the
// last call wins. Everyone who is not driving the browser is seeded in a
// throwaway context, and the person the test acts as is seeded last.
test('the owner changes a role and removes a member', async ({ page, context, browser }) => {
  const aside = await browser.newContext();
  const other = await seedSession(aside);
  await aside.close();

  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Staffed');
  await seedMember(boardId, other.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();

    const wrote = written(page);
    await page.getByLabel('Role for Test User').selectOption('viewer');
    await wrote;
    await expect
      .poll(
        async () => (await boardMemberRoles(boardId)).find((r) => r.user_id === other.userId)?.role,
      )
      .toBe('viewer');

    const removed = written(page);
    await page.getByRole('button', { name: 'Remove' }).click();
    await removed;
    await expect.poll(async () => (await boardMemberRoles(boardId)).length).toBe(1);
  } finally {
    await removeSeededUser(other.userId);
    await removeSeededUser(owner.userId);
  }
});

test('handing the board over swaps both roles and the owner column', async ({
  page,
  context,
  browser,
}) => {
  const aside = await browser.newContext();
  const heir = await seedSession(aside);
  await aside.close();

  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Handover');
  await seedMember(boardId, heir.userId, 'member');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Make owner' }).click();
    await page.getByLabel('Board name').fill('Handover');

    const wrote = written(page);
    await page.getByRole('button', { name: 'Hand over the board' }).click();
    await wrote;

    await expect.poll(async () => boardOwnerId(boardId)).toBe(heir.userId);
    const roles = await boardMemberRoles(boardId);
    expect(roles.filter((row) => row.role === 'owner')).toEqual([
      { user_id: heir.userId, role: 'owner' },
    ]);
    expect(roles.find((row) => row.user_id === owner.userId)?.role).toBe('member');
  } finally {
    await removeSeededUser(heir.userId);
    await removeSeededUser(owner.userId);
  }
});

test('a viewer can see who is on the board and leave it', async ({ page, context, browser }) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();

  const boardId = await seedBoard(owner.userId, 'Read only');
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Members' }).click();
    // Addresses belong to the owner who typed them; a viewer is never sent one.
    await expect(page.getByText(owner.email)).toHaveCount(0);

    const wrote = written(page);
    await page.getByRole('button', { name: 'Leave board' }).click();
    await wrote;
    await page.waitForURL('**/boards');
    await expect.poll(async () => (await boardMemberRoles(boardId)).length).toBe(1);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
