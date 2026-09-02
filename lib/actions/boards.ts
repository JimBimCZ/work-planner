'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { DEFAULT_COLUMN_NAMES } from '@/lib/board-defaults';
import { db } from '@/lib/db';
import { attachments, boardMembers, boards, columns } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';
import { seedRanks } from '@/lib/rank';
import { forgetObjects } from '@/lib/storage';

const boardName = z.string().trim().min(1).max(80);

const createSchema = z.object({ name: boardName });
const renameSchema = z.object({ boardId: z.string().min(1), name: boardName });
const deleteSchema = z.object({ boardId: z.string().min(1), confirmName: z.string() });

export async function createBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  const ownerId = session.user.id;
  const ranks = seedRanks(DEFAULT_COLUMN_NAMES.length);

  const board = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(boards)
      .values({ name: parsed.data.name, ownerId })
      .returning();

    await tx.insert(boardMembers).values({ boardId: created.id, userId: ownerId, role: 'owner' });
    await tx.insert(columns).values(
      DEFAULT_COLUMN_NAMES.map((name, position) => ({
        boardId: created.id,
        name,
        rank: ranks[position],
      })),
    );

    return created;
  });

  revalidatePath('/boards');
  return { ok: true, data: { id: board.id } } as const;
}

export async function renameBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'member');
  } catch (error) {
    return boardAccessResult(error);
  }

  await db.update(boards).set({ name: parsed.data.name }).where(eq(boards.id, parsed.data.boardId));

  revalidatePath('/boards');
  return { ok: true } as const;
}

export async function deleteBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'owner');
  } catch (error) {
    return boardAccessResult(error);
  }

  // Re-checked here because a client can skip the dialog that asked for it.
  const board = await db.query.boards.findFirst({
    where: (b, { eq: equals }) => equals(b.id, parsed.data.boardId),
    columns: { name: true },
  });
  if (!board || board.name !== parsed.data.confirmName.trim()) {
    return { ok: false, error: 'NAME_MISMATCH' } as const;
  }

  // Read before the delete: rows cascade in Postgres, objects in a bucket do
  // not, and after the cascade there is nothing left to read the keys from.
  const keys = await db
    .select({ key: attachments.key })
    .from(attachments)
    .where(eq(attachments.boardId, parsed.data.boardId));

  await db.delete(boards).where(eq(boards.id, parsed.data.boardId));

  await forgetObjects(keys.map((row) => row.key));

  revalidatePath('/boards');
  return { ok: true } as const;
}
