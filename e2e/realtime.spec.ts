import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  boardColumns,
  closeSeedPool,
  seedComment,
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

// The card page mounts its own subscription. Waiting for it is not politeness:
// an event published before B is subscribed is simply never delivered, and the
// test would fail for a reason that has nothing to do with what it asserts.
const subscribed = (page: Page) =>
  expect(page.locator('[data-realtime]')).toHaveAttribute('data-realtime', 'subscribed', {
    timeout: 15_000,
  });

const renameOnBoard = async (page: Page, from: string, to: string) => {
  await page.getByRole('button', { name: `Card actions for ${from}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Card title' }).fill(to);
  await page.getByRole('button', { name: 'Save changes' }).click();
};

test('a title edited elsewhere lands in a field nobody is typing in', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageB);
    await pageA.reload();
    await renameOnBoard(pageA, 'Ship it', 'Shipped');

    await expect(pageB.getByLabel('Card title')).toHaveValue('Shipped', { timeout: 15_000 });
  } finally {
    await close();
  }
});

// The rule this section exists for. Last-write-wins is about stored values; it
// does not license destroying text someone has not sent yet.
test('a field being typed in is not overwritten', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageB);
    await pageB.getByLabel('Card title').fill('Half-written thought');

    await pageA.reload();
    await renameOnBoard(pageA, 'Ship it', 'Shipped');

    await pageB.waitForTimeout(3_000);
    await expect(pageB.getByLabel('Card title')).toHaveValue('Half-written thought');
  } finally {
    await close();
  }
});

test('a description edited elsewhere is refetched', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);

    await pageA.getByLabel('Description').fill('Written by Alice');
    await pageA.getByLabel('Description').blur();

    await expect(pageB.getByLabel('Description')).toHaveValue('Written by Alice', {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a card deleted elsewhere says so rather than vanishing', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageB);
    await pageA.reload();

    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('button', { name: 'Delete card' }).click();

    await expect(pageB.getByText('This card was deleted')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByRole('link', { name: 'Back to the board' })).toBeVisible();
    // The canonical page is a route, not an overlay, so it cannot simply close.
    await expect(pageB.getByLabel('Card title')).toHaveCount(0);
  } finally {
    await close();
  }
});

// The same treatment on the other surface. The modal could in principle close
// itself, so proving the canonical page alone would leave the harder half of
// the gate untested.
test('a card deleted elsewhere says so in the modal too', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  await seedCard(ready.id, { boardId, createdById: alice.userId, title: 'Ship it' });

  try {
    await pageB.reload();
    await subscribed(pageB);
    await pageB.getByTestId('card-title').filter({ hasText: 'Ship it' }).click();
    await expect(pageB.getByRole('dialog')).toBeVisible();

    await pageA.reload();
    await pageA.getByRole('button', { name: 'Card actions for Ship it' }).click();
    await pageA.getByRole('menuitem', { name: 'Delete' }).click();
    await pageA.getByRole('button', { name: 'Delete card' }).click();

    // The modal stays open and says what happened rather than vanishing under
    // the reader, even though the board behind it has dropped the card.
    await expect(pageB.getByRole('dialog').getByText('This card was deleted')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      pageB.getByRole('dialog').getByRole('link', { name: 'Back to the board' }),
    ).toBeVisible();
  } finally {
    await close();
  }
});

// PAYLOAD_CEILING is 8,192 bytes and publish() drops anything over it, so a
// description this size could never have travelled in the event. Arriving at
// all is proof it came back through readCardDescription.
test('a description over the payload ceiling still arrives', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });
  const huge = 'x'.repeat(9_000);

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);

    await pageA.getByLabel('Description').fill(huge);
    await pageA.getByLabel('Description').blur();

    await expect(pageB.getByLabel('Description')).toHaveValue(huge, { timeout: 15_000 });
  } finally {
    await close();
  }
});

test('a comment posted elsewhere appears in an open thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);

    await pageA.getByRole('textbox', { name: 'Add a comment' }).fill('Looks right');
    await pageA.getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(pageB.getByTestId('comment-body')).toHaveText(['Looks right'], {
      timeout: 15_000,
    });
    // The poster sees exactly one row: their optimistic one, reconciled by the
    // action's own response, never doubled by the echo of their own event.
    await expect(pageA.getByTestId('comment-body')).toHaveText(['Looks right']);
  } finally {
    await close();
  }
});

test('a comment edited elsewhere updates in an open thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });
  await seedComment(cardId, alice.userId, 'First thought');

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);

    await pageA.getByRole('button', { name: 'Edit comment: First thought', exact: true }).click();
    await pageA.getByRole('textbox', { name: 'Edit comment: First thought' }).fill('Second thought');
    await pageA.getByRole('button', { name: 'Save changes' }).click();

    await expect(pageB.getByTestId('comment-body')).toHaveText(['Second thought'], {
      timeout: 15_000,
    });
  } finally {
    await close();
  }
});

test('a comment deleted elsewhere leaves the thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });
  await seedComment(cardId, alice.userId, 'Never mind');

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);
    await expect(pageB.getByText('Never mind')).toBeVisible();

    await pageA.getByRole('button', { name: 'Delete comment: Never mind', exact: true }).click();
    // exact, or this also matches the row's own "Delete comment: Never mind".
    await pageA.getByRole('button', { name: 'Delete comment', exact: true }).click();

    await expect(pageB.getByText('Never mind')).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await close();
  }
});

// The gate's forced case. Both the textarea's maxLength and the body schema
// count UTF-16 units, and an emoji is two, so 2,000 of them is the largest
// comment anyone can actually post — and at 8,355 bytes it is over the 8,192
// ceiling, so it can only arrive through the refetch. (The unit test drives
// publishComment with 4,000 directly, where no input cap applies.)
test('a comment too large to publish inline still reaches the thread', async ({ browser }) => {
  const { boardId, alice, pageA, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });
  const huge = '😀'.repeat(2_000);

  try {
    await pageA.goto(`/boards/${boardId}/cards/${cardId}`);
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageA);
    await subscribed(pageB);

    await pageA.getByRole('textbox', { name: 'Add a comment' }).fill(huge);
    await pageA.getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(pageB.getByTestId('comment-body')).toHaveText([huge], { timeout: 15_000 });
  } finally {
    await close();
  }
});

// A remote edit of the comment being edited locally must not reach into the
// open textarea, by the same rule Section 5 applied to the card's fields. Only
// a comment's author may edit it, so the only way to receive a remote edit of
// the comment you are editing is to have the same account open twice — which
// two tabs of one context are.
test('a comment being edited locally is not clobbered', async ({ browser }) => {
  const { boardId, alice, bob, pageB, close } = await twoBrowsers(browser);
  const [ready] = await boardColumns(boardId);
  const cardId = await seedCard(ready.id, {
    boardId,
    createdById: alice.userId,
    title: 'Ship it',
  });
  await seedComment(cardId, bob.userId, 'First thought');
  const otherTab = await pageB.context().newPage();

  try {
    await pageB.goto(`/boards/${boardId}/cards/${cardId}`);
    await otherTab.goto(`/boards/${boardId}/cards/${cardId}`);
    await subscribed(pageB);

    await pageB.getByRole('button', { name: 'Edit comment: First thought', exact: true }).click();
    await pageB.getByRole('textbox', { name: 'Edit comment: First thought' }).fill('Half-written');

    await otherTab
      .getByRole('button', { name: 'Edit comment: First thought', exact: true })
      .click();
    await otherTab
      .getByRole('textbox', { name: 'Edit comment: First thought' })
      .fill('Sent from the other tab');
    await otherTab.getByRole('button', { name: 'Save changes' }).click();

    // The stored body follows the remote edit...
    await expect(pageB.getByTestId('comment-body')).toHaveText(['Sent from the other tab'], {
      timeout: 15_000,
    });
    // ...while the text this tab has not sent yet survives untouched.
    await expect(pageB.getByRole('textbox', { name: /^Edit comment:/ })).toHaveValue(
      'Half-written',
    );
  } finally {
    await otherTab.close();
    await close();
  }
});

