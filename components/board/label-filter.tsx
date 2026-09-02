'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { useRealtime } from '@/components/board/realtime';
import { createLabel, deleteLabel, renameLabel } from '@/lib/actions/labels';
import { attempt } from '@/lib/attempt';
// The caps come from lib/labels-limits, which imports nothing. lib/labels
// itself imports lib/db and would put a pg pool in this bundle; the type below
// is safe because `import type` is erased.
import { LABEL_NAME_MAX } from '@/lib/labels-limits';
import { parseLabelFilter } from '@/lib/board-state';
import type { LabelAction } from '@/lib/board-state';
import type { BoardLabel } from '@/lib/labels';

export function LabelFilter({
  labels: seeded,
  boardId,
  canWrite,
}: {
  labels: BoardLabel[];
  boardId: string;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const container = useRef<HTMLDivElement>(null);

  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { claim } = useRealtime();
  // Counts come from the board's own state rather than a query, so the number
  // beside a label can never disagree with the cards on screen. The canvas has
  // not registered them on the first paint, hence the fallback below.
  const { labelCounts, labels: live, dispatchLabel } = useBoardActions();
  // The canvas's set, once it has mounted: the popover must not offer a label
  // the board has already dropped, or the badge would count a filter that
  // narrows nothing — which is the one thing the count exists to rule out.
  const labels = live ?? seeded;
  const active = new Set(parseLabelFilter(params, labels));

  // Escape closes it and click-outside dismisses it, both required by the
  // spec's quality floor. Bound only while open, so a closed popover costs
  // the board no listeners.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // An open rename reverts first; a second Escape then closes the popover,
      // so the key never discards an edit and dismisses in one press.
      if (editing) setEditing(null);
      else setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, editing]);

  function replaceWith(next: URLSearchParams) {
    // replace, not push: a filter is a view of this board, not a place in
    // history to walk back through one label at a time.
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  function toggle(labelId: string) {
    const next = new URLSearchParams(params);
    const selected = new Set(next.getAll('label'));
    next.delete('label');
    if (selected.has(labelId)) selected.delete(labelId);
    else selected.add(labelId);
    for (const id of selected) next.append('label', id);
    replaceWith(next);
  }

  function clear() {
    const next = new URLSearchParams(params);
    next.delete('label');
    replaceWith(next);
  }

  // The board view applies the change to its reducer; the canonical card page
  // has no canvas to dispatch into, so it falls back to the server render the
  // board no longer needs.
  function applyLocally(action: LabelAction) {
    if (dispatchLabel) dispatchLabel(action);
    else router.refresh();
  }

  // A label that is gone must not keep narrowing the board from a stale URL.
  function dropFromFilter(labelId: string) {
    if (!active.has(labelId)) return;
    const next = new URLSearchParams(params);
    const selected = new Set(next.getAll('label'));
    selected.delete(labelId);
    next.delete('label');
    for (const id of selected) next.append('label', id);
    replaceWith(next);
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);

    startTransition(async () => {
      const result = await attempt(() =>
        createLabel({ boardId, name: trimmed, mutationId: claim() }),
      );
      if (!result.ok) {
        setError(
          result.error === 'DUPLICATE'
            ? 'This board already has that label.'
            : result.error === 'LIMIT_REACHED'
              ? 'This board is at fifty labels. Delete one first.'
              : 'That label could not be added. Try again.',
        );
        return;
      }
      setName('');
      applyLocally({ type: 'label.create', label: { id: result.data.id, name: trimmed } });
    });
  }

  function saveName(labelId: string) {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);

    startTransition(async () => {
      const result = await attempt(() =>
        renameLabel({ labelId, name: trimmed, mutationId: claim() }),
      );
      if (!result.ok) {
        setError(
          result.error === 'DUPLICATE'
            ? 'This board already has that label.'
            : 'That label could not be renamed. Try again.',
        );
        return;
      }
      setEditing(null);
      applyLocally({ type: 'label.rename', labelId, name: trimmed });
    });
  }

  function remove(labelId: string) {
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => deleteLabel({ labelId, mutationId: claim() }));
      if (!result.ok) {
        setError('That label could not be deleted. Try again.');
        return;
      }
      dropFromFilter(labelId);
      applyLocally({ type: 'label.delete', labelId });
    });
  }

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium text-ink"
      >
        Filter{active.size > 0 ? ` · ${active.size}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-lg">
          {labels.length === 0 ? (
            <p className="text-sm text-muted">No labels yet.</p>
          ) : (
            <ul className="space-y-2">
              {labels.map((label) => (
                <li key={label.id} className="flex items-center gap-2">
                  {editing === label.id ? (
                    <>
                      <input
                        aria-label="Label name"
                        value={draft}
                        autoFocus
                        maxLength={LABEL_NAME_MAX}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            saveName(label.id);
                          }
                        }}
                        className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1 text-sm text-ink"
                      />
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => saveName(label.id)}
                        aria-label="Save label name"
                        className="shrink-0 text-sm font-medium text-ink"
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      {/* The buttons sit outside the label element so they do
                          not join the checkbox's accessible name. Their visible
                          text stays short and the label name rides in
                          aria-label, so a row of them cannot crowd out the
                          name they act on. */}
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="shrink-0 accent-flow-mid"
                          checked={active.has(label.id)}
                          onChange={() => toggle(label.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{label.name}</span>
                      </label>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                        {labelCounts[label.id] ?? 0}
                      </span>
                      {canWrite && (
                        <>
                          <button
                            type="button"
                            aria-label={`Rename ${label.name}`}
                            onClick={() => {
                              setEditing(label.id);
                              setDraft(label.name);
                            }}
                            className="shrink-0 text-xs text-muted hover:text-ink"
                          >
                            Rename
                          </button>
                          {/* Warm is legal here: a destructive control inside
                              an open popover is transient and local, never at
                              rest on the board. */}
                          <button
                            type="button"
                            aria-label={`Delete ${label.name}`}
                            disabled={pending}
                            onClick={() => remove(label.id)}
                            className="shrink-0 text-xs text-time-over hover:underline"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {active.size > 0 && (
            <button
              type="button"
              onClick={clear}
              className="mt-3 text-sm font-medium text-flow-mid"
            >
              Clear
            </button>
          )}

          {canWrite && (
            <form onSubmit={add} className="mt-3 flex gap-2 border-t border-line pt-3">
              <input
                aria-label="New label"
                value={name}
                maxLength={LABEL_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1 text-sm text-ink"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 text-sm font-medium text-ink"
              >
                Add label
              </button>
            </form>
          )}

          {/* A failed action keeps the popover open and says why here — the
              same lesson the members dialog records. */}
          <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-time-over">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
