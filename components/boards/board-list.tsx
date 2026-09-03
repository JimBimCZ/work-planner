import Link from 'next/link';

import { BoardRowMenu } from '@/components/boards/board-row-menu';

import type { BoardSummary } from '@/lib/boards';

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const;

// Formatted on the server, so the locale is the server's. Deliberate: the
// alternative is a client component for a timestamp. Due dates, where the
// viewer's locale actually matters, are a later sub-project.
function formatUpdated(at: Date): string {
  const elapsed = at.getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [unit, milliseconds] of UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return format.format(Math.round(elapsed / milliseconds), unit);
    }
  }
  return format.format(0, 'minute');
}

export function BoardList({
  boards,
  currentBoardId,
}: {
  boards: BoardSummary[];
  // Set only by the boards drawer, which opens from a board you are already
  // looking at. The /boards page has no current board to mark.
  currentBoardId?: string;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {boards.map((board) => (
        <li key={board.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            href={`/boards/${board.id}`}
            // An active state, which is what the accent is for. Nothing else
            // on this row is teal.
            aria-current={board.id === currentBoardId ? 'page' : undefined}
            className={`text-[15px] font-medium hover:underline ${
              board.id === currentBoardId ? 'text-flow-mid' : 'text-ink'
            }`}
          >
            {board.name}
          </Link>
          <div className="flex items-center gap-3">
            {board.role !== 'owner' && <span className="text-xs text-muted">{board.role}</span>}
            <time dateTime={board.updatedAt.toISOString()} className="font-mono text-xs text-muted">
              {formatUpdated(board.updatedAt)}
            </time>
            {board.role === 'owner' && <BoardRowMenu board={board} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
