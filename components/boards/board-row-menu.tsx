'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteBoard, renameBoard } from '@/lib/actions/boards';
import type { BoardSummary } from '@/lib/boards';

export function BoardRowMenu({ board }: { board: BoardSummary }) {
  const [open, setOpen] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(board.name);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  // This menu opens from the board list and, since the boards drawer, from the
  // board's own top bar. Deleting the board you are looking at cannot end in
  // router.refresh(): the layout would re-render onto a board that no longer
  // exists and notFound() the user out of the app. Compared segment-wise
  // rather than by prefix, or /boards/b10 would count as /boards/b1.
  const viewing = pathname === `/boards/${board.id}` || pathname.startsWith(`/boards/${board.id}/`);

  function close() {
    setOpen(null);
    setConfirmName('');
    setError(null);
  }

  function rename(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameBoard({ boardId: board.id, name });
      if (!result.ok) {
        setError('That name could not be saved. Try again.');
        return;
      }
      close();
      router.refresh();
    });
  }

  function remove(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteBoard({ boardId: board.id, confirmName });
      if (!result.ok) {
        setError(
          result.error === 'NAME_MISMATCH'
            ? 'That is not the board name. Type it exactly to delete.'
            : 'That board could not be deleted. Try again.',
        );
        return;
      }
      close();
      if (viewing) router.push('/boards');
      else router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Board actions for ${board.name}`}
          className="rounded-[var(--radius-control)] px-2 py-1 text-muted hover:bg-ink/10 hover:text-ink"
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent>
          <DialogTitle>Rename board</DialogTitle>
          <form onSubmit={rename} className="mt-4 space-y-3">
            <label className="block text-sm text-muted" htmlFor={`rename-${board.id}`}>
              Board name
            </label>
            <input
              id={`rename-${board.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            {error && <p className="text-sm text-time-over">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
            >
              Save changes
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'delete'} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent>
          <DialogTitle>Delete {board.name}</DialogTitle>
          <p className="mt-2 text-sm text-muted">
            This deletes the board and everything on it. It cannot be undone.
          </p>
          <form onSubmit={remove} className="mt-4 space-y-3">
            <label className="block text-sm text-muted" htmlFor={`confirm-${board.id}`}>
              Type the board name to confirm
            </label>
            <input
              id={`confirm-${board.id}`}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-[15px]"
            />
            {error && <p className="text-sm text-time-over">{error}</p>}
            <button
              type="submit"
              disabled={pending || confirmName.length === 0}
              className="rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
            >
              Delete board
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
