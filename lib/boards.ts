import { cache } from 'react';
import { DESCRIPTION_PREVIEW_MAX } from '@/lib/cards-limits';
import { db } from '@/lib/db';
import type { BoardLabel } from '@/lib/labels';
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

export type BoardCardRow = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: Date;
  dueDate: Date | null;
  descriptionPreview: string | null;
  cardLabels: { labelId: string }[];
  attachments: { id: string }[];
};

export type BoardColumnRow = { id: string; name: string; rank: string; cards: BoardCardRow[] };
export type BoardWithCards = {
  id: string;
  name: string;
  labels: BoardLabel[];
  columns: BoardColumnRow[];
};

// The board layout and the board page both re-check access and both read the
// board, because CLAUDE.md requires every entry point to verify rather than
// trust a parent. React's cache collapses the duplicate call within a request.
export const getBoardWithColumns = cache(async (boardId: string): Promise<BoardWithCards | null> => {
  const board = await db.query.boards.findFirst({
    where: (b, { eq }) => eq(b.id, boardId),
    columns: { id: true, name: true },
    with: {
      columns: {
        columns: { id: true, name: true, rank: true },
        orderBy: (column, { asc }) => [asc(column.rank)],
        with: {
          cards: {
            columns: {
              id: true,
              columnId: true,
              title: true,
              rank: true,
              createdAt: true,
              dueDate: true,
            },
            // Cut in SQL, never selected whole: the card face shows two
            // clamped lines, and a description runs to 10,000 characters.
            // Selecting the column would put every one of them in the board's
            // RSC payload to render a hundred and forty.
            extras: (card, { sql }) => ({
              descriptionPreview: sql<
                string | null
              >`left(${card.description}, ${DESCRIPTION_PREVIEW_MAX})`.as('description_preview'),
            }),
            orderBy: (card, { asc }) => [asc(card.rank), asc(card.createdAt), asc(card.id)],
            with: {
              cardLabels: { columns: { labelId: true } },
              // Ids only: the card face shows a count, and pulling filenames
              // onto every card of a board would buy nothing that renders.
              // Pending rows are excluded — an upload that may never land must
              // not raise a count on somebody else's screen.
              attachments: {
                columns: { id: true },
                where: (row, { eq }) => eq(row.status, 'ready'),
              },
            },
          },
        },
      },
      labels: {
        columns: { id: true, name: true },
        // Same ordering as boardLabels in lib/labels.ts; see the note there.
        orderBy: (label, { asc, sql }) => [asc(sql`lower(${label.name})`)],
      },
    },
  });

  return board ?? null;
});
