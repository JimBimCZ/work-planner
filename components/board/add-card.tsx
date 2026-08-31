'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function AddCard({
  columnName,
  open,
  onOpen,
  onClose,
  onSubmit,
}: {
  columnName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Column names carry spaces, which are not legal in an id, so the label is
  // tied to the input by a generated one instead of by the name.
  const inputId = useId();

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Add card to ${columnName}`}
        className="mt-2 w-full rounded-[var(--radius-control)] px-1.5 py-1.5 text-left text-sm text-muted hover:bg-ink/5 hover:text-ink"
      >
        Add card
      </button>
    );
  }

  return (
    <form
      className="mt-2 px-0.5"
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (next.length === 0) return;
        onSubmit(next);
        // Adding cards comes in runs, so the composer stays open for the next.
        setTitle('');
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        Card title
      </label>
      <input
        ref={input}
        id={inputId}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        onBlur={(event) => {
          if (title.trim().length > 0) return;
          // A card opening as a modal moves focus into the dialog, for
          // accessibility — that isn't the user abandoning this composer,
          // and the intercepted route's whole point is that everything
          // underneath, including this, stays exactly as it was.
          const next = event.relatedTarget;
          if (next instanceof Element && next.closest('[role="dialog"]')) return;
          onClose();
        }}
        className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 text-sm text-ink"
      />
    </form>
  );
}
