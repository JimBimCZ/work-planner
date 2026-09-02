import { and, eq, gte, or, sql, type SQL } from 'drizzle-orm';

import { PENDING_TTL_MINUTES } from '@/lib/attachments-limits';
import { db } from '@/lib/db';
import { attachments } from '@/lib/db/schema';

export type CardAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: Date;
  uploader: { id: string; name: string | null; image: string | null } | null;
};

export function pendingCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PENDING_TTL_MINUTES * 60 * 1000);
}

// A row counts against the caps when it is ready, or when it is pending and
// still young enough to believe still in flight. A stale pending row is an
// abandoned upload and must hold neither a slot nor a byte against anybody.
function counted(cutoff: Date): SQL | undefined {
  return or(eq(attachments.status, 'ready'), gte(attachments.createdAt, cutoff));
}

async function sumSize(where: SQL | undefined): Promise<number> {
  const [row] = await db
    // bigint, not int: int4 tops out at 2,147,483,647 and STORAGE_PER_ACCOUNT
    // is 2,147,483,648 — an int cast would overflow at exactly the boundary
    // this sum exists to enforce. node-postgres hands bigint back as a string.
    .select({ total: sql<string>`coalesce(sum(${attachments.size}), 0)::bigint` })
    .from(attachments)
    .where(where);
  return Number(row?.total ?? 0);
}

export async function boardUsage(boardId: string, now: Date = new Date()): Promise<number> {
  return sumSize(and(eq(attachments.boardId, boardId), counted(pendingCutoff(now))));
}

export async function uploaderUsage(userId: string, now: Date = new Date()): Promise<number> {
  return sumSize(and(eq(attachments.uploaderId, userId), counted(pendingCutoff(now))));
}

export async function cardAttachments(cardId: string): Promise<CardAttachment[]> {
  const rows = await db.query.attachments.findMany({
    where: (row, { and: all, eq: is }) => all(is(row.cardId, cardId), is(row.status, 'ready')),
    columns: { id: true, filename: true, contentType: true, size: true, createdAt: true },
    orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.id)],
    with: { uploader: { columns: { id: true, name: true, image: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
    uploader: row.uploader ?? null,
  }));
}
