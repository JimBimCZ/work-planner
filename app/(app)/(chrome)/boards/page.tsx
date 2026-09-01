import { redirect } from 'next/navigation';

import { BoardList } from '@/components/boards/board-list';
import { Invitations } from '@/components/boards/invitations';
import { NewBoardDialog } from '@/components/boards/new-board-dialog';
import { auth } from '@/lib/auth';
import { listBoardsForUser } from '@/lib/boards';
import { listInvitesForUser } from '@/lib/members';

export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const boards = await listBoardsForUser(session.user.id);
  const invites = session.user.email ? await listInvitesForUser(session.user.email) : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Invitations invites={invites} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-medium tracking-tight">Boards</h1>
        {/* The empty state carries the only call to action when there is no
            list to sit above, so the page never shows two of the same button. */}
        {boards.length > 0 && <NewBoardDialog />}
      </div>
      {boards.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-12 text-center">
          <h2 className="text-[22px] font-medium tracking-tight">Create your first board</h2>
          <p className="mt-2 text-sm text-muted">
            A board holds your columns and cards. Name it after the work, not the team.
          </p>
          <div className="mt-5 flex justify-center">
            <NewBoardDialog />
          </div>
        </div>
      ) : (
        <BoardList boards={boards} />
      )}
    </main>
  );
}
