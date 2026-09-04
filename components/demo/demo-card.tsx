'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { avatarHue, initials } from '@/lib/avatar';
import type { DemoCardDetail } from '@/lib/demo-board';
import { dueLabel, dueState, formatDue } from '@/lib/due';
import { formatRelative } from '@/lib/relative-time';
import { useMounted } from '@/lib/use-mounted';

// Deliberately not components/board/card-body.tsx. That component reads
// comments from the server on mount, mounts the attachment picker and imports
// four server actions; this dialog has no server behind it at all. The cost is
// that the two can drift — see docs/specs/demo-board.md, "What this costs".
export function DemoCard({ card, onClose }: { card: DemoCardDetail; onClose: () => void }) {
  // The same hydration trap DueDate and CommentTime avoid: the server does not
  // know the reader's clock, locale or time zone.
  const mounted = useMounted();
  const now = new Date();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-[15px] font-medium tracking-[-0.01em]">
          {card.title}
        </DialogTitle>

        {card.dueDate && mounted ? (
          <p
            className={`font-mono text-xs ${
              dueState(card.dueDate, now) === 'over'
                ? 'text-time-over'
                : dueState(card.dueDate, now) === 'soon'
                  ? 'text-time-soon'
                  : 'text-muted'
            }`}
          >
            {formatDue(card.dueDate)}
            {dueLabel(card.dueDate, now) ? ` · ${dueLabel(card.dueDate, now)}` : ''}
          </p>
        ) : null}

        {card.labels.length > 0 ? (
          <p className="font-mono text-xs text-muted">
            {card.labels.map((label) => label.name).join(' · ')}
          </p>
        ) : null}

        {card.description ? (
          <p className="whitespace-pre-wrap text-[15px]/6 text-ink">{card.description}</p>
        ) : null}

        {card.comments.length > 0 ? (
          <ul className="flex flex-col gap-4 border-t border-line pt-4">
            {card.comments.map((comment) => (
              <li key={comment.id} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: `hsl(${avatarHue(comment.author.id)} 45% 45%)` }}
                >
                  {initials(comment.author.name, '')}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted">
                    <span className="text-ink">{comment.author.name}</span>{' '}
                    <time dateTime={comment.createdAt.toISOString()} className="font-mono">
                      {mounted ? formatRelative(comment.createdAt, now) : null}
                    </time>
                  </p>
                  <p className="whitespace-pre-wrap text-[15px]/6 text-ink">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t border-line pt-4 text-[13px] text-muted">
          Sign in to add a comment, a due date or a file.
        </p>
      </DialogContent>
    </Dialog>
  );
}
