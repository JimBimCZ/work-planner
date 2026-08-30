'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { DEFAULT_COLUMN_NAMES } from '@/lib/board-defaults';
import { db } from '@/lib/db';
import { boardMembers, boards, columns } from '@/lib/db/schema';
import { seedRanks } from '@/lib/rank';

const boardName = z.string().trim().min(1).max(80);

const createSchema = z.object({ name: boardName });

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
