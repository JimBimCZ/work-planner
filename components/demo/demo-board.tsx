'use client';

import { BoardCanvas } from '@/components/board/board-canvas';
import type { BoardWithCards } from '@/lib/boards';

// The demo's own client boundary. It exists so the board components stay
// ignorant of the demo beyond one flag, and so Section C has somewhere to
// hold the open card without giving BoardCanvas a dialog it does not need.
export function DemoBoard({ board }: { board: BoardWithCards }) {
  return <BoardCanvas board={board} canWrite={false} demo />;
}
