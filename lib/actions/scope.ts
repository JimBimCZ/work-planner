import { eq, sql } from 'drizzle-orm';

import type { ActivityType } from '@/lib/activity';
import { ACTIVITY_PER_BOARD, ACTIVITY_SUBJECT_MAX } from '@/lib/activity-limits';
import { db } from '@/lib/db';
import { activity, boards } from '@/lib/db/schema';

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

// Written inside the transaction, unlike publish, and for the opposite reason:
// an event announces something that already happened, while an entry is part
// of what happened. A failing entry rolls the mutation back, which is the
// trade a record has to make to be one.
export async function recordActivity(
  tx: Tx,
  entry: {
    boardId: string;
    actorId: string;
    type: ActivityType;
    subjectId?: string | null;
    subject?: string | null;
    detail?: string | null;
  },
): Promise<void> {
  await tx.insert(activity).values({
    boardId: entry.boardId,
    actorId: entry.actorId,
    type: entry.type,
    subjectId: entry.subjectId ?? null,
    subject: entry.subject?.slice(0, ACTIVITY_SUBJECT_MAX) ?? null,
    detail: entry.detail ?? null,
  });

  // Vercel rules out a scheduled job, so the trim rides the write. Expressed
  // as one sql fragment rather than a builder subquery on purpose: the action
  // tests' fake transaction ignores the argument to where(), and a subquery
  // built through db.select() would execute against that fake instead.
  await tx.delete(activity).where(
    sql`${activity.boardId} = ${entry.boardId} and ${activity.id} not in (
      select ${activity.id} from ${activity}
      where ${activity.boardId} = ${entry.boardId}
      order by ${activity.createdAt} desc, ${activity.id} desc
      limit ${ACTIVITY_PER_BOARD}
    )`,
  );
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
