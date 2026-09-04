import { notFound, redirect } from 'next/navigation';

import { BoardsDrawer } from '@/components/app/boards-drawer';
import { TopBar } from '@/components/app/top-bar';
import { ActivityDrawer } from '@/components/board/activity-drawer';
import { BoardActionsProvider } from '@/components/board/board-actions';
import { LabelFilter } from '@/components/board/label-filter';
import { MembersButton } from '@/components/board/members-button';
import { MembershipWatch } from '@/components/board/membership-watch';
import { NewCardButton } from '@/components/board/new-card-button';
import { RealtimeProvider } from '@/components/board/realtime';
import { auth } from '@/lib/auth';
import { getBoardWithColumns, listBoardsForUser } from '@/lib/boards';
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

  // Read here rather than on open: one indexed query on board_members(userId),
  // which buys the drawer a list with no loading state, and router.refresh()
  // from NewBoardDialog and BoardRowMenu keeps it current.
  const boards = await listBoardsForUser(session.user.id);

  return (
    <RealtimeProvider boardId={boardId}>
      <MembershipWatch viewerId={session.user.id} />
      <BoardActionsProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <TopBar
            title={board.name}
            nav={<BoardsDrawer boards={boards} currentBoardId={boardId} />}
            actions={
              <>
                <LabelFilter
                  labels={board.labels}
                  boardId={boardId}
                  canWrite={atLeast(role, 'member')}
                />
                <MembersButton
                  boardId={boardId}
                  boardName={board.name}
                  viewerId={session.user.id}
                  role={role}
                />
                <ActivityDrawer boardId={boardId} />
                {atLeast(role, 'member') ? <NewCardButton /> : null}
              </>
            }
            viewer={{
              userId: session.user.id,
              name: session.user.name ?? null,
              email: session.user.email ?? '',
              image: session.user.image ?? null,
            }}
          />
          <div className="min-h-0 flex-1">{children}</div>
          {card}
        </div>
      </BoardActionsProvider>
    </RealtimeProvider>
  );
}
