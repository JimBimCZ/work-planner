'use client';

import { useEffect, useReducer, useState, useTransition } from 'react';

import { BoardColumn } from '@/components/board/board-column';
import { useBoardActions } from '@/components/board/board-actions';
import { createCard } from '@/lib/actions/cards';
import { boardReducer, cardsIn, orderedColumns, type BoardState } from '@/lib/board-state';
import type { BoardWithCards } from '@/lib/boards';
import { flowHue } from '@/lib/flow';
import { ranksAfter } from '@/lib/rank';

// Seeded once, on mount. There is no realtime in this sub-project, so the
// reducer is the truth for the session and a reload is what re-reads the server.
function seed(board: BoardWithCards): BoardState {
  return {
    columns: board.columns.map(({ id, name, rank }) => ({ id, name, rank })),
    cards: board.columns.flatMap((column) =>
      column.cards.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        title: card.title,
        rank: card.rank,
        createdAt: card.createdAt.toISOString(),
      })),
    ),
  };
}

export function BoardCanvas({ board, canWrite }: { board: BoardWithCards; canWrite: boolean }) {
  const [state, dispatch] = useReducer(boardReducer, board, seed);
  const [composerIn, setComposerIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { register } = useBoardActions();

  const columns = orderedColumns(state);
  const total = columns.length;
  const firstColumnId = columns[0]?.id ?? null;

  useEffect(() => {
    register(canWrite && firstColumnId ? () => setComposerIn(firstColumnId) : null);
    return () => register(null);
  }, [register, canWrite, firstColumnId]);

  // Not memoised: the optimistic rank is read from `state` in the render
  // closure, so a run of cards appended without waiting for the server still
  // ranks in the order typed. A stale closure would give them all one rank.
  function addCard(columnId: string, title: string) {
    const tempId = `tmp-${crypto.randomUUID()}`;
    const last = cardsIn(state, columnId).at(-1);

    dispatch({
      type: 'card.create',
      card: {
        id: tempId,
        columnId,
        title,
        rank: ranksAfter(last?.rank ?? null, 1)[0],
        createdAt: new Date().toISOString(),
        pending: true,
      },
    });
    setError(null);

    startTransition(async () => {
      const result = await createCard({ columnId, title });
      if (!result.ok) {
        dispatch({ type: 'card.delete', cardId: tempId });
        setError('That card could not be added. Try again.');
        return;
      }
      dispatch({ type: 'card.settle', tempId, id: result.data.id, rank: result.data.rank });
    });
  }

  return (
    <main className="h-full overflow-x-auto">
      <div className="flex h-full min-w-max">
        {columns.map((column, index) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={cardsIn(state, column.id)}
            hue={flowHue(index, total)}
            nextHue={flowHue(Math.min(index + 1, total - 1), total)}
            canWrite={canWrite}
            composerOpen={composerIn === column.id}
            onOpenComposer={() => setComposerIn(column.id)}
            onCloseComposer={() => setComposerIn(null)}
            onAddCard={(title) => addCard(column.id, title)}
          />
        ))}
      </div>

      <p
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 text-sm text-time-over"
      >
        {error}
      </p>
    </main>
  );
}
