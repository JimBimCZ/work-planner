'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { attachments, cards } from '@/lib/db/schema';
import { fromDateInputValue, toDateInputValue } from '@/lib/due';
import { publish } from '@/lib/events';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { ranksAfter, rankBetween } from '@/lib/rank';
import { forgetObjects } from '@/lib/storage';

import { boardIdForCard, boardIdForColumn, cardEventScope, touchBoard } from './scope';

const cardTitle = z.string().trim().min(1).max(200);
const id = z.string().min(1);

// Every call site mints the mutationId with crypto.randomUUID(). Bounding it to
// a UUID keeps an oversized value from pushing the published event over
// PAYLOAD_CEILING and silently dropping it for every other viewer.
const createSchema = z.object({ columnId: id, title: cardTitle, mutationId: z.uuid() });
const renameSchema = z.object({ cardId: id, title: cardTitle, mutationId: z.uuid() });
const deleteSchema = z.object({ cardId: id, mutationId: z.uuid() });
const descriptionSchema = z.object({
  cardId: id,
  description: z.string().trim().max(10_000),
  mutationId: z.uuid(),
});
const dueDateSchema = z.object({
  cardId: id,
  dueDate: z.string().nullable(),
  mutationId: z.uuid(),
});
const readSchema = z.object({ cardId: id });
const moveSchema = z.object({
  cardId: id,
  toColumnId: id,
  beforeCardId: id.nullable(),
  afterCardId: id.nullable(),
  mutationId: z.uuid(),
});

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
    return { id: row.id, rank, createdAt: row.createdAt.toISOString() };
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.created',
    mutationId: parsed.data.mutationId,
    actorId: createdById,
    id: created.id,
    columnId: parsed.data.columnId,
    title: parsed.data.title,
    rank: created.rank,
    createdAt: created.createdAt,
    dueDate: null,
  });
  return { ok: true, data: created } as const;
}

export async function renameCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await cardEventScope(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;
  const boardId = card.boardId;

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
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: parsed.data.title,
    dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
    descriptionChanged: false,
  });
  return { ok: true } as const;
}

export async function setCardDescription(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = descriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await cardEventScope(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;
  const boardId = card.boardId;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // An emptied field is a cleared description, not a rejected one.
  const description = parsed.data.description === '' ? null : parsed.data.description;

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ description }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: card.title,
    dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
    descriptionChanged: true,
  });
  return { ok: true } as const;
}

// The one field card.updated cannot carry. A 10,000-character description does
// not fit under Pusher's 10KB limit in any encoding, so the event says that it
// changed and the open card asks for it.
export async function readCardDescription(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, parsed.data.cardId),
    columns: { boardId: true, description: true },
  });
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  return { ok: true, data: { description: card.description } } as const;
}

export async function setCardDueDate(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = dueDateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  // A calendar date, not an instant: the client sends yyyy-mm-dd and the row
  // holds midnight UTC of that day.
  const dueDate = parsed.data.dueDate === null ? null : fromDateInputValue(parsed.data.dueDate);
  if (parsed.data.dueDate !== null && dueDate === null) {
    return { ok: false, error: 'INVALID' } as const;
  }

  const card = await cardEventScope(parsed.data.cardId);
  if (!card) return { ok: false, error: 'NOT_FOUND' } as const;
  const boardId = card.boardId;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx.update(cards).set({ dueDate }).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
    title: card.title,
    dueDate: parsed.data.dueDate,
    descriptionChanged: false,
  });
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

  // Read before the delete: rows cascade in Postgres, objects in a bucket do
  // not, and after the cascade there is nothing left to read the keys from.
  const keys = await db
    .select({ key: attachments.key })
    .from(attachments)
    .where(eq(attachments.cardId, parsed.data.cardId));

  await db.transaction(async (tx) => {
    await tx.delete(cards).where(eq(cards.id, parsed.data.cardId));
    await touchBoard(tx, boardId);
  });

  await forgetObjects(keys.map((row) => row.key));

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'card.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.cardId,
  });
  return { ok: true } as const;
}

export async function moveCard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { cardId, toColumnId, beforeCardId, afterCardId } = parsed.data;
  if (beforeCardId && beforeCardId === afterCardId) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Asked after the access check, not before: answering it first would tell a
  // caller with no membership whether two ids sit on the same board.
  const targetBoardId = await boardIdForColumn(toColumnId);
  if (targetBoardId !== boardId) return { ok: false, error: 'INVALID' } as const;

  const rank = await db.transaction(async (tx) => {
    const siblings = await tx.query.cards.findMany({
      where: (card, { eq: is }) => is(card.columnId, toColumnId),
      columns: { id: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const before = beforeCardId ? siblings.find((card) => card.id === beforeCardId) : null;
    const after = afterCardId ? siblings.find((card) => card.id === afterCardId) : null;

    // A named neighbour that is not in the target column means the client is
    // working from a board someone else has already changed.
    if ((beforeCardId && !before) || (afterCardId && !after)) return null;
    if (before && after && before.rank >= after.rank) return null;

    const next = rankBetween(before?.rank ?? null, after?.rank ?? null);

    await tx.update(cards).set({ columnId: toColumnId, rank: next }).where(eq(cards.id, cardId));
    await touchBoard(tx, boardId);
    return next;
  });

  if (rank === null) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  // After the commit, never inside it: a rolled-back write that already
  // announced itself leaves every other client ahead of the database.
  await publish(boardId, {
    type: 'card.moved',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: cardId,
    columnId: toColumnId,
    rank,
  });
  return { ok: true, data: { rank } } as const;
}
