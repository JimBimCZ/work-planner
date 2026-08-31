'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cards } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { ranksAfter } from '@/lib/rank';

import { boardIdForCard, boardIdForColumn, touchBoard } from './scope';

const cardTitle = z.string().trim().min(1).max(200);
const id = z.string().min(1);

const createSchema = z.object({ columnId: id, title: cardTitle });
const renameSchema = z.object({ cardId: id, title: cardTitle });
const deleteSchema = z.object({ cardId: id });

export async function createCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const createdById = session.user.id;

  const boardId = await boardIdForColumn(parsed.data.columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(createdById, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const siblings = await tx.query.cards.findMany({
      where: (card, { eq: is }) => is(card.columnId, parsed.data.columnId),
      columns: { id: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const [rank] = ranksAfter(siblings.at(-1)?.rank ?? null, 1);

    const [row] = await tx
      .insert(cards)
      .values({
        boardId,
        columnId: parsed.data.columnId,
        title: parsed.data.title,
        rank,
        createdById,
      })
      .returning();

    await touchBoard(tx, boardId);
    return { id: row.id, rank };
  });

  revalidatePath('/boards');
  return { ok: true, data: created } as const;
}

export async function renameCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ title: parsed.data.title }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function deleteCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(parsed.data.cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.delete(cards).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
