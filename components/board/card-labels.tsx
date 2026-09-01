'use client';

// import type, not import: lib/labels imports lib/db, which builds a pg pool
// at module scope, and this module is in the client bundle.
import type { BoardLabel } from '@/lib/labels';

export function CardLabels({
  labels,
  selected,
  canWrite,
  onChange,
}: {
  labels: BoardLabel[];
  selected: string[];
  canWrite: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  if (labels.length === 0) {
    return <p className="text-sm text-muted">This board has no labels yet.</p>;
  }

  if (!canWrite) {
    const names = labels.filter((label) => selected.includes(label.id)).map((label) => label.name);
    return (
      <p className="font-mono text-xs text-muted">{names.length > 0 ? names.join(' · ') : 'None'}</p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {labels.map((label) => (
        <li key={label.id}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.includes(label.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, label.id]
                    : selected.filter((id) => id !== label.id),
                )
              }
            />
            {label.name}
          </label>
        </li>
      ))}
    </ul>
  );
}
