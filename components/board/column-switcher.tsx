'use client';

import type { StateColumn } from '@/lib/board-state';

export function ColumnSwitcher({
  columns,
  activeId,
  onSelect,
}: {
  columns: StateColumn[];
  activeId: string | null;
  onSelect: (columnId: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Columns"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 min-[700px]:hidden"
    >
      {columns.map((column) => (
        <button
          key={column.id}
          role="tab"
          type="button"
          aria-selected={column.id === activeId}
          onClick={() => onSelect(column.id)}
          className="shrink-0 rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted aria-selected:bg-ink/10 aria-selected:text-ink"
        >
          {column.name}
        </button>
      ))}
    </div>
  );
}
