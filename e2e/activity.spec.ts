import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { closeSeedPool, removeSeededUser, seedBoard, seedSession } from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
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
