import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CardBody } from '@/components/board/card-body';
import { auth } from '@/lib/auth';
import { getCardForView } from '@/lib/cards';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const card = await getCardForView(cardId);
  if (!card || card.boardId !== boardId) notFound();

  let role;
  try {
    role = await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-6">
      <Link
        href={`/boards/${boardId}`}
        className="mb-4 inline-block text-sm text-muted hover:text-ink"
      >
        Back to board
      </Link>
      <CardBody card={card} canWrite={atLeast(role, 'member')} />
    </div>
  );
}
