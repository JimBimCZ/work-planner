import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
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
});

// The smallest valid PNG (a single pixel), inlined rather than read from disk
// so the test carries no fixture file.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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

test('a member attaches a file through the modal, it survives a reload, and can be deleted', async ({
  page,
  context,
}) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'File flow');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId, title: 'Attach me' });

  try {
    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByText('Nothing attached yet')).toBeVisible();

    await page
      .getByLabel('Add file')
      .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL_PNG });

    // The round trip is real: a presigned PUT to the bucket, then confirmUpload
    // reading it back with headObject, so this needs more than the default timeout.
    await expect(page.getByRole('img', { name: 'pixel.png' })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByRole('img', { name: 'pixel.png' })).toBeVisible();

    const deleted = written(page);
    await page.getByRole('button', { name: 'Delete pixel.png' }).click();
    await deleted;
    await expect(page.getByRole('img', { name: 'pixel.png' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('Nothing attached yet')).toBeVisible();
  } finally {
    await removeSeededUser(userId);
  }
});

test('a viewer sees an attachment and no controls to change it', async ({
  page,
  context,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const owner = await seedSession(ownerContext);

  const boardId = await seedBoard(owner.userId, 'Read only files');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, {
    boardId,
    createdById: owner.userId,
    title: 'Shared file',
  });

  const viewer = await seedSession(context);
  await seedMember(boardId, viewer.userId, 'viewer');

  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/boards/${boardId}/cards/${cardId}`);
    await ownerPage
      .getByLabel('Add file')
      .setInputFiles({ name: 'shared.png', mimeType: 'image/png', buffer: PIXEL_PNG });
    await expect(ownerPage.getByRole('img', { name: 'shared.png' })).toBeVisible({
      timeout: 15_000,
    });
    await ownerContext.close();

    await page.goto(`/boards/${boardId}/cards/${cardId}`);
    await expect(page.getByRole('img', { name: 'shared.png' })).toBeVisible();
    await expect(page.getByLabel('Add file')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  } finally {
    await removeSeededUser(viewer.userId);
    await removeSeededUser(owner.userId);
  }
});
