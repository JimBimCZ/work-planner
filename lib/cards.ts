import { cache } from 'react';

import { db } from '@/lib/db';

export type CardComment = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string | null; image: string | null } | null;
};

export type CardForView = {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
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
    },
  });

  return card ?? null;
});
