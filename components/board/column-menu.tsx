'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StateColumn } from '@/lib/board-state';

export function ColumnMenu({
  column,
  isFirst,
  isLast,
  onRename,
  onAddAfter,
  onMove,
  onDelete,
}: {
  column: StateColumn;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onAddAfter: (name: string) => void;
  onMove: (direction: 'left' | 'right') => void;
  // Null hides the item outright, which is how a board with a single column
  // and a task that has not wired deletion yet both say "not offered".
  onDelete: (() => void) | null;
}) {
  const [open, setOpen] = useState<'rename' | 'add' | null>(null);
  const [name, setName] = useState(column.name);
  const [added, setAdded] = useState('');

  return (
    <>
      <DropdownMenu>
        {/* Unlike the card menu this stays visible: there are a handful of
            columns, not dozens of cards, and hiding the only way to manage one
            behind hover would make it undiscoverable. */}
        <DropdownMenuTrigger
          aria-label={`Column actions for ${column.name}`}
          disabled={column.pending}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-ink/10 hover:text-ink disabled:hidden"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={() => onMove('left')}>
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={() => onMove('right')}>
            Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen('add')}>Add column right</DropdownMenuItem>
          {/* The server refuses the last column, but a control that can only
              fail should not be offered at all. */}
          {onDelete ? (
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Rename column</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (next.length === 0) return;
              onRename(next);
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`rename-column-${column.id}`}>
              Column name
            </label>
            <input
              id={`rename-column-${column.id}`}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
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

      <Dialog open={open === 'add'} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
        <DialogContent>
          <DialogTitle>Add column</DialogTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = added.trim();
              if (next.length === 0) return;
              onAddAfter(next);
              setAdded('');
              setOpen(null);
            }}
          >
            <label className="block text-sm text-muted" htmlFor={`add-column-${column.id}`}>
              Column name
            </label>
            <input
              id={`add-column-${column.id}`}
              value={added}
              maxLength={60}
              onChange={(event) => setAdded(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Add column
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
