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

test('a stale pending row stops counting, a fresh one still does', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Usage sums');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const insert = (id: string, status: string, minutesAgo: number, size: number) =>
      pool.query(
        `insert into attachments
           (id, board_id, card_id, uploader_id, key, filename, content_type, size, status, created_at)
         values ($1,$2,$3,$4,$5,'f.bin','application/octet-stream',$6,$7, now() - ($8 || ' minutes')::interval)`,
        [id, boardId, cardId, userId, `boards/${boardId}/${id}`, size, status, String(minutesAgo)],
      );

    await insert('att-ready', 'ready', 120, 1000);
    await insert('att-fresh', 'pending', 1, 200);
    await insert('att-stale', 'pending', 60, 900_000);

    const { rows } = await pool.query<{ total: string }>(
      `select coalesce(sum(size),0)::bigint as total from attachments
        where board_id = $1 and (status = 'ready' or created_at >= now() - interval '15 minutes')`,
      [boardId],
    );
    // ready + fresh pending, and emphatically not the stale one.
    expect(Number(rows[0].total)).toBe(1200);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
