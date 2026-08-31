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

const DEFAULTS = ['Ready to Work', 'In Progress', 'In Testing', 'In Review', 'Done'];

test.afterAll(async () => {
  await closeSeedPool();
});

test('rename a column, and the name survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Testing' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Column name').fill('QA');
    const saved = written(page);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Progress',
      'QA',
      'In Review',
      'Done',
    ]);
    await saved;
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Progress',
      'QA',
      'In Review',
      'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('add a column to the right of another', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Add column right' }).click();
    await page.getByLabel('Column name').fill('Blocked');
    const added = written(page);
    await page.getByRole('button', { name: 'Add column' }).click();

    await added;
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Progress',
      'Blocked',
      'In Testing',
      'In Review',
      'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('move a column left, and the order survives a reload', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Testing' }).click();
    const moved = written(page);
    await page.getByRole('menuitem', { name: 'Move left' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Testing',
      'In Progress',
      'In Review',
      'Done',
    ]);
    await moved;
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Testing',
      'In Progress',
      'In Review',
      'Done',
    ]);
  } finally {
    await removeSeededUser(userId);
  }
});

test('the end columns cannot be moved past the end', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for Ready to Work' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Column actions for Done' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move right' })).toBeDisabled();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees no column menu', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Owned elsewhere');
  await context.clearCookies();
  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByTestId('column-name')).toHaveText(DEFAULTS);
    await expect(page.getByRole('button', { name: /^Column actions for/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(viewer.userId);
  }
});

test('deleting a column moves its cards into the named target', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Rehomed', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByLabel('Move its cards to').selectOption({ label: 'Ready to Work' });
    const deleted = written(page);
    await page.getByRole('button', { name: 'Delete column' }).click();

    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Testing',
      'In Review',
      'Done',
    ]);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Rehomed']);

    await deleted;
    await page.reload();
    await expect(page.getByTestId('column-name')).toHaveText([
      'Ready to Work',
      'In Testing',
      'In Review',
      'Done',
    ]);
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Rehomed']);
  } finally {
    await removeSeededUser(userId);
  }
});

// Both cards are seeded at rank 'a0', so the order below can only come from the
// re-rank the delete performs, never from the ranks they arrived with.
test('arriving cards land below the ones already there', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: userId, title: 'Already here', rank: 'a0' });
  await seedCard(inProgress.id, { boardId, createdById: userId, title: 'Arriving', rank: 'a0' });

  try {
    await page.goto(`/boards/${boardId}`);

    await page.getByRole('button', { name: 'Column actions for In Progress' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByLabel('Move its cards to').selectOption({ label: 'Ready to Work' });
    const deleted = written(page);
    await page.getByRole('button', { name: 'Delete column' }).click();

    await deleted;
    await page.reload();
    await expect(
      page.locator(`[data-column-id="${ready.id}"]`).getByTestId('card-title'),
    ).toHaveText(['Already here', 'Arriving']);
  } finally {
    await removeSeededUser(userId);
  }
});
