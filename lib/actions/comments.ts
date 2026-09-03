'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getCardForView } from '@/lib/cards';
import { db } from '@/lib/db';
import { comments } from '@/lib/db/schema';
import { publish, publishComment } from '@/lib/events';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

import { cardEventScope, commentScope, recordActivity, touchBoard } from './scope';

const id = z.string().min(1);
const body = z.string().trim().min(1).max(4_000);

// Every call site mints the mutationId with crypto.randomUUID(). Bounding it to
// a UUID keeps an oversized value from pushing the published event over
// PAYLOAD_CEILING and silently dropping it for every other viewer.
const addSchema = z.object({ cardId: id, body, mutationId: z.uuid() });
const editSchema = z.object({ commentId: id, body, mutationId: z.uuid() });
const deleteSchema = z.object({ commentId: id, mutationId: z.uuid() });
const readSchema = z.object({ cardId: id });

export async function addComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const authorId = session.user.id;

  const card = await cardEventScope(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;
  const boardId = card.boardId;

  // A viewer may comment. This is the only write in the app with that floor.
  try {
    await assertBoardAccess(authorId, boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({
        cardId: parsed.data.cardId,
        authorId,
        body: parsed.data.body,
      })
      .returning();

    await touchBoard(tx, boardId);
    // The entry indexes the card; the comment is where the words are.
    await recordActivity(tx, {
      boardId,
      actorId: authorId,
      type: 'comment.added',
      subjectId: parsed.data.cardId,
      subject: card.title,
    });
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  });

  revalidatePath('/boards');
  await publishComment(boardId, {
    type: 'comment.created',
    mutationId: parsed.data.mutationId,
    actorId: authorId,
    id: created.id,
    cardId: parsed.data.cardId,
    body: parsed.data.body,
    createdAt: created.createdAt,
    author: {
      id: authorId,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    },
  });
  return { ok: true, data: created } as const;
}

export async function editComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const scope = await commentScope(parsed.data.commentId);
  if (!scope) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, scope.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (scope.authorId !== session.user.id) return { ok: false, error: 'FORBIDDEN' } as const;

  const actorId = session.user.id;

  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ body: parsed.data.body })
      .where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
    await recordActivity(tx, {
      boardId: scope.boardId,
      actorId,
      type: 'comment.edited',
      subjectId: scope.cardId,
      subject: scope.title,
    });
  });

  revalidatePath('/boards');
  await publish(scope.boardId, {
    type: 'comment.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.commentId,
    cardId: scope.cardId,
    body: parsed.data.body,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true } as const;
}

export async function deleteComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const scope = await commentScope(parsed.data.commentId);
  if (!scope) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, scope.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  if (scope.authorId !== session.user.id) return { ok: false, error: 'FORBIDDEN' } as const;

  const actorId = session.user.id;

  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
    await recordActivity(tx, {
      boardId: scope.boardId,
      actorId,
      type: 'comment.deleted',
      subjectId: scope.cardId,
      subject: scope.title,
    });
  });

  revalidatePath('/boards');
  await publish(scope.boardId, {
    type: 'comment.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.commentId,
    cardId: scope.cardId,
  });
  return { ok: true } as const;
}

// Only reached when a comment was too large to publish inline. It re-reads the
// whole thread rather than one comment, because getCardForView already returns
// it in the order the component needs.
export async function readComments(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await getCardForView(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  return { ok: true, data: card.comments } as const;
}
