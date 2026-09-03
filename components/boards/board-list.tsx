import Link from 'next/link';

import { BoardRowMenu } from '@/components/boards/board-row-menu';

import type { BoardSummary } from '@/lib/boards';
import { formatRelative } from '@/lib/relative-time';

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
            {/* Formatted on the server, so the locale is the server's. Deliberate:
                the alternative is a client component for a timestamp. */}
            <time dateTime={board.updatedAt.toISOString()} className="font-mono text-xs text-muted">
              {formatRelative(board.updatedAt, new Date())}
            </time>
            {board.role === 'owner' && <BoardRowMenu board={board} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
