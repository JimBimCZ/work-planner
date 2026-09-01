import { expect, test } from '@playwright/test';

import {
  boardMemberRoles,
  boardOwnerId,
  closeSeedPool,
  pendingInviteCount,
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

test('an invite sent by the owner is accepted by its addressee', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const invitee = await seedSession(inviteeContext);
  const boardId = await seedBoard(owner.userId, 'Shared work');

  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByLabel('Invite by email').fill(invitee.email);

    const sent = written(ownerPage);
    await ownerPage.getByRole('button', { name: 'Send invite' }).click();
    await sent;
    await expect.poll(async () => pendingInviteCount(boardId)).toBe(1);

    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto('/boards');
    await expect(inviteePage.getByText('Shared work')).toBeVisible();

    const accepted = written(inviteePage);
    await inviteePage.getByRole('button', { name: 'Accept' }).click();
    await accepted;

    // The invite is consumed and the membership exists: both halves, because
    // either one alone would pass with the other broken.
    await expect.poll(async () => pendingInviteCount(boardId)).toBe(0);
    await expect
      .poll(async () => (await boardMemberRoles(boardId)).find((r) => r.user_id === invitee.userId)?.role)
      .toBe('member');

    await inviteePage.goto(`/boards/${boardId}`);
    await expect(inviteePage.getByRole('button', { name: 'Members' })).toBeVisible();
  } finally {
    await removeSeededUser(invitee.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await inviteeContext.close();
  }
});

test('declining an invite leaves no membership and no invite', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const owner = await seedSession(ownerContext);
  const invitee = await seedSession(inviteeContext);
  const boardId = await seedBoard(owner.userId, 'Not for me');

  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}`);
    await ownerPage.getByRole('button', { name: 'Members' }).click();
    await ownerPage.getByLabel('Invite by email').fill(invitee.email);
    const sent = written(ownerPage);
    await ownerPage.getByRole('button', { name: 'Send invite' }).click();
    await sent;

    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto('/boards');
    const declined = written(inviteePage);
    await inviteePage.getByRole('button', { name: 'Decline' }).click();
    await declined;

    await expect.poll(async () => pendingInviteCount(boardId)).toBe(0);
    await expect.poll(async () => (await boardMemberRoles(boardId)).length).toBe(1);
  } finally {
    await removeSeededUser(invitee.userId);
    await removeSeededUser(owner.userId);
    await ownerContext.close();
    await inviteeContext.close();
  }
});
