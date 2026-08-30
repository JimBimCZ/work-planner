'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createBoard } from '@/lib/actions/boards';

export function NewBoardDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError('Enter a name for the board');
      return;
    }

    startTransition(async () => {
      const result = await createBoard({ name });
      if (!result.ok) {
        setError('That board could not be created. Try again.');
        return;
      }
      setOpen(false);
      setName('');
      setError(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white">
        New board
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New board</DialogTitle>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm text-muted" htmlFor="board-name">
            Board name
          </label>
          <input
            id="board-name"
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
            Create board
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
