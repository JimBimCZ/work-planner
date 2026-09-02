import { CardBody } from '@/components/board/card-body';
import { CardModal } from '@/components/board/card-modal';
import { getCardForRoute } from '@/lib/cards';

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const { card, labels, canWrite, viewer, attachments, storageEnabled, boardUsed, viewerIsOwner } =
    await getCardForRoute(boardId, cardId);

  return (
    <CardModal title={card.title}>
      <CardBody
        card={card}
        labels={labels}
        canWrite={canWrite}
        viewer={viewer}
        attachments={attachments}
        storageEnabled={storageEnabled}
        boardUsed={boardUsed}
        viewerIsOwner={viewerIsOwner}
        surface="modal"
      />
    </CardModal>
  );
}
