import { db } from '@/lib/db';
import { boardRole } from '@/lib/db/schema';

export type BoardRole = (typeof boardRole.enumValues)[number];

const LADDER: Record<BoardRole, number> = { viewer: 0, member: 1, owner: 2 };

export function atLeast(role: BoardRole, min: BoardRole): boolean {
  return LADDER[role] >= LADDER[min];
}

export class BoardAccessError extends Error {
  constructor(readonly reason: 'FORBIDDEN' | 'NOT_FOUND') {
    super(reason);
    this.name = 'BoardAccessError';
  }
}

// Asks only whether the caller is on the board, never whether the board exists:
// a 403 would confirm a guessed id is real.
export async function assertBoardAccess(
  userId: string,
  boardId: string,
  minRole: BoardRole,
): Promise<BoardRole> {
  const membership = await db.query.boardMembers.findFirst({
    where: (member, { and, eq }) => and(eq(member.boardId, boardId), eq(member.userId, userId)),
    columns: { role: true },
  });

  if (!membership) throw new BoardAccessError('NOT_FOUND');
  if (!atLeast(membership.role, minRole)) throw new BoardAccessError('FORBIDDEN');

  return membership.role;
}

export function boardAccessResult(error: unknown) {
  if (error instanceof BoardAccessError) {
    return { ok: false, error: error.reason } as const;
  }
  throw error;
}
