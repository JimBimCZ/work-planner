'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CardMenu } from '@/components/board/card-menu';
import type { StateCard } from '@/lib/board-state';
import { dueLabel, dueState, formatDue, fromDateInputValue } from '@/lib/due';

function DueDate({ value }: { value: string }) {
  const due = fromDateInputValue(value);
  const [now, setNow] = useState<Date | null>(null);

  // Server and client can disagree about "today" AND about locale —
  // formatDue resolves Intl's default locale when none is passed, Node's on
  // the server and the browser's on the client. Both the warm state and the
  // date text wait for the client so neither can hydrate to a mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: this IS the hydration-safety gate, not state synced from an external system.
  useEffect(() => setNow(new Date()), []);

  if (!due || !now) return null;

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

export function BoardCard({
  card,
  boardId,
  canWrite,
  columns,
  onRename,
  onDelete,
  onMoveTo,
}: {
  card: StateCard;
  boardId: string;
  canWrite: boolean;
  columns: { id: string; name: string }[];
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveTo: (columnId: string) => void;
}) {
  // A card with a temp id has no server id to move, so it is not draggable
  // until it settles; a viewer is never draggable at all.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canWrite || card.pending === true,
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
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card-enter group relative rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ${
        // The overlay carries the card while it is dragged, so what is left
        // behind is the hole it came from, not a second copy.
        isDragging ? 'opacity-40' : ''
      }`}
    >
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

      {card.dueDate ? <DueDate value={card.dueDate} /> : null}

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
