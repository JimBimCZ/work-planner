import { expect, test } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedMember,
  seedSession,
} from './support/session';

// playwright.config.ts loads .env and .env.local into process.env before this
// runs. Without credentials the app is correctly non-realtime, so these tests
// would pass vacuously — skipping says so instead of pretending.
const configured = Boolean(
  process.env.PUSHER_APP_ID &&
    process.env.PUSHER_SECRET &&
    process.env.NEXT_PUBLIC_PUSHER_KEY &&
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
);

test.skip(!configured, 'Pusher credentials are not configured');

test.afterAll(async () => {
  await closeSeedPool();
});

test('a board subscribes to its own private channel', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');

  try {
    await page.goto(`/boards/${boardId}`);
    // Subscription is asynchronous and authorises over /api/pusher/auth, so
    // reaching "subscribed" proves the route signed the channel.
    await expect(page.locator('[data-realtime]')).toHaveAttribute(
      'data-realtime',
      'subscribed',
      { timeout: 15_000 },
    );
  } finally {
    await removeSeededUser(userId);
  }
});

test('a card moved in one browser moves in another, with no reload', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const alice = await seedSession(contextA);
  const boardId = await seedBoard(alice.userId, 'Roadmap');
  const bob = await seedSession(contextB);
  await seedMember(boardId, bob.userId, 'member');
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await pageA.goto(`/boards/${boardId}`);
    await pageB.goto(`/boards/${boardId}`);
    // Both must be subscribed before the move, or the test races the socket.
    for (const page of [pageA, pageB]) {
      await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
        timeout: 15_000,
      });
    }

    await expect(
      pageB.locator(`[data-column-id="${ready.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();

    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Move to' }).click();
    await pageA.getByRole('menuitem', { name: inProgress.name }).click();

    // B is never reloaded. If this passes after a reload it proves nothing.
    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await removeSeededUser(alice.userId);
    await removeSeededUser(bob.userId);
  }
});

test('a board the user cannot read never subscribes', async ({ page, context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Private');
  await page.context().clearCookies();
  const outsider = await seedSession(context);

  try {
    // The board 404s for an outsider, so there is no canvas to subscribe. The
    // channel refusal is asserted directly against the route instead.
    const response = await page.request.post('/api/pusher/auth', {
      form: { socket_id: '123.456', channel_name: `private-board-${boardId}` },
    });
    expect(response.status()).toBe(403);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(outsider.userId);
  }
});
