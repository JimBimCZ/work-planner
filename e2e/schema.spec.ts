import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// The whole no-orphan design rests on NO ACTION being checked at the end of the
// statement rather than immediately. If this fails, cards.columnId must become
// ON DELETE cascade and the rule moves entirely into deleteColumn.
test('deleting a board takes its columns and cards with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascade');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from boards where id = $1', [boardId]);

    for (const table of ['cards', 'columns', 'board_members']) {
      const { rows } = await pool.query(`select count(*)::int as n from ${table} where board_id = $1`, [
        boardId,
      ]);
      expect(rows[0].n, `${table} should be empty`).toBe(0);
    }
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a column that still holds cards is refused by the database', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'No orphans');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await expect(pool.query('delete from columns where id = $1', [first.id])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
