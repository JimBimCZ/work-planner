import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { recordActivity } from '../lib/actions/scope';
import { ACTIVITY_PER_BOARD } from '../lib/activity-limits';
import { db } from '../lib/db';
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

test.afterAll(async () => {
  await closeSeedPool();
  await db.$client.end();
});

// The cascade that departs from comments.authorId: an entry is a record about
// an action, not a contribution, so it goes with the account.
test('an entry goes with its board, and with its actor', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascade');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      `insert into activity (id, board_id, actor_id, type, subject) values ($1, $2, $3, $4, $5)`,
      ['act-1', boardId, userId, 'board.created', 'Cascade'],
    );

    await pool.query('delete from boards where id = $1', [boardId]);
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from activity where board_id = $1',
      [boardId],
    );
    expect(rows[0].n, 'deleting a board takes its feed').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// The unit test proves a delete is issued. Only a real database proves it
// deletes the right rows, and only calling recordActivity proves it is that
// fragment being tested rather than a copy of it.
test('a board keeps its newest entries and drops the rest', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Trim');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Fill the board to its cap, in the past, so the entry written below is the
    // newest and the one that must go is identifiable by id.
    for (let i = 0; i < ACTIVITY_PER_BOARD; i += 1) {
      await pool.query(
        `insert into activity (id, board_id, actor_id, type, subject, created_at)
         values ($1, $2, $3, 'card.created', $4, now() - ($5 || ' seconds')::interval)`,
        [`trim-${i}`, boardId, userId, `card ${i}`, i + 1],
      );
    }

    await db.transaction(async (tx) => {
      await recordActivity(tx, {
        boardId,
        actorId: userId,
        type: 'card.created',
        subjectId: 'card-newest',
        subject: 'Ship it',
        detail: 'In Progress',
      });
    });

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from activity where board_id = $1',
      [boardId],
    );
    expect(rows[0].n, 'the board is held at its cap').toBe(ACTIVITY_PER_BOARD);

    const { rows: oldest } = await pool.query<{ n: number }>(
      `select count(*)::int as n from activity where id = $1`,
      [`trim-${ACTIVITY_PER_BOARD - 1}`],
    );
    expect(oldest[0].n, 'the oldest entry is the one dropped').toBe(0);

    const { rows: newest } = await pool.query<{ n: number }>(
      `select count(*)::int as n from activity where board_id = $1 and subject_id = 'card-newest'`,
      [boardId],
    );
    expect(newest[0].n, 'the entry just written survived its own trim').toBe(1);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// The marker is per board and per reader, and belongs to neither beyond their
// own lifetime: both references cascade.
test('a read marker goes with its board and with its user', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Marker');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      'insert into activity_reads (board_id, user_id, last_seen_at) values ($1, $2, now())',
      [boardId, userId],
    );
    await pool.query('delete from boards where id = $1', [boardId]);

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from activity_reads where board_id = $1',
      [boardId],
    );
    expect(rows[0].n).toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// dnd-kit's PointerSensor has a 5px activation distance and only starts the
// drag once it has seen the pointer move, so Playwright's dragTo is silently
// ignored. This is the sequence board-dnd.spec.ts proved works.
async function dragCard(page: Page, title: string, columnId: string) {
  const card = page.locator('[data-card-id]').filter({ hasText: title });
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  await expect(card).toHaveAttribute('style', /translate3d/);
  await page.locator(`[data-column-id="${columnId}"]`).hover();
  const moved = written(page);
  await page.mouse.up();
  await moved;
}

// Two browsers, two drags, three drawer reads and two reloads: well past the
// 30s default, and the budget is what the work takes rather than a hang.
test('a member sees what the other one did, above the line', async ({ browser }) => {
  test.setTimeout(120_000);

  const readerContext = await browser.newContext();
  const actorContext = await browser.newContext();
  const reader = await seedSession(readerContext);
  const other = await seedSession(actorContext);
  // The reader owns the board and the actor is a member on it, so deleting the
  // actor's account leaves the board standing — which is the whole point of
  // the cascade assertion at the end.
  const boardId = await seedBoard(reader.userId, 'Catch up');
  await seedMember(boardId, other.userId, 'member');
  const [first, second] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: reader.userId, title: 'Ship it', rank: 'a0' });
  await seedCard(first.id, {
    boardId,
    createdById: reader.userId,
    title: 'Roll it back',
    rank: 'a1',
  });

  const actor = await actorContext.newPage();
  const watcher = await readerContext.newPage();

  try {
    await actor.goto(`/boards/${boardId}`);
    await dragCard(actor, 'Roll it back', second.id);

    // The reader reads that one first, so a marker exists and the line has
    // somewhere to go. Without this the run proves only that entries render.
    await watcher.goto(`/boards/${boardId}`);
    await watcher.getByRole('button', { name: 'Activity' }).click();
    await expect(watcher.getByText(/moved Roll it back to/)).toBeVisible({ timeout: 15_000 });
    await expect(watcher.getByText('New since your last visit')).toHaveCount(0);
    await watcher.keyboard.press('Escape');

    await dragCard(actor, 'Ship it', second.id);

    await watcher.reload();
    await watcher.getByRole('button', { name: 'Activity' }).click();
    const fresh = watcher.getByText(/moved Ship it to/);
    await expect(fresh).toBeVisible({ timeout: 15_000 });

    // The line marks the boundary: what arrived since the last visit sits
    // above it, what was already read sits below.
    const divider = watcher.getByText('New since your last visit');
    await expect(divider).toBeVisible();
    const line = await divider.boundingBox();
    const unseen = await fresh.boundingBox();
    const seen = await watcher.getByText(/moved Roll it back to/).boundingBox();
    expect(unseen!.y).toBeLessThan(line!.y);
    expect(seen!.y).toBeGreaterThan(line!.y);

    // The cascade, observed rather than argued: the actor deletes their
    // account and their entries leave a board they never owned.
    await actorContext.close();
    await removeSeededUser(other.userId);
    await watcher.reload();
    await watcher.getByRole('button', { name: 'Activity' }).click();
    await expect(watcher.getByText('Nothing here yet').first()).toBeVisible({ timeout: 15_000 });
    await expect(watcher.getByText(/moved Ship it to/)).toHaveCount(0);
  } finally {
    await readerContext.close();
    await actorContext.close();
    await removeSeededUser(reader.userId);
  }
});
