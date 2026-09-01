import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { boards } from '@/lib/db/schema';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function boardIdForCard(cardId: string): Promise<string | null> {
  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, cardId),
    columns: { boardId: true },
  });
  return card?.boardId ?? null;
}

export async function boardIdForColumn(columnId: string): Promise<string | null> {
  const column = await db.query.columns.findFirst({
    where: (c, { eq: is }) => is(c.id, columnId),
    columns: { boardId: true },
  });
  return column?.boardId ?? null;
}

// Every card and column write bumps the board so /boards orders by activity
// rather than by "last renamed". $onUpdate would fire on any set; the explicit
// value keeps the intent readable in the one place it matters.
export async function touchBoard(tx: Tx, boardId: string): Promise<void> {
  await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
}

// card.updated carries the card's whole small surface, not just the field that
// changed, so a client can apply it without asking a second question. The
// description is deliberately absent: it cannot fit in a payload.
export async function cardEventScope(
  cardId: string,
): Promise<{ boardId: string; title: string; dueDate: Date | null } | null> {
  const card = await db.query.cards.findFirst({
    where: (c, { eq: is }) => is(c.id, cardId),
    columns: { boardId: true, title: true, dueDate: true },
  });
  return card ?? null;
}

// One query for both facts an author-only check needs. The board answers "may
// you be here", the author answers "is it yours", and they are asked in that
// order.
export async function commentScope(
  commentId: string,
): Promise<{ boardId: string; cardId: string; authorId: string | null } | null> {
  const comment = await db.query.comments.findFirst({
    where: (c, { eq: is }) => is(c.id, commentId),
    columns: { authorId: true, cardId: true },
    with: { card: { columns: { boardId: true } } },
  });

  return comment
    ? { boardId: comment.card.boardId, cardId: comment.cardId, authorId: comment.authorId }
    : null;
}
