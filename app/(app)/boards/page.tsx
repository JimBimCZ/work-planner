import { redirect } from 'next/navigation';

import { BoardList } from '@/components/boards/board-list';
import { auth } from '@/lib/auth';
import { listBoardsForUser } from '@/lib/boards';

export default async function BoardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const boards = await listBoardsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-medium tracking-tight">Boards</h1>
      </div>
      {boards.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-12 text-center">
          <h2 className="text-[22px] font-medium tracking-tight">Create your first board</h2>
        </div>
      ) : (
        <BoardList boards={boards} />
      )}
    </main>
  );
}
