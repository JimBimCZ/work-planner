import { cache } from 'react';
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

// The board layout and the board page both re-check access and both read the
// board, because CLAUDE.md requires every entry point to verify rather than
// trust a parent. React's cache collapses the duplicate call within a request.
export const getBoardWithColumns = cache(async (boardId: string) => {
  const board = await db.query.boards.findFirst({
    where: (b, { eq }) => eq(b.id, boardId),
    columns: { id: true, name: true },
    with: {
      columns: {
        columns: { id: true, name: true, rank: true },
        orderBy: (column, { asc }) => [asc(column.rank)],
      },
    },
  });

  return board ?? null;
});
