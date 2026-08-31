'use client';

import type { StateCard } from '@/lib/board-state';

export function BoardCard({ card }: { card: StateCard; canWrite: boolean }) {
  return (
    <article
      data-card-id={card.id}
      className="group relative rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      <h3 data-testid="card-title" className="text-sm font-medium leading-5 text-ink">
        {card.title}
      </h3>
    </article>
  );
}
