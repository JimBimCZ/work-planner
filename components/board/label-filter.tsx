'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
// import type, not import: lib/labels imports lib/db, which builds a pg pool
// at module scope, and this module is in the client bundle.
import type { BoardLabel } from '@/lib/labels';

export function LabelFilter({ labels }: { labels: BoardLabel[] }) {
  const [open, setOpen] = useState(false);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Counts come from the board's own state rather than a query, so the number
  // beside a label can never disagree with the cards on screen. The canvas has
  // not registered them on the first paint, hence the fallback below.
  const { labelCounts } = useBoardActions();
  const active = new Set(params.getAll('label'));

  function toggle(labelId: string) {
    const next = new URLSearchParams(params);
    const selected = new Set(next.getAll('label'));
    next.delete('label');
    if (selected.has(labelId)) selected.delete(labelId);
    else selected.add(labelId);
    for (const id of selected) next.append('label', id);
    // replace, not push: a filter is a view of this board, not a place in
    // history to walk back through one label at a time.
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium text-ink"
      >
        Filter{active.size > 0 ? ` · ${active.size}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-lg">
          {labels.length === 0 ? (
            <p className="text-sm text-muted">No labels yet.</p>
          ) : (
            <ul className="space-y-2">
              {labels.map((label) => (
                <li key={label.id}>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="accent-flow-mid"
                      checked={active.has(label.id)}
                      onChange={() => toggle(label.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {labelCounts[label.id] ?? 0}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
