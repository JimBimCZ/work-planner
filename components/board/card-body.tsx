'use client';

import { type Dispatch, type SetStateAction, useState, useTransition } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { useCardEscapeGuard } from '@/components/board/card-modal';
import { renameCard, setCardDescription } from '@/lib/actions/cards';
import type { CardForView } from '@/lib/cards';

export function CardBody({
  card,
  canWrite,
  showHeading = true,
}: {
  card: CardForView;
  canWrite: boolean;
  showHeading?: boolean;
}) {
  const { patchCard } = useBoardActions();
  const [title, setTitle] = useState(card.title);
  const [savedTitle, setSavedTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [savedDescription, setSavedDescription] = useState(card.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useCardEscapeGuard(() => title !== savedTitle || description !== savedDescription);

  function commitField({
    next,
    saved,
    setValue,
    setSaved,
    save,
    errorMessage,
    onSuccess,
  }: {
    next: string;
    saved: string;
    setValue: Dispatch<SetStateAction<string>>;
    setSaved: (value: string) => void;
    save: () => Promise<{ ok: boolean }>;
    errorMessage: string;
    onSuccess?: () => void;
  }) {
    if (next === saved) return;
    setError(null);

    startTransition(async () => {
      const result = await save();
      if (result.ok) {
        setSaved(next);
        // Only echo the sent value back if the field still holds it — a
        // faster edit that started after this save and is still in flight
        // must not be clobbered by this save's own response landing late.
        setValue((current) => (current.trim() === next ? next : current));
        onSuccess?.();
      } else {
        setValue((current) => (current.trim() === next ? saved : current));
        setError(errorMessage);
      }
    });
  }

  const commitTitle = () => {
    const next = title.trim();
    if (next === savedTitle) return;
    if (!next) {
      setTitle(savedTitle);
      return;
    }
    commitField({
      next,
      saved: savedTitle,
      setValue: setTitle,
      setSaved: setSavedTitle,
      save: () => renameCard({ cardId: card.id, title: next }),
      errorMessage: 'That card could not be renamed. Try again.',
      onSuccess: () => patchCard?.(card.id, { title: next }),
    });
  };

  const commitDescription = () => {
    const next = description.trim();
    commitField({
      next,
      saved: savedDescription,
      setValue: setDescription,
      setSaved: setSavedDescription,
      save: () => setCardDescription({ cardId: card.id, description: next }),
      errorMessage: 'That description could not be saved. Try again.',
    });
  };

  if (!canWrite) {
    return (
      <article className="flex flex-col gap-4">
        {showHeading ? (
          <h2 className="text-sm font-medium leading-5 text-ink">{savedTitle}</h2>
        ) : null}
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
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape' && title !== savedTitle) setTitle(savedTitle);
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
          if (event.key === 'Escape' && description !== savedDescription) {
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
