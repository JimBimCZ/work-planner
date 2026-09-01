'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

import { BoardColumn } from '@/components/board/board-column';
import { ColumnSwitcher } from '@/components/board/column-switcher';
import { useBoardActions } from '@/components/board/board-actions';
import { useRealtime } from '@/components/board/realtime';
import { createCard, deleteCard, moveCard, renameCard } from '@/lib/actions/cards';
import { addColumn, deleteColumn, moveColumn, renameColumn } from '@/lib/actions/columns';
import {
  boardReducer,
  cardsIn,
  dropTarget,
  inverse,
  orderedColumns,
  type BoardAction,
  type BoardState,
  type StateCard,
  type StateColumn,
} from '@/lib/board-state';
import type { BoardWithCards } from '@/lib/boards';
import { toDateInputValue } from '@/lib/due';
import { flowHue } from '@/lib/flow';
import { rankBetween, ranksAfter } from '@/lib/rank';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

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
        dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
      })),
    ),
  };
}

export function BoardCanvas({ board, canWrite }: { board: BoardWithCards; canWrite: boolean }) {
  const [state, dispatch] = useReducer(boardReducer, board, seed);
  const [composerIn, setComposerIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const columnRefs = useRef(new Map<string, HTMLElement>());
  const { register, registerPatchCard } = useBoardActions();
  const { subscribe: subscribeRealtime } = useRealtime();

  const reducedMotion = useSyncExternalStore(
    subscribe,
    useCallback(() => window.matchMedia(REDUCED).matches, []),
    // The server cannot know the preference; assume motion and let the client
    // correct on hydration rather than render the reduced path to everyone.
    useCallback(() => false, []),
  );

  const columns = orderedColumns(state);
  const total = columns.length;
  const firstColumnId = columns[0]?.id ?? null;
  const dragging = draggingId ? (state.cards.find((card) => card.id === draggingId) ?? null) : null;

  useEffect(() => {
    register(canWrite && firstColumnId ? () => setComposerIn(firstColumnId) : null);
    return () => register(null);
  }, [register, canWrite, firstColumnId]);

  // The modal is a sibling slot, not a child, so this context is the only place
  // the two trees meet. On the canonical card page nothing registers, and the
  // modal simply finds null.
  useEffect(() => {
    registerPatchCard((cardId, patch) => {
      if (patch.title !== undefined) dispatch({ type: 'card.rename', cardId, title: patch.title });
      if (patch.dueDate !== undefined) {
        dispatch({ type: 'card.setDueDate', cardId, dueDate: patch.dueDate });
      }
    });
    return () => registerPatchCard(null);
  }, [registerPatchCard]);

  // Below 700px one column fills the screen, so the tab has to follow a swipe
  // as well as a click. A callback only carries the columns whose visibility
  // changed, so the ratios are kept across calls and the largest one wins:
  // crossing the breakpoint back down reports only the columns that left, and
  // reading those alone would leave the tab on a column nobody can see.
  useEffect(() => {
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-column-id');
          if (id) ratios.set(id, entry.intersectionRatio);
        }

        const [onScreen] = [...ratios].sort(([, a], [, b]) => b - a);
        if (onScreen && onScreen[1] > 0) setActiveColumnId(onScreen[0]);
      },
      { threshold: [0.6, 1] },
    );

    for (const element of columnRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [total]);

  // Remote events take the same reducer path a local mutation does. There is
  // no second state tree, and no second set of rules about ordering.
  useEffect(
    () =>
      subscribeRealtime((event) => {
        if (event.type === 'card.moved') {
          dispatch({
            type: 'card.move',
            cardId: event.id,
            toColumnId: event.columnId,
            rank: event.rank,
          });
        }
      }),
    [subscribeRealtime],
  );

  const showColumn = (columnId: string) =>
    columnRefs.current.get(columnId)?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      inline: 'start',
      block: 'nearest',
    });

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
        dueDate: null,
        pending: true,
      },
    });
    setError(null);

    startTransition(async () => {
      const result = await createCard({ columnId, title, mutationId: crypto.randomUUID() });
      if (!result.ok) {
        dispatch({ type: 'card.delete', cardId: tempId });
        setError('That card could not be added. Try again.');
        return;
      }
      dispatch({ type: 'card.settle', tempId, id: result.data.id, rank: result.data.rank });
    });
  }

  // Every mutation but create follows one shape: compute the inverse from the
  // pre-state, apply optimistically, and replay the inverse if the server says
  // no. The inverse rather than a snapshot is what keeps a failed request from
  // also undoing whatever landed while it was in flight.
  function run(action: BoardAction, call: () => Promise<{ ok: boolean }>, message: string) {
    const undo = inverse(state, action);
    dispatch(action);
    setError(null);

    startTransition(async () => {
      const result = await call();
      if (!result.ok) {
        for (const step of undo) dispatch(step);
        setError(message);
      }
    });
  }

  const renameCardTo = (card: StateCard, title: string) =>
    run(
      { type: 'card.rename', cardId: card.id, title },
      () => renameCard({ cardId: card.id, title, mutationId: crypto.randomUUID() }),
      'That card could not be renamed. Try again.',
    );

  const removeCard = (card: StateCard) =>
    run(
      { type: 'card.delete', cardId: card.id },
      () => deleteCard({ cardId: card.id, mutationId: crypto.randomUUID() }),
      'That card could not be deleted. Try again.',
    );

  // The optimistic rank and the server's are computed independently and usually
  // differ. Both sit strictly between the same two neighbours, so the order is
  // identical and the next reload takes the server's value. Only the ordering
  // is a contract; the string is not.
  const moveCardTo = (card: StateCard, toColumnId: string) => {
    const last = cardsIn(state, toColumnId).at(-1);
    return run(
      { type: 'card.move', cardId: card.id, toColumnId, rank: ranksAfter(last?.rank ?? null, 1)[0] },
      () =>
        moveCard({
          cardId: card.id,
          toColumnId,
          beforeCardId: last?.id ?? null,
          afterCardId: null,
          mutationId: crypto.randomUUID(),
        }),
      'That card could not be moved. Try again.',
    );
  };

  const renameColumnTo = (column: StateColumn, name: string) =>
    run(
      { type: 'column.rename', columnId: column.id, name },
      () => renameColumn({ columnId: column.id, name, mutationId: crypto.randomUUID() }),
      'That column could not be renamed. Try again.',
    );

  // The menu says a direction; the canvas turns it into the neighbour pair the
  // action wants. A direction never reaches the server — it is an index in
  // disguise, and an index is stale the moment someone else moves something.
  const moveColumnBy = (column: StateColumn, direction: 'left' | 'right') => {
    const index = columns.findIndex((c) => c.id === column.id);
    const [before, after] =
      direction === 'left'
        ? [columns[index - 2] ?? null, columns[index - 1] ?? null]
        : [columns[index + 1] ?? null, columns[index + 2] ?? null];

    if (!after && !before) return;

    return run(
      {
        type: 'column.move',
        columnId: column.id,
        rank: rankBetween(before?.rank ?? null, after?.rank ?? null),
      },
      () =>
        moveColumn({
          columnId: column.id,
          beforeColumnId: before?.id ?? null,
          afterColumnId: after?.id ?? null,
          mutationId: crypto.randomUUID(),
        }),
      'That column could not be moved. Try again.',
    );
  };

  const addColumnAfter = (column: StateColumn, name: string) => {
    const index = columns.findIndex((c) => c.id === column.id);
    const tempId = `tmp-${crypto.randomUUID()}`;
    const rank = rankBetween(column.rank, columns[index + 1]?.rank ?? null);

    dispatch({ type: 'column.create', column: { id: tempId, name, rank, pending: true } });
    setError(null);

    startTransition(async () => {
      const result = await addColumn({
        boardId: board.id,
        name,
        afterColumnId: column.id,
        mutationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        dispatch({ type: 'column.delete', columnId: tempId, targetColumnId: null, ranks: [] });
        setError('That column could not be added. Try again.');
        return;
      }
      dispatch({ type: 'column.settle', tempId, id: result.data.id, rank: result.data.rank });
    });
  };

  // The inverse of column.delete restores the column and moves every card back,
  // which the reducer already implements, so rollback needs nothing extra here.
  const removeColumn = (column: StateColumn, targetColumnId: string) => {
    const moving = cardsIn(state, column.id);
    const last = cardsIn(state, targetColumnId).at(-1);

    return run(
      {
        type: 'column.delete',
        columnId: column.id,
        targetColumnId,
        ranks: ranksAfter(last?.rank ?? null, moving.length),
      },
      () => deleteColumn({ columnId: column.id, targetColumnId, mutationId: crypto.randomUUID() }),
      'That column could not be deleted. Try again.',
    );
  };

  const sensors = useSensors(
    // ~5px so a click still reaches the card body, which sub-project 5 uses to
    // open the modal. Below that a click becomes a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart({ active }: DragStartEvent) {
    setDraggingId(String(active.id));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    if (!over || !canWrite) return;

    const target = dropTarget(state, String(active.id), String(over.id));
    if (!target) return;

    const before = target.beforeCardId
      ? state.cards.find((card) => card.id === target.beforeCardId)
      : null;
    const after = target.afterCardId
      ? state.cards.find((card) => card.id === target.afterCardId)
      : null;

    run(
      {
        type: 'card.move',
        cardId: String(active.id),
        toColumnId: target.toColumnId,
        rank: rankBetween(before?.rank ?? null, after?.rank ?? null),
      },
      () => moveCard({ cardId: String(active.id), ...target, mutationId: crypto.randomUUID() }),
      'That card could not be moved. Try again.',
    );
  }

  return (
    <main className="flex h-full flex-col">
      <ColumnSwitcher columns={columns} activeId={activeColumnId} onSelect={showColumn} />
      {/* dnd-kit names the drag instructions with a module-level counter unless
          it is given an id. That counter lives in the server process and climbs
          with every render, so the id it ships stops matching the one the client
          generates, and aria-describedby is left pointing at nothing. */}
      <DndContext
        id="board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        {/* Snapping belongs on the element that scrolls, so the switcher sits
            outside it rather than scrolling away with the columns. */}
        <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto min-[700px]:snap-none">
          <div className="flex h-full min-w-max">
            {columns.map((column, index) => (
              <BoardColumn
                key={column.id}
                ref={(element) => {
                  if (element) columnRefs.current.set(column.id, element);
                  else columnRefs.current.delete(column.id);
                }}
                column={column}
                cards={cardsIn(state, column.id)}
                boardId={board.id}
                hue={flowHue(index, total)}
                nextHue={flowHue(Math.min(index + 1, total - 1), total)}
                canWrite={canWrite}
                composerOpen={composerIn === column.id}
                onOpenComposer={() => setComposerIn(column.id)}
                onCloseComposer={() => setComposerIn(null)}
                onAddCard={(title) => addCard(column.id, title)}
                columns={columns}
                onRenameCard={renameCardTo}
                onDeleteCard={removeCard}
                onMoveCardTo={moveCardTo}
                isFirst={index === 0}
                isLast={index === total - 1}
                onRenameColumn={renameColumnTo}
                onAddColumnAfter={addColumnAfter}
                onMoveColumn={moveColumnBy}
                onDeleteColumn={total > 1 ? removeColumn : null}
              />
            ))}
          </div>
        </div>

        {/* useSortable only translates a card within its own SortableContext, so
            a card dragged to another column would sit still while the pointer
            left it behind. The overlay is what actually follows the cursor, and
            so it is where the brief's shadow, scale and tilt belong. */}
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <article
              aria-hidden
              className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[0_12px_24px_-8px_rgb(0_0_0/0.35)]"
              style={{
                width: 288,
                transform: reducedMotion ? undefined : 'scale(1.02) rotate(3deg)',
              }}
            >
              <h3 className="text-sm font-medium leading-5 text-ink">{dragging.title}</h3>
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p
        data-testid="board-status"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 text-sm text-time-over"
      >
        {error}
      </p>
    </main>
  );
}
