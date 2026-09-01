'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cards, columns } from '@/lib/db/schema';
import { publish } from '@/lib/events';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { ranksAfter, rankBetween } from '@/lib/rank';

import { boardIdForColumn, touchBoard, type Tx } from './scope';

const columnName = z.string().trim().min(1).max(60);
const id = z.string().min(1);

// Every call site mints the mutationId with crypto.randomUUID(). Bounding it to
// a UUID keeps an oversized value from pushing the published event over
// PAYLOAD_CEILING and silently dropping it for every other viewer.
const addSchema = z.object({
  boardId: id,
  name: columnName,
  afterColumnId: id.nullable(),
  mutationId: z.uuid(),
});
const renameSchema = z.object({ columnId: id, name: columnName, mutationId: z.uuid() });
const moveSchema = z.object({
  columnId: id,
  beforeColumnId: id.nullable(),
  afterColumnId: id.nullable(),
  mutationId: z.uuid(),
});
const deleteSchema = z.object({ columnId: id, targetColumnId: id, mutationId: z.uuid() });

function siblingColumns(tx: Tx, boardId: string) {
  return tx.query.columns.findMany({
    where: (column, { eq: is }) => is(column.boardId, boardId),
    columns: { id: true, rank: true },
    orderBy: (column, { asc }) => [asc(column.rank)],
  });
}

export async function addColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, name, afterColumnId } = parsed.data;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const created = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);

    const position = afterColumnId
      ? siblings.findIndex((column) => column.id === afterColumnId)
      : siblings.length - 1;
    if (afterColumnId && position === -1) return null;

    const rank = rankBetween(siblings[position]?.rank ?? null, siblings[position + 1]?.rank ?? null);

    const [row] = await tx.insert(columns).values({ boardId, name, rank }).returning();
    await touchBoard(tx, boardId);
    return { id: row.id, rank };
  });

  if (!created) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'column.created',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: created.id,
    name,
    rank: created.rank,
  });
  return { ok: true, data: created } as const;
}

export async function renameColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const boardId = await boardIdForColumn(parsed.data.columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(columns)
      .set({ name: parsed.data.name })
      .where(eq(columns.id, parsed.data.columnId));
    await touchBoard(tx, boardId);
  });

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'column.updated',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: parsed.data.columnId,
    name: parsed.data.name,
  });
  return { ok: true } as const;
}

export async function moveColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { columnId, beforeColumnId, afterColumnId } = parsed.data;
  if (beforeColumnId && beforeColumnId === afterColumnId) {
    return { ok: false, error: 'INVALID' } as const;
  }

  const boardId = await boardIdForColumn(columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const rank = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);

    const before = beforeColumnId ? siblings.find((c) => c.id === beforeColumnId) : null;
    const after = afterColumnId ? siblings.find((c) => c.id === afterColumnId) : null;

    if ((beforeColumnId && !before) || (afterColumnId && !after)) return null;
    if (before && after && before.rank >= after.rank) return null;

    const next = rankBetween(before?.rank ?? null, after?.rank ?? null);

    await tx.update(columns).set({ rank: next }).where(eq(columns.id, columnId));
    await touchBoard(tx, boardId);
    return next;
  });

  if (rank === null) return { ok: false, error: 'INVALID' } as const;

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'column.moved',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: columnId,
    rank,
  });
  return { ok: true, data: { rank } } as const;
}

export async function deleteColumn(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { columnId, targetColumnId } = parsed.data;

  const boardId = await boardIdForColumn(columnId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const outcome = await db.transaction(async (tx) => {
    const siblings = await siblingColumns(tx, boardId);
    if (siblings.length <= 1) return 'LAST_COLUMN' as const;

    const target = siblings.find((column) => column.id === targetColumnId);
    if (!target || targetColumnId === columnId) return 'INVALID' as const;

    const affected = await tx.query.cards.findMany({
      where: (card, { inArray }) => inArray(card.columnId, [columnId, targetColumnId]),
      columns: { id: true, columnId: true, rank: true },
      orderBy: (card, { asc }) => [asc(card.rank)],
    });

    const moving = affected.filter((card) => card.columnId === columnId);
    const arrivals = affected.filter((card) => card.columnId === targetColumnId);
    const ranks = ranksAfter(arrivals.at(-1)?.rank ?? null, moving.length);

    for (const [position, card] of moving.entries()) {
      await tx
        .update(cards)
        .set({ columnId: targetColumnId, rank: ranks[position] })
        .where(eq(cards.id, card.id));
    }

    await tx.delete(columns).where(eq(columns.id, columnId));
    await touchBoard(tx, boardId);
    return {
      outcome: 'OK' as const,
      cards: moving.map((card, position) => ({
        id: card.id,
        columnId: targetColumnId,
        rank: ranks[position],
      })),
    };
  });

  if (outcome === 'LAST_COLUMN' || outcome === 'INVALID') {
    return { ok: false, error: outcome } as const;
  }

  revalidatePath('/boards');
  await publish(boardId, {
    type: 'column.deleted',
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
    id: columnId,
    targetColumnId,
    cards: outcome.cards,
  });
  return { ok: true } as const;
}
