'use client';

import type { CardForView } from '@/lib/cards';

export function CardBody({
  card,
  canWrite,
}: {
  card: CardForView;
  canWrite: boolean;
}) {
  void canWrite;

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-sm font-medium leading-5 text-ink">{card.title}</h1>
      <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink">
        {card.description ?? <span className="text-muted">No description yet</span>}
      </p>
    </article>
  );
}
