'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PaperclipIcon } from 'lucide-react';
import Link from 'next/link';

import { CardMenu } from '@/components/board/card-menu';
import type { StateCard } from '@/lib/board-state';
import { dueLabel, dueState, formatDue, fromDateInputValue } from '@/lib/due';
import type { BoardLabel } from '@/lib/labels';
import { useMounted } from '@/lib/use-mounted';

function DueDate({ value }: { value: string }) {
  const due = fromDateInputValue(value);
  // Server and client can disagree about "today" AND about locale —
  // formatDue resolves Intl's default locale when none is passed, Node's on
  // the server and the browser's on the client. Both the warm state and the
  // date text wait for the client so neither can hydrate to a mismatch.
  // now is derived, not stored: it re-evaluates on every render rather than
  // freezing at mount, so a board left open across midnight still compares
  // against today rather than the day it was opened.
  const mounted = useMounted();

  if (!due || !mounted) return null;
  const now = new Date();

  const state = dueState(due, now);
  const label = dueLabel(due, now);
  const tone =
    state === 'over' ? 'text-time-over' : state === 'soon' ? 'text-time-soon' : 'text-muted';

  return (
    <p className={`mt-1.5 font-mono text-xs ${tone}`}>
      {formatDue(due)}
      {label ? ` · ${label}` : ''}
    </p>
  );
}

function LabelLine({ ids, labels }: { ids: string[]; labels: BoardLabel[] }) {
  // Driven by the board's label set rather than by the assignment order, so
  // two cards carrying the same labels always read the same way and the line
  // matches the picker. An id with no label is one this client has not caught
  // up on — dropped rather than rendered, and never a reason to hide the rest.
  const names = labels.filter((label) => ids.includes(label.id)).map((label) => label.name);

  if (names.length === 0) return null;

  // truncate rather than wrap: a card's height must not change with its label
  // count, or a column reflows under a drag in progress.
  return (
    <p data-testid="card-labels" className="mt-1.5 truncate font-mono text-xs text-muted">
      {names.join(' · ')}
    </p>
  );
}

function AttachmentCount({ count }: { count: number }) {
  if (count === 0) return null;

  // Its own line under the due date and the labels, the way those two stack.
  // Mono and muted: CLAUDE.md gives data its own family and spends warm hues
  // only on time and destructive actions.
  return (
    <p
      data-testid="card-attachments"
      className="mt-1.5 flex items-center gap-1 font-mono text-xs text-muted"
      aria-label={`${count} ${count === 1 ? 'attachment' : 'attachments'}`}
    >
      <PaperclipIcon aria-hidden className="size-3" />
      {count}
    </p>
  );
}

function CardMeta({ card, labels }: { card: StateCard; labels: BoardLabel[] }) {
  return (
    <>
      {card.dueDate ? <DueDate value={card.dueDate} /> : null}
      <LabelLine ids={card.labelIds} labels={labels} />
      <AttachmentCount count={card.attachmentCount} />
    </>
  );
}

export function CardFace({ card, labels }: { card: StateCard; labels: BoardLabel[] }) {
  return (
    <>
      <h3 className="text-sm font-medium leading-5 text-ink">{card.title}</h3>
      <CardMeta card={card} labels={labels} />
    </>
  );
}

export function BoardCard({
  card,
  ringHue,
  boardId,
  canWrite,
  columns,
  labels,
  filtering,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  ringHue?: number;
  boardId: string;
  canWrite: boolean;
  columns: { id: string; name: string }[];
  // The board's whole set, not this card's, so one lookup serves every card.
  labels: BoardLabel[];
  filtering: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  // A card with a temp id has no server id to move, so it is not draggable
  // until it settles; a viewer is never draggable at all.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    // A filtered board never drags: moveCard ranks against beforeCardId and
    // afterCardId, and neighbours read from a filtered list put the card
    // between two cards the user cannot see, while neighbours read from the
    // unfiltered list make the drop position on screen a lie. The ⋯ menu's
    // "Move to column" still works, so nothing becomes unreachable.
    disabled: !canWrite || card.pending === true || filtering,
    // The drop settle, per the design brief. Set through the hook rather than a
    // CSS rule so it applies to the settle and not to the drag itself.
    transition: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    // dnd-kit defaults the draggable to role="button", but the card holds a
    // real button — its ⋯ trigger — and a button inside a button is neither
    // valid ARIA nor unambiguous to query. 'group' keeps the card focusable
    // and keyboard-draggable while letting it contain its own controls;
    // tabIndex, aria-roledescription and aria-describedby are untouched.
    attributes: { role: 'group' },
  });

  return (
    <article
      ref={setNodeRef}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      data-ring-hue={ringHue}
      // A box-shadow rather than a border or an outline: it takes no space, so
      // a teammate's change can never reflow a column under a drag in progress.
      // The hue comes from avatarHue, which is constrained to 180°-300°, so the
      // ring cannot stray warm and compete with the due-date signal.
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        boxShadow: ringHue === undefined ? undefined : `0 0 0 2px hsl(${ringHue} 55% 55% / 0.9)`,
      }}
      className={`card-enter group relative min-h-[58px] rounded-[var(--radius-card)] border p-3.5 transition-shadow duration-200 ${
        // The card in flight is carried by the overlay; what is left behind is
        // the socket it came out of, so it reads as absence rather than as a
        // faded second copy. The border stays and turns transparent — removing
        // it would change the box height and reflow the column mid-drag.
        isDragging
          ? 'border-transparent bg-slot shadow-[inset_0_1px_3px_rgb(0_0_0/0.45)]'
          : 'border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]'
      }`}
    >
      <div className={isDragging ? 'invisible' : undefined}>
        <h3
          data-testid="card-title"
          className={`text-sm font-medium leading-5 text-ink ${canWrite ? 'pr-6' : ''}`}
        >
          {card.pending ? (
            // A temp id is not a card the server knows about yet — the same
            // reason useSortable disables dragging above. Not a link until it
            // settles.
            card.title
          ) : (
            <Link
              href={`/boards/${boardId}/cards/${card.id}`}
              className="after:absolute after:inset-0"
              // The browser's default mousedown action focuses this link before
              // the click even fires, blurring whatever had focus — including an
              // open, empty "Add card" composer elsewhere on the board, which
              // closes itself on blur. Opening a card must not have that side
              // effect on state that lives underneath the modal.
              onMouseDown={(event) => event.preventDefault()}
            >
              {card.title}
            </Link>
          )}
        </h3>

        <CardMeta card={card} labels={labels} />

        {canWrite ? (
          <CardMenu
            card={card}
            columns={columns}
            onRename={onRename}
            onDelete={onDelete}
            onMoveTo={onMoveTo}
          />
        ) : null}
      </div>
    </article>
  );
}
