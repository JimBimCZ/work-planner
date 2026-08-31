import type { BrowserContext, Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { Pool } from 'pg';

import { DEFAULT_COLUMN_NAMES } from '../../lib/board-defaults';

// Playwright reuses a worker process across spec files, so one file's
// afterAll would otherwise end the pool while the next file is still seeding.
// Creating it on demand makes closeSeedPool safe to call from every spec.
let pool: Pool | null = null;

function seedPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// A server action is a POST back to the page's own URL, and the optimistic
// update lands well before it resolves. Reloading in between aborts the write
// in flight, so every test that reloads waits on the round trip first.
export const written = (page: Page) => page.waitForResponse((r) => r.request().method() === 'POST');

export type SeededSession = { userId: string; email: string };

export async function seedSession(context: BrowserContext): Promise<SeededSession> {
  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const email = `${userId}@example.test`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // "user" is a reserved word, and the adapter's columns are camelCase, so
  // every identifier here has to be quoted.
  await seedPool().query('insert into "user" (id, name, email) values ($1, $2, $3)', [
    userId,
    'Test User',
    email,
  ]);
  await seedPool().query(
    'insert into "session" ("sessionToken", "userId", expires) values ($1, $2, $3)',
    [sessionToken, userId, expires],
  );

  // Playwright's baseURL is HTTP, so the cookie carries no __Secure- prefix.
  await context.addCookies([
    { name: 'authjs.session-token', value: sessionToken, url: 'http://localhost:3000' },
  ]);

  return { userId, email };
}

export async function removeSeededUser(userId: string): Promise<void> {
  // The session row goes with it: both foreign keys cascade.
  await seedPool().query('delete from "user" where id = $1', [userId]);
}

export async function seedBoard(ownerId: string, name = 'Seeded board'): Promise<string> {
  const boardId = crypto.randomUUID();
  const ranks = generateNKeysBetween(null, null, DEFAULT_COLUMN_NAMES.length);

  await seedPool().query('insert into boards (id, name, owner_id) values ($1, $2, $3)', [
    boardId,
    name,
    ownerId,
  ]);
  await seedPool().query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [
    boardId,
    ownerId,
    'owner',
  ]);
  for (const [position, columnName] of DEFAULT_COLUMN_NAMES.entries()) {
    await seedPool().query('insert into columns (id, board_id, name, rank) values ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      boardId,
      columnName,
      ranks[position],
    ]);
  }

  return boardId;
}

export async function seedMember(
  boardId: string,
  userId: string,
  role: 'owner' | 'member' | 'viewer',
): Promise<void> {
  await seedPool().query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [
    boardId,
    userId,
    role,
  ]);
}

export async function closeSeedPool(): Promise<void> {
  const open = pool;
  pool = null;
  await open?.end();
}

export async function boardColumns(
  boardId: string,
): Promise<{ id: string; name: string; rank: string }[]> {
  const { rows } = await seedPool().query<{ id: string; name: string; rank: string }>(
    'select id, name, rank from columns where board_id = $1 order by rank',
    [boardId],
  );
  return rows;
}

// generateKeyBetween(null, null) always returns the same key, so seeding two
// cards into one column with no explicit rank would collide unless the
// default is read from that column's current last rank instead.
async function nextCardRank(columnId: string): Promise<string> {
  const { rows } = await seedPool().query<{ rank: string }>(
    'select rank from cards where column_id = $1 order by rank desc limit 1',
    [columnId],
  );
  return generateNKeysBetween(rows[0]?.rank ?? null, null, 1)[0];
}

export async function seedCard(
  columnId: string,
  opts: { boardId: string; createdById: string; title?: string; rank?: string },
): Promise<string> {
  const cardId = crypto.randomUUID();
  const rank = opts.rank ?? (await nextCardRank(columnId));
  await seedPool().query(
    'insert into cards (id, board_id, column_id, title, rank, created_by_id) values ($1, $2, $3, $4, $5, $6)',
    [cardId, opts.boardId, columnId, opts.title ?? 'Seeded card', rank, opts.createdById],
  );
  return cardId;
}

export async function seedComment(
  cardId: string,
  authorId: string,
  body = 'Seeded comment',
): Promise<string> {
  const commentId = crypto.randomUUID();
  await seedPool().query(
    'insert into comments (id, card_id, author_id, body) values ($1, $2, $3, $4)',
    [commentId, cardId, authorId, body],
  );
  return commentId;
}
