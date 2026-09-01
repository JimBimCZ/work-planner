'use server';

import { z } from 'zod';

import { auth } from '@/lib/auth';
import { toBoardState } from '@/lib/board-state';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, boardAccessResult } from '@/lib/permissions';

const schema = z.object({ boardId: z.string().min(1) });

// A read, not a mutation: it publishes nothing and takes no mutationId. It
// exists so a client that missed events while disconnected can catch up —
// Pusher does not replay.
export async function readBoard(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHENTICATED' } as const;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID' } as const;

  try {
    await assertBoardAccess(session.user.id, parsed.data.boardId, 'viewer');
  } catch (error) {
    return boardAccessResult(error);
  }

  const board = await getBoardWithColumns(parsed.data.boardId);
  if (!board) return { ok: false, error: 'NOT_FOUND' } as const;

  return { ok: true, data: toBoardState(board) } as const;
}
