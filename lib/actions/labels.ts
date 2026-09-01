'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { labels } from '@/lib/db/schema';
import { publish } from '@/lib/events';
import { LABEL_NAME_MAX, LABELS_PER_BOARD } from '@/lib/labels';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

const id = z.string().min(1);
const mutationId = z.string().min(1);

// Trimmed before validation, not after: a pasted name brings its whitespace,
// and '   ' must fail the minimum rather than be stored as three spaces.
const labelName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1).max(LABEL_NAME_MAX),
);

const createSchema = z.object({ boardId: id, name: labelName, mutationId });
const renameSchema = z.object({ labelId: id, name: labelName, mutationId });
const deleteSchema = z.object({ labelId: id, mutationId });

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

  revalidatePath('/boards');
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

  revalidatePath('/boards');
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

  revalidatePath('/boards');
  return { ok: true } as const;
}
