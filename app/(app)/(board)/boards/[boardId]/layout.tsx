import { notFound, redirect } from 'next/navigation';

import { TopBar } from '@/components/app/top-bar';
import { BoardActionsProvider } from '@/components/board/board-actions';
import { NewCardButton } from '@/components/board/new-card-button';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

// This layout and the page it wraps both check access and both read the board.
// That is deliberate: CLAUDE.md requires every entry point to re-check rather
// than trust a parent, and Next may render them in parallel. getBoardWithColumns
// is cached per request, so it is one query, not two.
export default async function BoardTitleLayout({
  children,
  card,
  params,
}: {
  children: React.ReactNode;
  card: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  let role;
  try {
    role = await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  const board = await getBoardWithColumns(boardId);
  if (!board) notFound();

  return (
    <BoardActionsProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopBar
          title={board.name}
          actions={atLeast(role, 'member') ? <NewCardButton /> : null}
          userId={session.user.id}
          name={session.user.name ?? null}
          email={session.user.email ?? ''}
          image={session.user.image ?? null}
        />
        <div className="min-h-0 flex-1">{children}</div>
        {card}
      </div>
    </BoardActionsProvider>
  );
}
