import { expect, test } from '@playwright/test';
import {
  closeSeedPool,
  removeSeededUser,
  seedBoard,
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
