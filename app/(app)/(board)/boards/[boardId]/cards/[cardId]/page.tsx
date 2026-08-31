import Link from 'next/link';

import { CardBody } from '@/components/board/card-body';
import { getCardForRoute } from '@/lib/cards';

export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const { card, canWrite, viewer } = await getCardForRoute(boardId, cardId);

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-6">
      <Link
        href={`/boards/${boardId}`}
        className="mb-4 inline-block text-sm text-muted hover:text-ink"
      >
        Back to board
      </Link>
      <CardBody card={card} canWrite={canWrite} viewer={viewer} />
    </div>
  );
}
