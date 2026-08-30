import type { BrowserContext } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { Pool } from 'pg';

import { DEFAULT_COLUMN_NAMES } from '../../lib/board-defaults';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type SeededSession = { userId: string; email: string };

export async function seedSession(context: BrowserContext): Promise<SeededSession> {
  const userId = crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const email = `${userId}@example.test`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // "user" is a reserved word, and the adapter's columns are camelCase, so
  // every identifier here has to be quoted.
  await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
    userId,
    'Test User',
    email,
  ]);
  await pool.query(
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
  await pool.query('delete from "user" where id = $1', [userId]);
}

export async function seedBoard(ownerId: string, name = 'Seeded board'): Promise<string> {
  const boardId = crypto.randomUUID();
  const ranks = generateNKeysBetween(null, null, DEFAULT_COLUMN_NAMES.length);

  await pool.query('insert into boards (id, name, owner_id) values ($1, $2, $3)', [
    boardId,
    name,
    ownerId,
  ]);
  await pool.query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [
    boardId,
    ownerId,
    'owner',
  ]);
  for (const [position, columnName] of DEFAULT_COLUMN_NAMES.entries()) {
    await pool.query('insert into columns (id, board_id, name, rank) values ($1, $2, $3, $4)', [
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
  await pool.query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [
    boardId,
    userId,
    role,
  ]);
}

export async function closeSeedPool(): Promise<void> {
  await pool.end();
}
