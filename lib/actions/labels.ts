'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cardLabels, labels } from '@/lib/db/schema';
import { publish } from '@/lib/events';
import { LABEL_NAME_MAX, LABELS_PER_BOARD } from '@/lib/labels';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { boardIdForCard, touchBoard } from './scope';

const id = z.string().min(1);
// Every call site mints the mutationId with crypto.randomUUID(). Bounding it to
// a UUID keeps an oversized value from pushing the published event over
// PAYLOAD_CEILING and silently dropping it for every other viewer — card.labelled
// is the worst place to keep a loose schema, since it's the one new event
// carrying a variable-length array.
const mutationId = z.uuid();

// Trimmed before validation, not after: a pasted name brings its whitespace,
// and '   ' must fail the minimum rather than be stored as three spaces.
const labelName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1).max(LABEL_NAME_MAX),
);

const createSchema = z.object({ boardId: id, name: labelName, mutationId });
const renameSchema = z.object({ labelId: id, name: labelName, mutationId });
const deleteSchema = z.object({ labelId: id, mutationId });
const setSchema = z.object({
  cardId: id,
  // Deduplicated by the set, and capped at the board's own maximum: a longer
  // list can only be a client bug or an attempt to grow the payload.
  labelIds: z.array(id).max(LABELS_PER_BOARD),
  mutationId,
});

// Postgres's unique_violation. The database owns uniqueness because a
// check-then-insert lets two simultaneous creates both pass the check.
const isDuplicate = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

async function labelScope(labelId: string) {
  const label = await db.query.labels.findFirst({
    where: (row, { eq: is }) => is(row.id, labelId),
    columns: { id: true, boardId: true, name: true },
  });
  return label ?? null;
}

export async function createLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { boardId, name } = parsed.data;
  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // A guard, not an invariant: two simultaneous creates can both read 49 and
  // both succeed. Admitting a fifty-first label costs nothing — the payload
  // maths has an order of magnitude of headroom — and the alternatives are a
  // lock or a constraint, neither of which this limit is worth.
  const existing = await db.query.labels.findMany({
    where: (label, { eq: is }) => is(label.boardId, boardId),
    columns: { id: true },
  });
  if (existing.length >= LABELS_PER_BOARD) {
    return { ok: false, error: 'LIMIT_REACHED' } as const;
  }

  let created;
  try {
    [created] = await db.insert(labels).values({ boardId, name }).returning({ id: labels.id });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, error: 'DUPLICATE' } as const;
    throw error;
  }

  await publish(boardId, {
    type: 'label.created',
    id: created.id,
    name,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  return { ok: true, data: { id: created.id } } as const;
}

export async function renameLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const label = await labelScope(parsed.data.labelId);
  if (!label) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, label.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  const { name } = parsed.data;
  try {
    await db.update(labels).set({ name }).where(eq(labels.id, label.id));
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, error: 'DUPLICATE' } as const;
    throw error;
  }

  await publish(label.boardId, {
    type: 'label.updated',
    id: label.id,
    name,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  return { ok: true } as const;
}

export async function deleteLabel(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const label = await labelScope(parsed.data.labelId);
  if (!label) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, label.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // card_labels cascades, so the assignments go with the row. That cascade is
  // asserted in e2e/schema.spec.ts rather than trusted.
  await db.delete(labels).where(eq(labels.id, label.id));

  await publish(label.boardId, {
    type: 'label.deleted',
    id: label.id,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  return { ok: true } as const;
}

export async function setCardLabels(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const { cardId } = parsed.data;
  const labelIds = [...new Set(parsed.data.labelIds)];

  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false, error: 'NOT_FOUND' } as const;

  try {
    await assertBoardAccess(session.user.id, boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Every submitted id is re-read and checked against this card's own board,
  // inside the same transaction that writes them: a label deleted between the
  // read and the write must fail this check, not raise an unhandled foreign
  // key violation out of the insert below. An id from another board would
  // otherwise be written verbatim, which leaks that board's vocabulary and
  // poisons its counts.
  const result = await db.transaction(async (tx) => {
    if (labelIds.length > 0) {
      const found = await tx.query.labels.findMany({
        where: (label, { inArray: isIn }) => isIn(label.id, labelIds),
        columns: { id: true, boardId: true },
      });
      const mine = found.filter((label) => label.boardId === boardId);
      if (mine.length !== labelIds.length) return { ok: false, error: 'INVALID' } as const;
    }

    await tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
    if (labelIds.length > 0) {
      await tx.insert(cardLabels).values(labelIds.map((labelId) => ({ cardId, labelId })));
    }
    await touchBoard(tx, boardId);
    return { ok: true } as const;
  });
  if (!result.ok) return result;

  await publish(boardId, {
    type: 'card.labelled',
    id: cardId,
    labelIds,
    mutationId: parsed.data.mutationId,
    actorId: session.user.id,
  });

  revalidatePath('/boards');
  return { ok: true } as const;
}
