import { db } from '@/lib/db';
import type { BoardRole } from '@/lib/permissions';

export type BoardSummary = {
  id: string;
  name: string;
  role: BoardRole;
  updatedAt: Date;
};

export async function listBoardsForUser(userId: string): Promise<BoardSummary[]> {
  const memberships = await db.query.boardMembers.findMany({
    where: (member, { eq }) => eq(member.userId, userId),
    columns: { role: true },
    with: { board: { columns: { id: true, name: true, updatedAt: true } } },
  });

  return memberships
    .map(({ role, board }) => ({ id: board.id, name: board.name, role, updatedAt: board.updatedAt }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
