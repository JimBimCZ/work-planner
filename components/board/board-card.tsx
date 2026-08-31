'use client';

import { CardMenu } from '@/components/board/card-menu';
import type { StateCard } from '@/lib/board-state';

export function BoardCard({
  card,
  canWrite,
  columns,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  canWrite: boolean;
  columns: { id: string; name: string }[];
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  return (
    <article
      data-card-id={card.id}
      className="group relative rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      <h3
        data-testid="card-title"
        className={`text-sm font-medium leading-5 text-ink ${canWrite ? 'pr-6' : ''}`}
      >
        {card.title}
      </h3>

      {canWrite ? (
        <CardMenu
          card={card}
          columns={columns}
          onRename={onRename}
          onDelete={onDelete}
          onMoveTo={onMoveTo}
        />
      ) : null}
    </article>
  );
}
