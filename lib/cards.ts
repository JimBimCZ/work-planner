import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { boardLabels, type BoardLabel } from '@/lib/labels';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

export type CardComment = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string | null; image: string | null } | null;
};

export type Viewer = { id: string; name: string | null };

export type CardForView = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  labelIds: string[];
  comments: CardComment[];
};

// Both the intercepted slot and the canonical page read the card and both
// re-check access, because CLAUDE.md requires every entry point to verify
// rather than trust a parent. React's cache collapses the duplicate call.
export const getCardForView = cache(async (cardId: string): Promise<CardForView | null> => {
  const card = await db.query.cards.findFirst({
    where: (c, { eq }) => eq(c.id, cardId),
    columns: {
      id: true,
      boardId: true,
      columnId: true,
      title: true,
      description: true,
      dueDate: true,
    },
    with: {
      comments: {
        columns: { id: true, body: true, createdAt: true },
        orderBy: (comment, { asc }) => [asc(comment.createdAt), asc(comment.id)],
        with: { author: { columns: { id: true, name: true, image: true } } },
      },
      cardLabels: { columns: { labelId: true } },
    },
  });

  if (!card) return null;

  const { cardLabels, ...rest } = card;
  return { ...rest, labelIds: cardLabels.map((assignment) => assignment.labelId) };
});

// Both the intercepted slot and the canonical page need the same session
// check, mismatch guard and access check, and both must keep re-checking
// independently rather than trust a parent — CLAUDE.md requires that of
// every route. Sharing this function satisfies both: each call site still
// runs the full check itself, and the two stay in lockstep as Task 10 grows
// this block. `redirect` and `notFound` throw, so calling them from here
// propagates exactly as it would inline in the page.
export async function getCardForRoute(
  boardId: string,
  cardId: string,
): Promise<{
  card: CardForView;
  labels: BoardLabel[];
  canWrite: boolean;
  viewer: Viewer;
}> {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const card = await getCardForView(cardId);
  // The URL carries both ids; a card that is not on this board is not found
  // here, whatever the caller can see elsewhere.
  if (!card || card.boardId !== boardId) notFound();

  let role;
  try {
    role = await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  return {
    card,
    // The board's whole set, so the picker can offer every label rather than
    // only the ones already on this card.
    labels: await boardLabels(card.boardId),
    canWrite: atLeast(role, 'member'),
    viewer: {
      id: session.user.id,
      name: session.user.name ?? null,
    },
  };
}
