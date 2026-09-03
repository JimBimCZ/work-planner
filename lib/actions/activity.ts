'use server';

import { z } from 'zod';

import { boardActivity } from '@/lib/activity';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { activityReads } from '@/lib/db/schema';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

const schema = z.object({ boardId: z.string().min(1) });

export async function openActivity(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  const { boardId } = parsed.data;
  const userId = session.user.id;

  // Read before write, and in that order deliberately: the answer to "what is
  // new" is the marker as it was when this visit started. Upserting first
  // would put the line at the top every time and the feature would do nothing.
  const previous = await db.query.activityReads.findFirst({
    where: (r, { and, eq }) => and(eq(r.boardId, boardId), eq(r.userId, userId)),
    columns: { lastSeenAt: true },
  });

  const lines = await boardActivity(boardId);

  const now = new Date();
  await db
    .insert(activityReads)
    .values({ boardId, userId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [activityReads.boardId, activityReads.userId],
      set: { lastSeenAt: now },
    });

  return {
    ok: true,
    data: { lines, seenAt: previous?.lastSeenAt.toISOString() ?? null },
  } as const;
}
