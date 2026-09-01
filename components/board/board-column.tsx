'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState, type Ref } from 'react';

import { AddCard } from '@/components/board/add-card';
import { BoardCard } from '@/components/board/board-card';
import { ColumnMenu } from '@/components/board/column-menu';
import { DeleteColumnDialog } from '@/components/board/delete-column-dialog';
import type { StateCard, StateColumn } from '@/lib/board-state';
import { flowColor } from '@/lib/flow';

// Columns sit flush so the 3px rules meet edge to edge and read as one band
// across the board; the 12px gutter is inset padding instead, which keeps the
// card width at 300px without breaking the spectrum.
export function BoardColumn({
  ref,
  column,
  cards,
  rings,
  boardId,
  hue,
  nextHue,
  canWrite,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onAddCard,
  columns,
  onRenameCard,
  onDeleteCard,
  onMoveCardTo,
  isFirst,
  isLast,
  onRenameColumn,
  onAddColumnAfter,
  onMoveColumn,
  onDeleteColumn,
}: {
  ref?: Ref<HTMLElement>;
  column: StateColumn;
  cards: StateCard[];
  rings: Map<string, number>;
  boardId: string;
  hue: number;
  nextHue: number;
  canWrite: boolean;
  composerOpen: boolean;
  onOpenComposer: () => void;
  onCloseComposer: () => void;
  onAddCard: (title: string) => void;
  columns: StateColumn[];
  onRenameCard: (card: StateCard, title: string) => void;
  onDeleteCard: (card: StateCard) => void;
  onMoveCardTo: (card: StateCard, toColumnId: string) => void;
  isFirst: boolean;
  isLast: boolean;
  onRenameColumn: (column: StateColumn, name: string) => void;
  onAddColumnAfter: (column: StateColumn, name: string) => void;
  onMoveColumn: (column: StateColumn, direction: 'left' | 'right') => void;
  onDeleteColumn: ((column: StateColumn, targetColumnId: string) => void) | null;
}) {
  const [deleting, setDeleting] = useState(false);
  const { setNodeRef } = useDroppable({ id: column.id });

  // The left neighbour first, so it is the select's default; the first column
  // falls through to its right neighbour, which is the next in natural order.
  const index = columns.findIndex((c) => c.id === column.id);
  const left = columns[index - 1];
  const rest = columns.filter((c) => c.id !== column.id && c.id !== left?.id);
  const others = left ? [left, ...rest] : rest;
  return (
    <section
      ref={ref}
      data-column-id={column.id}
      className="flex h-full w-screen shrink-0 snap-start flex-col min-[700px]:w-[312px] min-[700px]:snap-align-none"
    >
      <div
        className="h-[3px] shrink-0"
        style={{ background: `linear-gradient(90deg, ${flowColor(hue)}, ${flowColor(nextHue)})` }}
      />
      {/* The droppable is the scrolling body, not the section, so the empty
          area below the last card is a drop target too. */}
      <div
        ref={setNodeRef}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4"
        style={{ background: `linear-gradient(${flowColor(hue, 0.06)}, transparent 80px)` }}
      >
        <div className="flex items-center gap-1 px-1.5 pt-3">
          <h2
            data-testid="column-name"
            className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-muted"
          >
            {column.name}
          </h2>
          {canWrite ? (
            <ColumnMenu
              column={column}
              isFirst={isFirst}
              isLast={isLast}
              onRename={(name) => onRenameColumn(column, name)}
              onAddAfter={(name) => onAddColumnAfter(column, name)}
              onMove={(direction) => onMoveColumn(column, direction)}
              onDelete={onDeleteColumn ? () => setDeleting(true) : null}
            />
          ) : null}
        </div>

        {cards.length === 0 ? (
          <p className="px-1.5 pt-6 text-sm text-muted">Nothing here yet</p>
        ) : (
          <SortableContext
            items={cards.map((card) => card.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-3 space-y-2 px-1.5">
              {cards.map((card) => (
                <li key={card.id}>
                  <BoardCard
                    card={card}
                    ringHue={rings.get(card.id)}
                    boardId={boardId}
                    canWrite={canWrite}
                    columns={columns}
                    onRename={(title) => onRenameCard(card, title)}
                    onDelete={() => onDeleteCard(card)}
                    onMoveTo={(toColumnId) => onMoveCardTo(card, toColumnId)}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        )}

        {canWrite ? (
          <div className="px-1.5">
            <AddCard
              columnName={column.name}
              open={composerOpen}
              onOpen={onOpenComposer}
              onClose={onCloseComposer}
              onSubmit={onAddCard}
            />
          </div>
        ) : null}
      </div>

      {onDeleteColumn ? (
        <DeleteColumnDialog
          column={column}
          others={others}
          open={deleting}
          onOpenChange={setDeleting}
          onConfirm={(targetColumnId) => onDeleteColumn(column, targetColumnId)}
        />
      ) : null}
    </section>
  );
}
