'use client';

import { useBoardActions } from '@/components/board/board-actions';

export function NewCardButton() {
  const { addCard } = useBoardActions();

  return (
    <button
      type="button"
      onClick={() => addCard?.()}
      disabled={!addCard}
      className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      New card
    </button>
  );
}
