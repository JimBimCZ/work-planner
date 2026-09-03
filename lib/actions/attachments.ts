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
import { publish } from '@/lib/events';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import {
  forgetObjects,
  headObject,
  objectKey,
  presignPut,
  storageConfigured,
} from '@/lib/storage';
import { boardIdForCard, cardEventScope, recordActivity } from './scope';

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

const confirmSchema = z.object({ attachmentId: id, mutationId });

export async function confirmUpload(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const row = await db.query.attachments.findFirst({
    where: (a, { eq: is }) => is(a.id, parsed.data.attachmentId),
    columns: {
      id: true,
      boardId: true,
      cardId: true,
      uploaderId: true,
      key: true,
      filename: true,
      size: true,
      status: true,
      createdAt: true,
    },
  });
  // Somebody else's row, or one already confirmed, answers the same as a row
  // that never existed: a guessed id learns nothing either way.
  if (!row || row.status !== 'pending' || row.uploaderId !== session.user.id) {
    return { ok: false, error: 'NOT_FOUND' } as const;
  }

  try {
    await assertBoardAccess(session.user.id, row.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const head = await headObject(row.key);
  if (!head) {
    // The upload never landed. Drop the reservation so it stops holding a slot.
    await db.delete(attachments).where(eq(attachments.id, row.id));
    return { ok: false, error: 'NOT_FOUND' } as const;
  }

  // Everything from here uses head.size and head.contentType. The values the
  // client declared at requestUpload are not consulted again.
  const reject = async (error: 'TOO_LARGE' | 'BOARD_FULL' | 'ACCOUNT_FULL') => {
    await db.delete(attachments).where(eq(attachments.id, row.id));
    await forgetObjects([row.key]);
    return { ok: false, error } as const;
  };

  if (head.size > ATTACHMENT_SIZE_MAX) return reject('TOO_LARGE');

  // Both sums still include this row's own pending reservation, so subtract it
  // before comparing — otherwise a file is measured against itself.
  const [board, account] = await Promise.all([
    boardUsage(row.boardId),
    uploaderUsage(session.user.id),
  ]);
  if (board - row.size + head.size > STORAGE_PER_BOARD) return reject('BOARD_FULL');
  if (account - row.size + head.size > STORAGE_PER_ACCOUNT) return reject('ACCOUNT_FULL');

  const actorId = session.user.id;
  const card = await cardEventScope(row.cardId);

  await db.transaction(async (tx) => {
    await tx
      .update(attachments)
      .set({ size: head.size, contentType: head.contentType, status: 'ready' })
      .where(eq(attachments.id, row.id));

    await recordActivity(tx, {
      boardId: row.boardId,
      actorId,
      type: 'attachment.added',
      subjectId: row.cardId,
      subject: card?.title ?? null,
      detail: row.filename,
    });
  });

  await publish(row.boardId, {
    type: 'attachment.added',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: row.id,
    cardId: row.cardId,
    filename: row.filename,
    // What the bucket read back, matching the row this just wrote — the
    // declared values are not consulted here either.
    contentType: head.contentType,
    size: head.size,
    createdAt: row.createdAt.toISOString(),
    // No join: the row's uploader is this session, which the NOT_FOUND above
    // has already established.
    uploader: {
      id: session.user.id,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    },
  });

  return { ok: true, data: { attachmentId: row.id } } as const;
}

const deleteSchema = z.object({ attachmentId: id, mutationId });

export async function deleteAttachment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const row = await db.query.attachments.findFirst({
    where: (a, { eq: is }) => is(a.id, parsed.data.attachmentId),
    columns: { id: true, boardId: true, cardId: true, uploaderId: true, key: true, filename: true },
  });
  if (!row) return { ok: false, error: 'NOT_FOUND' } as const;

  let role;
  try {
    role = await assertBoardAccess(session.user.id, row.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // The uploader, or the owner. Unlike a comment — where not even the owner
  // may delete — because the owner is accountable for the bytes on their board
  // and needs a way to clear a file whose uploader is gone.
  const mine = row.uploaderId === session.user.id;
  if (!mine && role !== 'owner') return { ok: false, error: 'FORBIDDEN' } as const;

  const actorId = session.user.id;
  const card = await cardEventScope(row.cardId);

  await db.transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, row.id));

    await recordActivity(tx, {
      boardId: row.boardId,
      actorId,
      type: 'attachment.removed',
      subjectId: row.cardId,
      subject: card?.title ?? null,
      detail: row.filename,
    });
  });

  await forgetObjects([row.key]);

  await publish(row.boardId, {
    type: 'attachment.removed',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: row.id,
    cardId: row.cardId,
  });

  return { ok: true } as const;
}
