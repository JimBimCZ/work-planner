import { notFound, redirect } from 'next/navigation';

import { ColumnShell } from '@/components/board/column-shell';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { flowHue } from '@/lib/flow';
import { assertBoardAccess, BoardAccessError, type BoardRole } from '@/lib/permissions';

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  let role: BoardRole;
  try {
    role = await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    // A membership miss is indistinguishable from a missing board on purpose:
    // a 403 would confirm a guessed id is real.
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  const board = await getBoardWithColumns(boardId);
  if (!board) notFound();

  const total = board.columns.length;

  return (
    <main className="h-full overflow-x-auto" data-role={role}>
      <div className="flex h-full min-w-max">
        {board.columns.map((column, index) => (
          <ColumnShell
            key={column.id}
            name={column.name}
            hue={flowHue(index, total)}
            nextHue={flowHue(Math.min(index + 1, total - 1), total)}
          />
        ))}
      </div>
    </main>
  );
}
