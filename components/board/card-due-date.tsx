'use client';

import { useState } from 'react';

import { formatDue, fromDateInputValue } from '@/lib/due';
import { useMounted } from '@/lib/use-mounted';

// A native date input: no dependency, keyboard-accessible without work, and
// formatted in the viewer's locale by the browser.
export function CardDueDate({
  value,
  canWrite,
  onCommit,
}: {
  value: string | null;
  canWrite: boolean;
  onCommit: (value: string | null) => void;
}) {
  // formatDue resolves Intl's default locale when none is passed — Node's on
  // the server, the browser's on the client — so the read-only label waits
  // for the client, the same reason the card face's DueDate does.
  const mounted = useMounted();

  // The input is uncontrolled from React's own value prop: it holds a local
  // draft so an in-progress edit can sit at '' without React's controlled-date
  // restore snapping it back to the last committed value (a native date input
  // reports '' until all three segments are complete, including transiently
  // while editing an already-set date). `lastValue` plus the render-time
  // re-sync below is the documented way to pull in a new prop value —
  // an optimistic update from the parent, or its rollback — without an effect.
  const [lastValue, setLastValue] = useState(value);
  const [draft, setDraft] = useState(value ?? '');
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value ?? '');
  }

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
          setDraft(event.target.value);
          // `change` fires on every segment edit and reports '' until all
          // three are complete, so committing every change would clear an
          // in-progress edit and, for a fresh date, briefly write null before
          // the real value lands. A complete date is still worth saving the
          // moment it lands, though — picking one from the calendar UI
          // should not have to wait for a blur that may never come. Clearing
          // a set date commits on blur instead, once the field is known to be
          // deliberately empty rather than mid-edit.
          if (event.target.value !== '') onCommit(event.target.value);
        }}
        onBlur={(event) => {
          if (event.target.value === '') onCommit(null);
        }}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
      />
    </label>
  );
}
