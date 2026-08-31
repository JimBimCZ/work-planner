'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
