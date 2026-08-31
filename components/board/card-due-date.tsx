'use client';

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
        value={value ?? ''}
        onChange={(event) => {
          // `change` fires on every segment edit and reports '' until all
          // three are complete, so committing every change would clear an
          // in-progress edit and, for a fresh date, briefly write null before
          // the real value lands. A complete date is still worth saving the
          // moment it lands, though — picking one from the calendar UI
          // should not have to wait for a blur that may never come.
          if (event.target.value !== '') onCommit(event.target.value);
        }}
        onBlur={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
      />
    </label>
  );
}
