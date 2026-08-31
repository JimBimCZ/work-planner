'use client';

import { type Dispatch, type SetStateAction, useState, useTransition } from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { CardDueDate } from '@/components/board/card-due-date';
import { useCardEscapeGuard } from '@/components/board/card-modal';
import { renameCard, setCardDescription, setCardDueDate } from '@/lib/actions/cards';
import type { CardForView } from '@/lib/cards';
import { toDateInputValue } from '@/lib/due';

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
  const [dueDate, setDueDate] = useState(card.dueDate ? toDateInputValue(card.dueDate) : null);
  // The date input is uncontrolled from `dueDate` itself: it holds a local
  // draft so an in-progress edit can sit at '' without React's controlled-date
  // restore snapping it back to the last committed value (a native date input
  // reports '' until all three segments are complete, including transiently
  // while editing an already-set date). `lastDueDate` plus the render-time
  // re-sync below is the documented way to pull in a new `dueDate` value — an
  // optimistic update or its rollback — without an effect.
  const [draftDueDate, setDraftDueDate] = useState(dueDate ?? '');
  const [lastDueDate, setLastDueDate] = useState(dueDate);
  if (dueDate !== lastDueDate) {
    setLastDueDate(dueDate);
    setDraftDueDate(dueDate ?? '');
  }
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useCardEscapeGuard(
    () =>
      title !== savedTitle ||
      description !== savedDescription ||
      draftDueDate !== (dueDate ?? ''),
  );

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

  // Unlike title and description, this field keeps its own immediate
  // optimistic setDueDate(next): a controlled date input must show the picked
  // value at once, and commitField's shared path assumes the field already
  // holds `next` before it is called. The no-op guard and the late-response
  // guard on rollback still match commitField's behaviour, because the brief
  // commits on both change and blur and a rejection landing late must not
  // clobber a value set after it.
  const commitDueDate = (next: string | null) => {
    if (next === dueDate) return;
    const previous = dueDate;
    setDueDate(next);
    setError(null);
    startTransition(async () => {
      const result = await setCardDueDate({ cardId: card.id, dueDate: next });
      if (result.ok) {
        patchCard?.(card.id, { dueDate: next });
      } else {
        setDueDate((current) => (current === next ? previous : current));
        setError('That due date could not be saved. Try again.');
      }
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
        <CardDueDate
          value={dueDate}
          draft={draftDueDate}
          canWrite={canWrite}
          onDraftChange={setDraftDueDate}
          onCommit={commitDueDate}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && draftDueDate !== (dueDate ?? '')) {
              setDraftDueDate(dueDate ?? '');
            }
          }}
        />
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
      <CardDueDate
        value={dueDate}
        draft={draftDueDate}
        canWrite={canWrite}
        onDraftChange={setDraftDueDate}
        onCommit={commitDueDate}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && draftDueDate !== (dueDate ?? '')) {
            setDraftDueDate(dueDate ?? '');
          }
        }}
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
