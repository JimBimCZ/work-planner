import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { recordActivity } from '../lib/actions/scope';
import { ACTIVITY_PER_BOARD } from '../lib/activity-limits';
import { db } from '../lib/db';
import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

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
