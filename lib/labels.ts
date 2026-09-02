import { db } from '@/lib/db';

// Re-exported so every existing server-side import keeps working; the values
// live in lib/labels-limits.ts because a client component needs them too.
export { LABEL_NAME_MAX, LABELS_PER_BOARD } from '@/lib/labels-limits';

export type BoardLabel = { id: string; name: string };

// The ordering is duplicated in lib/boards.ts (the board read carries its own
// labels) and mirrored by byLabelName in lib/board-state.ts, which keeps a live
// create or rename in the same order. Change one, change all three.
export async function boardLabels(boardId: string): Promise<BoardLabel[]> {
  return db.query.labels.findMany({
    where: (label, { eq }) => eq(label.boardId, boardId),
    columns: { id: true, name: true },
    orderBy: (label, { asc, sql }) => [asc(sql`lower(${label.name})`)],
  });
}
