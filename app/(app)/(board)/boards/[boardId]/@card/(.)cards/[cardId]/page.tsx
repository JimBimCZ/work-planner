import { notFound, redirect } from 'next/navigation';

import { CardBody } from '@/components/board/card-body';
import { CardModal } from '@/components/board/card-modal';
import { auth } from '@/lib/auth';
import { getCardForView } from '@/lib/cards';
import { assertBoardAccess, atLeast, BoardAccessError } from '@/lib/permissions';

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const card = await getCardForView(cardId);
  // The URL carries both ids; a card that is not on this board is not found
  // here, whatever the caller can see elsewhere.
  if (!card || card.boardId !== boardId) notFound();

  let role;
  try {
    role = await assertBoardAccess(session.user.id, card.boardId, 'viewer');
  } catch (error) {
    if (error instanceof BoardAccessError) notFound();
    throw error;
  }

  return (
    <CardModal title={card.title}>
      <CardBody card={card} canWrite={atLeast(role, 'member')} />
    </CardModal>
  );
}
