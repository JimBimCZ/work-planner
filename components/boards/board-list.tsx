import Link from 'next/link';

import { BoardRowMenu } from '@/components/boards/board-row-menu';

import type { BoardSummary } from '@/lib/boards';
import { formatRelative } from '@/lib/relative-time';

export function BoardList({ boards }: { boards: BoardSummary[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {boards.map((board) => (
        <li key={board.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <Link
            href={`/boards/${board.id}`}
            className="text-[15px] font-medium text-ink hover:underline"
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
