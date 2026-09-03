'use server';

import { z } from 'zod';

import { boardActivity } from '@/lib/activity';
import { auth } from '@/lib/auth';
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

  return { ok: true, data: { lines: await boardActivity(parsed.data.boardId) } } as const;
}
