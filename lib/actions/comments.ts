'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { comments } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

import { boardIdForCard, commentScope, touchBoard } from './scope';

const id = z.string().min(1);
const body = z.string().trim().min(1).max(4_000);

const addSchema = z.object({ cardId: id, body });
const editSchema = z.object({ commentId: id, body });
const deleteSchema = z.object({ commentId: id });

export async function addComment(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const authorId = session.user.id;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

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
    return { id: row.id };
  });

  revalidatePath('/boards');
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

  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ body: parsed.data.body })
      .where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
  });

  revalidatePath('/boards');
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

  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, parsed.data.commentId));
    await touchBoard(tx, scope.boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
