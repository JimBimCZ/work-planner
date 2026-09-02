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

test('a member puts a label on a card and the card face shows it', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Tagged');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });
  await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    const applied = written(page);
    await page.getByRole('checkbox', { name: 'bug' }).check();
    await applied;

    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('card-labels')).toHaveText('bug');
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees the labels and is offered no way to change them', async ({
  page,
  context,
  browser,
}) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();

  const boardId = await seedBoard(owner.userId, 'Read only');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });
  const labelId = await seedLabel(boardId, 'bug');
  await assignLabel(cardId, labelId);

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByText('bug')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'bug' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

test('the filter narrows the board and survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Filtered');
  const [first] = await boardColumns(boardId);
  const kept = await seedCard(first.id, { boardId, createdById: userId, title: 'Has bug' });
  await seedCard(first.id, { boardId, createdById: userId, title: 'Has nothing' });
  const labelId = await seedLabel(boardId, 'bug');

  await assignLabel(kept, labelId);

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Has nothing')).toBeVisible();

    await page.getByRole('button', { name: 'Filter' }).click();
    // click, not check: the box is controlled by the URL, so it only flips
    // once router.replace lands. check() asserts the state synchronously and
    // would fail on a filter that deliberately has no second source of truth.
    await page.getByRole('checkbox', { name: /bug/ }).click();
    await expect(page.getByRole('checkbox', { name: /bug/ })).toBeChecked();

    await expect(page.getByText('Has bug')).toBeVisible();
    await expect(page.getByText('Has nothing')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`label=${labelId}`));

    await page.reload();
    await expect(page.getByText('Has bug')).toBeVisible();
    await expect(page.getByText('Has nothing')).toBeHidden();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a filtered board does not let a card be dragged', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'No dragging');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId, title: 'Has bug' });
  const labelId = await seedLabel(boardId, 'bug');

  await assignLabel(cardId, labelId);

  try {
    await page.goto(`/boards/${boardId}`);
    const card = page.locator(`[data-card-id="${cardId}"]`);
    await expect(card).toHaveAttribute('aria-disabled', 'false');

    await page.goto(`/boards/${boardId}?label=${labelId}`);
    // aria-disabled, not tabindex: dnd-kit hardcodes tabIndex to 0 whatever
    // `disabled` says (core.cjs:3404) and expresses the state through
    // aria-disabled instead, returning `listeners: undefined` alongside it —
    // so this one attribute is what proves pointer and keyboard are both off.
    await expect(page.locator(`[data-card-id="${cardId}"]`)).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  } finally {
    await removeSeededUser(userId);
  }
});

test('a column emptied by a filter says so in its own words', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Nothing matches');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId, title: 'Unlabelled' });
  const labelId = await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Nothing here yet')).toHaveCount(4);

    await page.goto(`/boards/${boardId}?label=${labelId}`);
    await expect(page.getByText('Nothing here matches').first()).toBeVisible();
    await expect(page.getByText('Nothing here yet')).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a member creates a label from the filter, and deletes it again', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Vocabulary');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('New label').fill('chore');
    const created = written(page);
    await page.getByRole('button', { name: 'Add label' }).click();
    await created;
    await expect(page.getByRole('checkbox', { name: /chore/ })).toBeVisible();

    const removed = written(page);
    await page.getByRole('button', { name: 'Delete chore' }).click();
    await removed;
    await expect(page.getByRole('checkbox', { name: /chore/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('a member renames a label from the filter', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Renaming');
  await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('button', { name: 'Rename bug' }).click();
    await page.getByRole('textbox', { name: 'Label name' }).fill('defect');
    const saved = written(page);
    await page.getByRole('button', { name: 'Save label name' }).click();
    await saved;

    await expect(page.getByRole('checkbox', { name: /defect/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^bug$/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(userId);
  }
});

test('clearing the filter drops the parameter and brings the board back', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Clearing');
  const [first] = await boardColumns(boardId);
  const kept = await seedCard(first.id, { boardId, createdById: userId, title: 'Has bug' });
  await seedCard(first.id, { boardId, createdById: userId, title: 'Has nothing' });
  const labelId = await seedLabel(boardId, 'bug');
  await assignLabel(kept, labelId);

  try {
    await page.goto(`/boards/${boardId}?label=${labelId}`);
    await expect(page.getByText('Has nothing')).toBeHidden();

    await page.getByRole('button', { name: /Filter/ }).click();
    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page).not.toHaveURL(/label=/);
    await expect(page.getByText('Has nothing')).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer is offered no way to change the set', async ({ page, context, browser }) => {
  const aside = await browser.newContext();
  const owner = await seedSession(aside);
  await aside.close();
  const boardId = await seedBoard(owner.userId, 'Read only vocabulary');
  await seedLabel(boardId, 'bug');

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('checkbox', { name: /bug/ })).toBeVisible();
    await expect(page.getByLabel('New label')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete bug' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rename bug' })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});

test('the popover closes on Escape', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Dismissible');
  await seedLabel(boardId, 'bug');

  try {
    await page.goto(`/boards/${boardId}`);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('checkbox', { name: /bug/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox', { name: /bug/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filter' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  } finally {
    await removeSeededUser(userId);
  }
});

// playwright.config.ts loads .env and .env.local into process.env before this
// runs. Without credentials the app is correctly non-realtime, so this test
// would pass vacuously — skipping says so instead of pretending.
const configured = Boolean(
  process.env.PUSHER_APP_ID &&
    process.env.PUSHER_SECRET &&
    process.env.NEXT_PUBLIC_PUSHER_KEY &&
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
);

test.describe('a label that changes while the board is open', () => {
  test.skip(!configured, 'Pusher credentials are not configured');

  test('a label applied by someone else appears on the card face', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const owner = await seedSession(ownerContext);
    const member = await seedSession(memberContext);
    const boardId = await seedBoard(owner.userId, 'Live labels');
    await seedMember(boardId, member.userId, 'member');
    const [first] = await boardColumns(boardId);
    const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });
    await seedLabel(boardId, 'bug');

    try {
      // The watcher never reloads, so a pass cannot come from anything but the
      // event — which means it has to be subscribed before the actor writes.
      const watcher = await memberContext.newPage();
      await watcher.goto(`/boards/${boardId}`);
      await expect(watcher.locator('[data-realtime]')).toHaveAttribute(
        'data-realtime',
        'subscribed',
        { timeout: 15_000 },
      );
      await expect(watcher.getByTestId('card-labels')).toHaveCount(0);

      const actor = await ownerContext.newPage();
      await actor.goto(`/boards/${boardId}/cards/${cardId}`);
      await actor.getByRole('checkbox', { name: 'bug' }).check();

      await expect(watcher.getByTestId('card-labels')).toHaveText('bug', { timeout: 15_000 });
    } finally {
      await ownerContext.close();
      await memberContext.close();
      await removeSeededUser(member.userId);
      await removeSeededUser(owner.userId);
    }
  });
});
