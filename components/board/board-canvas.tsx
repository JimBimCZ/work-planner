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
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

import { BoardColumn } from '@/components/board/board-column';
import { CardFace } from '@/components/board/board-card';
import { ColumnSwitcher } from '@/components/board/column-switcher';
import { useBoardActions } from '@/components/board/board-actions';
import { useRealtime } from '@/components/board/realtime';
import { readBoard } from '@/lib/actions/board';
import { createCard, deleteCard, moveCard, renameCard } from '@/lib/actions/cards';
import { addColumn, deleteColumn, moveColumn, renameColumn } from '@/lib/actions/columns';
import { attempt } from '@/lib/attempt';
import { avatarHue } from '@/lib/avatar';
import {
  boardReducer,
  cardsIn,
  dropTarget,
  inverse,
  orderedColumns,
  matchesFilter,
  parseLabelFilter,
  sameDropTarget,
  toBoardState,
  type BoardAction,
  type DropTarget,
  type StateCard,
  type StateColumn,
} from '@/lib/board-state';
import type { BoardWithCards } from '@/lib/boards';
import { flowColor, flowHue } from '@/lib/flow';
import { rankBetween, ranksAfter } from '@/lib/rank';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function BoardCanvas({ board, canWrite }: { board: BoardWithCards; canWrite: boolean }) {
  const [state, dispatch] = useReducer(boardReducer, board, toBoardState);
  const [composerIn, setComposerIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const columnRefs = useRef(new Map<string, HTMLElement>());
  // Ephemeral UI, so deliberately not in the reducer: lib/board-state.ts is
  // pure and heavily tested, and a ring that expires on a timer is neither.
  const [rings, setRings] = useState<Map<string, number>>(new Map());
  const { register, registerPatchCard, registerLabelCounts, registerLabels, registerDispatchLabel } =
    useBoardActions();
  // The filter lives in the URL, not in the reducer: it has to survive a
  // reload and a board.reseed, which replaces the reducer wholesale.
  const searchParams = useSearchParams();
  const filter = parseLabelFilter(searchParams, state.labels);
  const filtering = filter.length > 0;
  const { subscribe: subscribeRealtime, claim, reconnected } = useRealtime();
  const catchUpWanted = useRef(false);

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
    registerPatchCard((cardId, patch) => dispatch({ type: 'card.patch', cardId, ...patch }));
    return () => registerPatchCard(null);
  }, [registerPatchCard]);

  // The filter popover lives in the layout's top bar, above this tree, and the
  // count beside a label has to agree with the cards on screen — so it is
  // counted from the same state that renders them rather than queried.
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of state.cards) {
      for (const labelId of card.labelIds) counts[labelId] = (counts[labelId] ?? 0) + 1;
    }
    return counts;
  }, [state.cards]);

  useEffect(() => {
    registerLabelCounts(labelCounts);
  }, [registerLabelCounts, labelCounts]);

  // The popover renders the same set the board filters against, so the two can
  // never disagree about which labels exist — a remote delete removes the row
  // as well as the label line.
  useEffect(() => {
    registerLabels(state.labels);
  }, [registerLabels, state.labels]);

  // The popover and the card modal both sit above this reducer in the tree, and
  // it is the only thing that decides which cards are on screen. Without this,
  // a label the user just created, renamed, deleted or applied is one this
  // board has never heard of until a reload.
  useEffect(() => {
    registerDispatchLabel((action) => dispatch(action));
    return () => registerDispatchLabel(null);
  }, [registerDispatchLabel]);

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
  // no second state tree, and no second set of rules about ordering. Events
  // this client caused never arrive here — the provider filters them by
  // mutationId.
  useEffect(
    () =>
      subscribeRealtime((event) => {
        // A quiet acknowledgement that something moved and who moved it.
        // card.deleted gets none — the card is gone, so there is nothing to
        // ring. The attachment events name the attachment in `id` and the card
        // in `cardId`, and it is the card whose face changed.
        const ringed =
          event.type === 'card.created' ||
          event.type === 'card.updated' ||
          event.type === 'card.moved'
            ? event.id
            : event.type === 'attachment.added' || event.type === 'attachment.removed'
              ? event.cardId
              : null;

        if (ringed) {
          const hue = avatarHue(event.actorId);
          setRings((current) => new Map(current).set(ringed, hue));
          window.setTimeout(
            () =>
              setRings((current) => {
                const next = new Map(current);
                next.delete(ringed);
                return next;
              }),
            1_500,
          );
        }

        switch (event.type) {
          case 'card.created':
            dispatch({
              type: 'card.create',
              card: {
                id: event.id,
                columnId: event.columnId,
                title: event.title,
                rank: event.rank,
                createdAt: event.createdAt,
                dueDate: event.dueDate,
                labelIds: [],
                attachmentCount: 0,
              },
            });
            return;
          case 'card.updated':
            // The card face shows a title and a due date and nothing else, so
            // descriptionChanged is not its business — that is the open card's.
            dispatch({
              type: 'card.patch',
              cardId: event.id,
              title: event.title,
              dueDate: event.dueDate,
            });
            return;
          case 'card.moved':
            dispatch({
              type: 'card.move',
              cardId: event.id,
              toColumnId: event.columnId,
              rank: event.rank,
            });
            return;
          case 'card.deleted':
            dispatch({ type: 'card.delete', cardId: event.id });
            return;
          case 'column.created':
            dispatch({
              type: 'column.create',
              column: { id: event.id, name: event.name, rank: event.rank },
            });
            return;
          case 'column.updated':
            dispatch({ type: 'column.rename', columnId: event.id, name: event.name });
            return;
          case 'column.moved':
            dispatch({ type: 'column.move', columnId: event.id, rank: event.rank });
            return;
          case 'column.deleted':
            dispatch({
              type: 'column.delete',
              columnId: event.id,
              targetColumnId: event.targetColumnId,
              moves: event.cards.map(({ id, rank }) => ({ id, rank })),
            });
            return;
          case 'label.created':
            dispatch({ type: 'label.create', label: { id: event.id, name: event.name } });
            return;
          case 'label.updated':
            dispatch({ type: 'label.rename', labelId: event.id, name: event.name });
            return;
          case 'label.deleted':
            dispatch({ type: 'label.delete', labelId: event.id });
            return;
          case 'card.labelled':
            dispatch({ type: 'card.labels', cardId: event.id, labelIds: event.labelIds });
            return;
          case 'attachment.added':
            dispatch({ type: 'attachment.add', cardId: event.cardId });
            return;
          case 'attachment.removed':
            dispatch({ type: 'attachment.remove', cardId: event.cardId });
            return;
          default:
            // Comment events belong to the open card, not the canvas.
            return;
        }
      }),
    [subscribeRealtime],
  );

  useEffect(() => {
    if (reconnected === 0) return;
    catchUpWanted.current = true;
  }, [reconnected]);

  // Deferred while a drag or a write is in flight. Reseeding mid-gesture would
  // erase an optimistic change the server has not been told about yet; once the
  // write settles, the server's own read already contains it.
  useEffect(() => {
    if (!catchUpWanted.current) return;
    if (draggingId || isPending) return;
    catchUpWanted.current = false;

    let cancelled = false;
    void attempt(() => readBoard({ boardId: board.id })).then((result) => {
      if (cancelled) return;
      if (result.ok) dispatch({ type: 'board.reseed', state: result.data });
      // A failed catch-up leaves the board stale, so it stays wanted rather
      // than being dropped until the next reconnection.
      else catchUpWanted.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [reconnected, draggingId, isPending, board.id]);

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
        labelIds: [],
        attachmentCount: 0,
        pending: true,
      },
    });
    setError(null);

    startTransition(async () => {
      const result = await attempt(() => createCard({ columnId, title, mutationId: claim() }));
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
      const result = await attempt(call);
      if (!result.ok) {
        for (const step of undo) dispatch(step);
        setError(message);
      }
    });
  }

  const renameCardTo = (card: StateCard, title: string) =>
    run(
      { type: 'card.rename', cardId: card.id, title },
      () => renameCard({ cardId: card.id, title, mutationId: claim() }),
      'That card could not be renamed. Try again.',
    );

  const removeCard = (card: StateCard) =>
    run(
      { type: 'card.delete', cardId: card.id },
      () => deleteCard({ cardId: card.id, mutationId: claim() }),
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
          mutationId: claim(),
        }),
      'That card could not be moved. Try again.',
    );
  };

  const renameColumnTo = (column: StateColumn, name: string) =>
    run(
      { type: 'column.rename', columnId: column.id, name },
      () => renameColumn({ columnId: column.id, name, mutationId: claim() }),
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
          mutationId: claim(),
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
      const result = await attempt(() =>
        addColumn({
          boardId: board.id,
          name,
          afterColumnId: column.id,
          mutationId: claim(),
        }),
      );
      if (!result.ok) {
        dispatch({ type: 'column.delete', columnId: tempId, targetColumnId: null, moves: [] });
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
    const ranks = ranksAfter(last?.rank ?? null, moving.length);

    return run(
      {
        type: 'column.delete',
        columnId: column.id,
        targetColumnId,
        moves: moving.map((card, position) => ({ id: card.id, rank: ranks[position] })),
      },
      () => deleteColumn({ columnId: column.id, targetColumnId, mutationId: claim() }),
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

  // onDragOver fires when the droppable under the pointer changes, not every
  // frame. Different `over` ids often mean the same target (a column's own id
  // and its last card both mean "after the last card"), so the guard still
  // earns its place — every write here re-renders every column.
  function onDragOver({ active, over }: DragOverEvent) {
    const next = over ? dropTarget(state, String(active.id), String(over.id)) : null;
    setTarget((current) => (sameDropTarget(current, next) ? current : next));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    setTarget(null);
    if (!over || !canWrite) return;

    const landing = dropTarget(state, String(active.id), String(over.id));
    if (!landing) return;

    const before = landing.beforeCardId
      ? state.cards.find((card) => card.id === landing.beforeCardId)
      : null;
    const after = landing.afterCardId
      ? state.cards.find((card) => card.id === landing.afterCardId)
      : null;

    run(
      {
        type: 'card.move',
        cardId: String(active.id),
        toColumnId: landing.toColumnId,
        rank: rankBetween(before?.rank ?? null, after?.rank ?? null),
      },
      () => moveCard({ cardId: String(active.id), ...landing, mutationId: claim() }),
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
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDraggingId(null);
          setTarget(null);
        }}
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
                cards={cardsIn(state, column.id).filter((card) => matchesFilter(card, filter))}
                filtering={filtering}
                rings={rings}
                boardId={board.id}
                hue={flowHue(index, total)}
                nextHue={flowHue(Math.min(index + 1, total - 1), total)}
                canWrite={canWrite}
                composerOpen={composerIn === column.id}
                onOpenComposer={() => setComposerIn(column.id)}
                onCloseComposer={() => setComposerIn(null)}
                onAddCard={(title) => addCard(column.id, title)}
                columns={columns}
                labels={state.labels}
                dropIndicator={target?.toColumnId === column.id ? target : null}
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
            // DragOverlay's own wrapper is already sized from the dragged
            // node's measured rect, so the face fills it rather than carrying a
            // width of its own. A literal here was only ever right at one
            // viewport: below 700px the column fills the screen.
            <article
              aria-hidden
              data-testid="drag-overlay"
              className="w-full rounded-[var(--radius-card)] border bg-surface p-3.5 shadow-[0_20px_34px_-10px_rgb(0_0_0/0.75)]"
              style={{
                // The hue of the column it came from, so a card in flight
                // carries its origin rather than borrowing the one under it.
                borderColor: flowColor(
                  flowHue(
                    Math.max(
                      0,
                      columns.findIndex((column) => column.id === dragging.columnId),
                    ),
                    total,
                  ),
                ),
                transform: reducedMotion ? undefined : 'scale(1.02) rotate(3deg)',
              }}
            >
              <CardFace card={dragging} labels={state.labels} />
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
