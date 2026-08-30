import { notFound, redirect } from 'next/navigation';

import { TopBar } from '@/components/app/top-bar';
import { auth } from '@/lib/auth';
import { getBoardWithColumns } from '@/lib/boards';
import { assertBoardAccess, BoardAccessError } from '@/lib/permissions';

// This layout and the page it wraps both check access and both read the board.
// That is deliberate: CLAUDE.md requires every entry point to re-check rather
// than trust a parent, and Next may render them in parallel. getBoardWithColumns
// is cached per request, so it is one query, not two.
export default async function BoardTitleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  const board = await getBoardWithColumns(boardId);
  if (!board) notFound();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        title={board.name}
        userId={session.user.id}
        name={session.user.name ?? null}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
