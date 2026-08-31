import { CardBody } from '@/components/board/card-body';
import { CardModal } from '@/components/board/card-modal';
import { getCardForRoute } from '@/lib/cards';

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const { card, canWrite } = await getCardForRoute(boardId, cardId);

  return (
    <CardModal title={card.title}>
      <CardBody card={card} canWrite={canWrite} />
    </CardModal>
  );
}
