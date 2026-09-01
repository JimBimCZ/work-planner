import { db } from '@/lib/db';

export const LABEL_NAME_MAX = 32;

// Not a check constraint: a tunable product limit, not an invariant. It is
// load-bearing rather than cosmetic — a card's label ids travel in a realtime
// payload, and 50 ids at 36 bytes stays far under PAYLOAD_CEILING.
export const LABELS_PER_BOARD = 50;

export type BoardLabel = { id: string; name: string };

export async function boardLabels(boardId: string): Promise<BoardLabel[]> {
  return db.query.labels.findMany({
    where: (label, { eq }) => eq(label.boardId, boardId),
    columns: { id: true, name: true },
    orderBy: (label, { asc, sql }) => [asc(sql`lower(${label.name})`)],
  });
}
