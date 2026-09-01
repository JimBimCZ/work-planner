import { expect, test, type Browser } from '@playwright/test';
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

test('a client does not re-apply its own move', async ({ page, context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Roadmap');
  const [ready, inProgress] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, { boardId, createdById: userId, title: 'Ship it' });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await page.getByRole('menuitem', { name: 'Move to' }).click();
    await page.getByRole('menuitem', { name: inProgress.name }).click();

    // Long enough for the echo to have arrived and been ignored.
    await page.waitForTimeout(3_000);

    // Exactly one card, in exactly one column. A re-applied echo would show up
    // as a duplicate or as a card that bounced back.
    await expect(page.locator(`[data-card-id="${cardId}"]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await removeSeededUser(userId);
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

    // The 403 above must mean "not a member of this board", not "the session
    // cookie never reached the route" — otherwise this test would still pass
    // with an empty cookie jar. Proving the same caller succeeds once they
    // are a member is what pins the reason down.
    await seedMember(boardId, outsider.userId, 'viewer');
    const asMember = await page.request.post('/api/pusher/auth', {
      form: { socket_id: '123.456', channel_name: `private-board-${boardId}` },
    });
    expect(asMember.status()).toBe(200);
  } finally {
    await removeSeededUser(owner.userId);
    await removeSeededUser(outsider.userId);
  }
});

// Both pages load after everything is seeded, so nothing below ever reloads
// the receiving page. A reload would make all of these pass with no realtime
// at all, which is the one thing they exist to rule out.
async function twoBrowsers(
  browser: Browser,
  seed?: (boardId: string, ownerId: string) => Promise<void>,
) {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const alice = await seedSession(contextA);
  const boardId = await seedBoard(alice.userId, 'Roadmap');
  const bob = await seedSession(contextB);
  await seedMember(boardId, bob.userId, 'member');
  await seed?.(boardId, alice.userId);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.goto(`/boards/${boardId}`);
  await pageB.goto(`/boards/${boardId}`);
  for (const page of [pageA, pageB]) {
    await expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
      timeout: 15_000,
    });
  }

  const close = async () => {
    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await removeSeededUser(alice.userId);
    await removeSeededUser(bob.userId);
  };

  return { boardId, alice, bob, pageA, pageB, close };
}

test('a card added in one browser appears in the other', async ({ browser }) => {
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);

  try {
    await pageA.getByRole('button', { name: `Add card to ${ready.name}` }).click();
    await pageA.getByRole('textbox', { name: 'Card title' }).fill('From Alice');
    await pageA.getByRole('textbox', { name: 'Card title' }).press('Enter');

    await expect(pageB.getByTestId('card-title').filter({ hasText: 'From Alice' })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a card renamed in one browser is renamed in the other', async ({ browser }) => {
  let cardId = '';
  const { pageA, pageB, close } = await twoBrowsers(browser, async (boardId, ownerId) => {
    const [ready] = await boardColumns(boardId);
    cardId = await seedCard(ready.id, { boardId, createdById: ownerId, title: 'Ship it' });
  });

  try {
    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Rename' }).click();
    await pageA.getByRole('textbox', { name: 'Card title' }).fill('Shipped');
    await pageA.getByRole('button', { name: 'Save changes' }).click();

    await expect(pageB.locator(`[data-card-id="${cardId}"] [data-testid="card-title"]`)).toHaveText(
      'Shipped',
      { timeout: 15_000 },
    );
  } finally {
    await close();
  }
});

test('a card deleted in one browser disappears from the other', async ({ browser }) => {
  let cardId = '';
  const { pageA, pageB, close } = await twoBrowsers(browser, async (boardId, ownerId) => {
    const [ready] = await boardColumns(boardId);
    cardId = await seedCard(ready.id, { boardId, createdById: ownerId, title: 'Ship it' });
  });

  try {
    await expect(pageB.locator(`[data-card-id="${cardId}"]`)).toBeVisible();

    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('button', { name: 'Delete card' }).click();

    await expect(pageB.locator(`[data-card-id="${cardId}"]`)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await close();
  }
});

test('a column added in one browser appears in the other', async ({ browser }) => {
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);

  try {
    await expect(pageB.locator('[data-column-id]')).toHaveCount(5);

    await pageA.getByRole('button', { name: `Column actions for ${ready.name}` }).click();
    await pageA.getByRole('menuitem', { name: 'Add column right' }).click();
    await pageA.getByRole('textbox', { name: 'Column name' }).fill('Blocked');
    await pageA.getByRole('button', { name: 'Add column' }).click();

    await expect(pageB.locator('[data-column-id]')).toHaveCount(6, { timeout: 15_000 });
    await expect(pageB.getByTestId('column-name').filter({ hasText: 'Blocked' })).toBeVisible();
  } finally {
    await close();
  }
});

test('a column renamed in one browser is renamed in the other', async ({ browser }) => {
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);

  try {
    await pageA.getByRole('button', { name: `Column actions for ${ready.name}` }).click();
    await pageA.getByRole('menuitem', { name: 'Rename' }).click();
    await pageA.getByRole('textbox', { name: 'Column name' }).fill('Backlog');
    await pageA.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      pageB.locator(`[data-column-id="${ready.id}"]`).getByTestId('column-name'),
    ).toHaveText('Backlog', { timeout: 15_000 });
  } finally {
    await close();
  }
});

test('a column moved in one browser moves in the other', async ({ browser }) => {
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready, inProgress] = await boardColumns(boardId);

  try {
    await pageA.getByRole('button', { name: `Column actions for ${ready.name}` }).click();
    await pageA.getByRole('menuitem', { name: 'Move right' }).click();

    await expect(pageB.locator('[data-column-id]').first()).toHaveAttribute(
      'data-column-id',
      inProgress.id,
      { timeout: 15_000 },
    );
  } finally {
    await close();
  }
});

// The cards do not vanish with the column; they move. Asserting the count on
// the target column is what distinguishes "applied" from "dropped".
test('a column deleted in one browser moves its cards in the other', async ({ browser }) => {
  let cardId = '';
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser, async (id, ownerId) => {
    const [ready] = await boardColumns(id);
    cardId = await seedCard(ready.id, { boardId: id, createdById: ownerId, title: 'Ship it' });
  });
  const [ready, inProgress] = await boardColumns(boardId);

  try {
    await pageA.getByRole('button', { name: `Column actions for ${ready.name}` }).click();
    await pageA.getByRole('menuitem', { name: 'Delete…' }).click();
    await pageA.getByLabel('Move its cards to').selectOption(inProgress.id);
    await pageA.getByRole('button', { name: 'Delete column' }).click();

    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(pageB.locator(`[data-column-id="${ready.id}"]`)).toHaveCount(0);
  } finally {
    await close();
  }
});

// Pusher does not replay. This forces a real gap — the socket goes down, the
// board moves on, the socket comes back — and asserts the client notices.
test('a client that missed events catches up on reconnect', async ({ browser }) => {
  test.setTimeout(180_000);
  let cardId = '';
  const { boardId, pageA, pageB, close } = await twoBrowsers(browser, async (id, ownerId) => {
    const [ready] = await boardColumns(id);
    cardId = await seedCard(ready.id, { boardId: id, createdById: ownerId, title: 'Ship it' });
  });
  const [ready, inProgress] = await boardColumns(boardId);

  try {
    await expect(
      pageB.locator(`[data-column-id="${ready.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();

    // Offline is the honest way to open the gap: pusher-js sees a real
    // disconnection rather than a synthetic event.
    await pageB.context().setOffline(true);
    // Measured at ~30s: navigator.onLine flips at once, but pusher-js only gives
    // up on the socket after its own timers run out. The margin is for that, not
    // for flakiness.
    await expect(pageB.locator('[data-realtime]')).not.toHaveAttribute(
      'data-realtime',
      'subscribed',
      { timeout: 60_000 },
    );

    // A moves a card that B will never be told about.
    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Move to' }).click();
    await pageA.getByRole('menuitem', { name: inProgress.name }).click();
    await expect(
      pageA.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible();

    await pageB.context().setOffline(false);

    // B never reloads. Converging here can only be the reconnect refetch.
    await expect(
      pageB.locator(`[data-column-id="${inProgress.id}"] [data-card-id="${cardId}"]`),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await close();
  }
});
