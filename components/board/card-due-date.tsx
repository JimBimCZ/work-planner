'use client';

import type { KeyboardEvent } from 'react';

import { formatDue, fromDateInputValue } from '@/lib/due';
import { useMounted } from '@/lib/use-mounted';

// A native date input: no dependency, keyboard-accessible without work, and
// formatted in the viewer's locale by the browser.
export function CardDueDate({
  value,
  draft,
  canWrite,
  onDraftChange,
  onCommit,
  onKeyDown,
}: {
  value: string | null;
  draft: string;
  canWrite: boolean;
  onDraftChange: (value: string) => void;
  onCommit: (value: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  // formatDue resolves Intl's default locale when none is passed — Node's on
  // the server, the browser's on the client — so the read-only label waits
  // for the client, the same reason the card face's DueDate does.
  const mounted = useMounted();

  if (!canWrite) {
    if (!value || !mounted) return null;
    const due = fromDateInputValue(value);
    return due ? <p className="font-mono text-xs text-muted">Due {formatDue(due)}</p> : null;
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Due
      <input
        type="date"
        aria-label="Due date"
        value={draft}
        onChange={(event) => {
          onDraftChange(event.target.value);
          // `change` fires on every segment edit and reports '' until all
          // three are complete, so committing every change would clear an
          // in-progress edit and, for a fresh date, briefly write null before
          // the real value lands. A complete date is still worth saving the
          // moment it lands, though — picking one from the calendar UI
          // should not have to wait for a blur that may never come. Clearing
          // a set date commits on blur (or Escape reverts it) instead, once
          // the field is known to be deliberately empty rather than mid-edit.
          if (event.target.value !== '') onCommit(event.target.value);
        }}
        onBlur={(event) => {
          if (event.target.value === '') onCommit(null);
        }}
        onKeyDown={onKeyDown}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
      />
    </label>
  );
}
