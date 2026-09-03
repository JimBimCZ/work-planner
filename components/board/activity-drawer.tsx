'use client';

import Image from 'next/image';
import { useState } from 'react';

import { openActivity } from '@/lib/actions/activity';
// import type, not import: lib/activity imports lib/db, which builds a pg pool
// at module scope. `import type` is erased, so it never reaches the bundle.
import type { ActivityLine } from '@/lib/activity';
import { attempt } from '@/lib/attempt';
import { avatarHue, initials } from '@/lib/avatar';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type Status = 'idle' | 'loading' | 'ready' | 'failed';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relative(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

// Calendar days, not a 24h window — an entry from 11pm yesterday is
// "Yesterday" at 1am today, not "22h ago" folded into "Today".
const localDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;

function dayHeading(createdAt: string, today: number): string {
  const diff = today - localDay(new Date(createdAt));
  // <= 0, not === 0: a small clock skew can date an entry to tomorrow's
  // calendar day, and that should still read as today, not fall through to
  // a formatted date for something that hasn't happened by the clock yet.
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(createdAt));
}

function groupByDay(lines: ActivityLine[]): { heading: string; items: ActivityLine[] }[] {
  const today = localDay(new Date());
  const groups: { heading: string; items: ActivityLine[] }[] = [];
  for (const line of lines) {
    const heading = dayHeading(line.createdAt, today);
    const current = groups.at(-1);
    if (current?.heading === heading) current.items.push(line);
    else groups.push({ heading, items: [line] });
  }
  return groups;
}

function SkeletonRows() {
  return (
    <ul className="mt-4 space-y-4" aria-hidden>
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 animate-pulse">
          <span className="h-7 w-7 shrink-0 rounded-full bg-ink/10" />
          <span className="h-3 flex-1 rounded bg-ink/10" />
          <span className="h-3 w-10 shrink-0 rounded bg-ink/10" />
        </li>
      ))}
    </ul>
  );
}

export function ActivityDrawer({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<ActivityLine[]>([]);

  // Read on open, not on mount: the drawer is opened deliberately, and a
  // board nobody opens it on should cost nothing.
  async function load() {
    setStatus('loading');
    const result = await attempt(() => openActivity({ boardId }));
    if (!result.ok) {
      setStatus('failed');
      return;
    }
    setLines(result.data.lines);
    setStatus('ready');
  }

  const statusMessage =
    status === 'loading'
      ? 'Loading activity'
      : status === 'failed'
        ? 'Could not load the activity. Try again.'
        : status === 'ready' && lines.length === 0
          ? 'Nothing here yet'
          : '';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <SheetTrigger className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium">
        Activity
      </SheetTrigger>
      <SheetContent aria-busy={status === 'loading'}>
        <SheetTitle>Activity</SheetTitle>
        {/* Announces the state a sighted user reads off the panel below —
            the skeleton, the empty state and the failure are otherwise
            silent to a screen reader until it re-navigates into them. */}
        <p aria-live="polite" className="sr-only">
          {statusMessage}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === 'loading' && <SkeletonRows />}
          {status === 'failed' && (
            <p className="mt-4 text-sm text-ink">Could not load the activity. Try again.</p>
          )}
          {status === 'ready' && lines.length === 0 && (
            <p className="mt-4 text-sm text-muted">Nothing here yet</p>
          )}
          {status === 'ready' && lines.length > 0 && (
            <ul className="mt-4 space-y-5">
              {groupByDay(lines).map(({ heading, items }) => (
                <li key={heading}>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {heading}
                  </h3>
                  <ul className="mt-2 space-y-3">
                    {items.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-medium text-white"
                          style={
                            entry.actorImage
                              ? undefined
                              : { background: `hsl(${avatarHue(entry.actorId)} 45% 40%)` }
                          }
                        >
                          {entry.actorImage ? (
                            <Image src={entry.actorImage} alt="" width={28} height={28} />
                          ) : (
                            initials(entry.actorName ?? 'Someone', '')
                          )}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-[15px] leading-6">
                          <strong>{entry.actorName ?? 'Someone'}</strong> {entry.sentence}
                        </span>
                        <time
                          dateTime={entry.createdAt}
                          className="shrink-0 font-mono text-xs text-muted"
                        >
                          {relative(entry.createdAt)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
