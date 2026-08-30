import type { BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

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

export async function closeSeedPool(): Promise<void> {
  await pool.end();
}
