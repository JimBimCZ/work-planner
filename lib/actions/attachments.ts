'use server';

import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { boardUsage, pendingCutoff, uploaderUsage } from '@/lib/attachments';
import {
  ATTACHMENTS_PER_CARD,
  ATTACHMENT_SIZE_MAX,
  FILENAME_MAX,
  STORAGE_PER_ACCOUNT,
  STORAGE_PER_BOARD,
} from '@/lib/attachments-limits';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { forgetObjects, objectKey, presignPut, storageConfigured } from '@/lib/storage';
import { boardIdForCard } from './scope';

const id = z.string().min(1);
const mutationId = z.uuid();

const requestSchema = z.object({
  cardId: id,
  filename: z.string().trim().min(1).max(FILENAME_MAX),
  contentType: z.string().min(1).max(255),
  // The client's claim, used only to reserve space. confirmUpload replaces it
  // with what headObject actually read back.
  size: z.number().int().positive().max(ATTACHMENT_SIZE_MAX),
  mutationId,
});

// Deletes this card's abandoned uploads and their objects. Vercel rules out a
// scheduled sweeper, so this runs on the write path — the same read-time
// expiry board_invites already uses, moved to where the slot is contested.
async function sweepStalePending(cardId: string): Promise<void> {
  const cutoff = pendingCutoff();
  const isStale = and(
    eq(attachments.cardId, cardId),
    eq(attachments.status, 'pending'),
    lt(attachments.createdAt, cutoff),
  );

  const stale = await db
    .select({ id: attachments.id, key: attachments.key })
    .from(attachments)
    .where(isStale);
  if (stale.length === 0) return;

  await db.delete(attachments).where(isStale);
  await forgetObjects(stale.map((row) => row.key));
}

export async function requestUpload(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  if (!storageConfigured()) return { ok: false, error: 'UNAVAILABLE' } as const;

  const { cardId, filename, contentType, size } = parsed.data;

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await sweepStalePending(cardId);

  // Guards, not invariants: two simultaneous requests can both read the same
  // total. Admitting one extra file costs a few megabytes, and the
  // alternatives are a lock or a constraint that neither limit is worth.
  const onCard = await db.query.attachments.findMany({
    where: (row, { eq: is }) => is(row.cardId, cardId),
    columns: { id: true },
  });
  if (onCard.length >= ATTACHMENTS_PER_CARD) {
    return { ok: false, error: 'TOO_MANY' } as const;
  }

  if ((await boardUsage(boardId)) + size > STORAGE_PER_BOARD) {
    return { ok: false, error: 'BOARD_FULL' } as const;
  }
  if ((await uploaderUsage(session.user.id)) + size > STORAGE_PER_ACCOUNT) {
    return { ok: false, error: 'ACCOUNT_FULL' } as const;
  }

  const attachmentId = crypto.randomUUID();
  const key = objectKey(boardId, attachmentId);

  await db.insert(attachments).values({
    id: attachmentId,
    boardId,
    cardId,
    uploaderId: session.user.id,
    key,
    filename,
    contentType,
    size,
    status: 'pending',
  });

  return {
    ok: true,
    data: { attachmentId, url: await presignPut(key, contentType) },
  } as const;
}
