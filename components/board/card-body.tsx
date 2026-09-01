'use client';

import Link from 'next/link';
import {
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useEffect,
  useState,
  useTransition,
} from 'react';

import { useBoardActions } from '@/components/board/board-actions';
import { CardComments } from '@/components/board/card-comments';
import { CardDueDate } from '@/components/board/card-due-date';
import { useCardEscapeGuard } from '@/components/board/card-modal';
import { useRealtime } from '@/components/board/realtime';
import {
  readCardDescription,
  renameCard,
  setCardDescription,
  setCardDueDate,
} from '@/lib/actions/cards';
import type { CardForView, Viewer } from '@/lib/cards';
import { toDateInputValue } from '@/lib/due';

export function CardBody({
  card,
  canWrite,
  viewer,
  surface = 'page',
}: {
  card: CardForView;
  canWrite: boolean;
  viewer: Viewer;
  // The canonical page has no chrome of its own and no history entry to go
  // back to, so it carries the heading and the way out; the modal has a title
  // bar and a close button for both. One flag, because it is one distinction.
  surface?: 'page' | 'modal';
}) {
  const { patchCard } = useBoardActions();
  const { claim, subscribe } = useRealtime();
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
  const [deleted, setDeleted] = useState(false);
  const [, startTransition] = useTransition();

  // A field is dirty when its draft differs from the value last committed. A
  // remote value lands in any field that is not dirty and is dropped for one
  // that is: the reader keeps their text, and their own commit then wins under
  // last-write-wins exactly as it would have. This is a rule about focus, not
  // text merging.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'card.deleted' && event.id === card.id) {
          setDeleted(true);
          return;
        }
        if (event.type !== 'card.updated' || event.id !== card.id) return;

        if (title === savedTitle) {
          setTitle(event.title);
          setSavedTitle(event.title);
        }

        const remoteDue = event.dueDate;
        if (draftDueDate === (dueDate ?? '')) {
          setDueDate(remoteDue);
          setDraftDueDate(remoteDue ?? '');
          setLastDueDate(remoteDue);
        }

        if (event.descriptionChanged && description === savedDescription) {
          void readCardDescription({ cardId: card.id }).then((result) => {
            if (!result.ok) return;
            const next = result.data.description ?? '';
            setDescription(next);
            setSavedDescription(next);
          });
        }
      }),
    [
      subscribe,
      card.id,
      title,
      savedTitle,
      description,
      savedDescription,
      draftDueDate,
      dueDate,
    ],
  );

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
      save: () => renameCard({ cardId: card.id, title: next, mutationId: claim() }),
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
      const result = await setCardDueDate({
        cardId: card.id,
        dueDate: next,
        mutationId: claim(),
      });
      if (result.ok) {
        patchCard?.(card.id, { dueDate: next });
      } else {
        setDueDate((current) => (current === next ? previous : current));
        setError('That due date could not be saved. Try again.');
      }
    });
  };

  const revertDueDate = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && draftDueDate !== (dueDate ?? '')) {
      setDraftDueDate(dueDate ?? '');
    }
  };

  const commitDescription = () => {
    const next = description.trim();
    commitField({
      next,
      saved: savedDescription,
      setValue: setDescription,
      setSaved: setSavedDescription,
      save: () =>
        setCardDescription({
          cardId: card.id,
          description: next,
          mutationId: claim(),
        }),
      errorMessage: 'That description could not be saved. Try again.',
    });
  };

  const backToBoard = (label: string) => (
    <Link href={`/boards/${card.boardId}`} className="self-start text-sm text-muted hover:text-ink">
      {label}
    </Link>
  );

  // Ahead of both returns below: the modal could close itself, but the
  // canonical page is a route and cannot, so both surfaces say it instead.
  // This is the page's only way back while it stands — rendering the chrome
  // link above it as well would say the same thing twice.
  if (deleted) {
    return (
      <article className="flex flex-col gap-4">
        <p className="text-[15px] leading-6 text-ink">This card was deleted.</p>
        {backToBoard('Back to the board')}
      </article>
    );
  }

  if (!canWrite) {
    return (
      <article className="flex flex-col gap-4">
        {surface === 'page' ? backToBoard('Back to board') : null}
        {surface === 'page' ? (
          <h2 className="text-sm font-medium leading-5 text-ink">{savedTitle}</h2>
        ) : null}
        <CardDueDate value={dueDate} canWrite={canWrite} />
        <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink">
          {savedDescription || <span className="text-muted">No description yet</span>}
        </p>
        <CardComments cardId={card.id} comments={card.comments} viewer={viewer} />
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      {surface === 'page' ? backToBoard('Back to board') : null}
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
        canWrite={canWrite}
        draft={draftDueDate}
        onDraftChange={setDraftDueDate}
        onCommit={commitDueDate}
        onKeyDown={revertDueDate}
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
      <CardComments cardId={card.id} comments={card.comments} viewer={viewer} />
    </article>
  );
}
