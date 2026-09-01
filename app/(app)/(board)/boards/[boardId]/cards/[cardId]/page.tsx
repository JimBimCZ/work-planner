import { CardBody } from '@/components/board/card-body';
import { getCardForRoute } from '@/lib/cards';

export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const { card, labels, canWrite, viewer } = await getCardForRoute(boardId, cardId);

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-6">
      <CardBody card={card} labels={labels} canWrite={canWrite} viewer={viewer} />
    </div>
  );
}
