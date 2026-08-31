'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StateCard } from '@/lib/board-state';

export function CardMenu({
  card,
  columns,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  columns: { id: string; name: string }[];
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  const [title, setTitle] = useState(card.title);

  return (
    <>
      <DropdownMenu>
        {/* Chrome recedes: the trigger is invisible until the card is hovered
            or it takes keyboard focus, but it still holds a 24px target. */}
        <DropdownMenuTrigger
          aria-label={`Card actions for ${card.title}`}
          disabled={card.pending}
          // The trigger sits inside a draggable, so without this the pointer
          // sensor swallows the press and the menu never opens.
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted opacity-0 hover:bg-ink/10 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {columns
                .filter((column) => column.id !== card.columnId)
                .map((column) => (
                  <DropdownMenuItem key={column.id} onSelect={() => onMoveTo(column.id)}>
                    {column.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Rename card</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = title.trim();
              if (next.length === 0) return;
              onRename(next);
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`rename-card-${card.id}`}>
              Card title
            </label>
            <input
              id={`rename-card-${card.id}`}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Save changes
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* A board is a container of everything, so deleting one is guarded by a
          typed name. One card is not, so a plain confirm is the right weight. */}
      <Dialog open={open === 'delete'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Delete {card.title}</DialogTitle>
          <p className="mt-2 text-sm text-muted">This removes the card. It cannot be undone.</p>
          <button
            type="button"
            onClick={() => {
              onDelete();
              setOpen(null);
            }}
            className="mt-4 rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
          >
            Delete card
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
