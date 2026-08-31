'use client';

import { useReducer } from 'react';

import { BoardColumn } from '@/components/board/board-column';
import { boardReducer, cardsIn, orderedColumns, type BoardState } from '@/lib/board-state';
import type { BoardWithCards } from '@/lib/boards';
import { flowHue } from '@/lib/flow';

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
  const [state] = useReducer(boardReducer, board, seed);

  const columns = orderedColumns(state);
  const total = columns.length;

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
          />
        ))}
      </div>
    </main>
  );
}
