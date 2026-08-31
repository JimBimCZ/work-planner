'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { StateColumn } from '@/lib/board-state';

// The dialog asks even when the column is empty. One that sometimes appears is
// worse than one that always does; the answer is simply unused.
export function DeleteColumnDialog({
  column,
  others,
  open,
  onOpenChange,
  onConfirm,
}: {
  column: StateColumn;
  others: StateColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetColumnId: string) => void;
}) {
  const [target, setTarget] = useState(others[0]?.id ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete {column.name}</DialogTitle>
        <p className="mt-2 text-sm text-muted">
          Its cards move to another column. Deleting the column cannot be undone.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!target) return;
            onConfirm(target);
            onOpenChange(false);
          }}
        >
          <label className="block text-sm text-muted" htmlFor={`target-${column.id}`}>
            Move its cards to
          </label>
          <select
            id={`target-${column.id}`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
          >
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
          >
            Delete column
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
