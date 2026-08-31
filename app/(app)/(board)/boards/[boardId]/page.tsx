import { notFound, redirect } from 'next/navigation';

import { BoardCanvas } from '@/components/board/board-canvas';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, atLeast, BoardAccessError, type BoardRole } from '@/lib/permissions';

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

  return <BoardCanvas board={board} canWrite={atLeast(role, 'member')} />;
}
