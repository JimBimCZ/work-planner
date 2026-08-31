'use client';

import { useState, useTransition } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { renameCard, setCardDescription } from '@/lib/actions/cards';
import type { CardForView } from '@/lib/cards';

export function CardBody({
  card,
  canWrite,
}: {
  card: CardForView;
  canWrite: boolean;
}) {
  const { patchCard } = useBoardActions();
  const [title, setTitle] = useState(card.title);
  const [savedTitle, setSavedTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [savedDescription, setSavedDescription] = useState(card.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const commitTitle = () => {
    const next = title.trim();
    if (next === savedTitle) return;
    if (!next) {
      setTitle(savedTitle);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameCard({ cardId: card.id, title: next });
      if (result.ok) {
        setSavedTitle(next);
        setTitle(next);
        patchCard?.(card.id, { title: next });
      } else {
        setTitle(savedTitle);
        setError('That card could not be renamed. Try again.');
      }
    });
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === savedDescription) return;
    setError(null);
    startTransition(async () => {
      const result = await setCardDescription({ cardId: card.id, description: next });
      if (result.ok) {
        setSavedDescription(next);
        setDescription(next);
      } else {
        setDescription(savedDescription);
        setError('That description could not be saved. Try again.');
      }
    });
  };

  if (!canWrite) {
    return (
      <article className="flex flex-col gap-4">
        <h1 className="text-sm font-medium leading-5 text-ink">{savedTitle}</h1>
        <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink">
          {savedDescription || <span className="text-muted">No description yet</span>}
        </p>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      <input
        aria-label="Card title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // The dialog also listens for Escape; reverting the field should
            // not also close the card out from under the person doing it.
            event.stopPropagation();
            setTitle(savedTitle);
          }
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-sm font-medium text-ink"
      />
      <textarea
        aria-label="Description"
        value={description}
        rows={6}
        placeholder="Add a description"
        onChange={(event) => setDescription(event.target.value)}
        onBlur={commitDescription}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDescription(savedDescription);
          }
        }}
        className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-[15px] leading-6 text-ink"
      />
      <p role="status" aria-live="polite" className="min-h-5 text-xs text-time-over">
        {error}
      </p>
    </article>
  );
}
