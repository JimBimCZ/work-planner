'use client';

import { BoardList } from '@/components/boards/board-list';
import { NewBoardDialog } from '@/components/boards/new-board-dialog';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { BoardSummary } from '@/lib/boards';

// The board route's way back to every other board, and to creating one. It
// renders the /boards page's own list rather than a second implementation of
// it: the row menu, the role badge and the updated time all come along, and
// rename and delete keep living in exactly one place.
//
// A Sheet rather than a dropdown for the same reason — BoardRowMenu is itself
// a menu that opens two dialogs, and nesting that inside another menu means
// submenus and dialogs unmounting with their parent.
export function BoardsDrawer({
  boards,
  currentBoardId,
}: {
  boards: BoardSummary[];
  currentBoardId: string;
}) {
  return (
    <Sheet>
      <SheetTrigger className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium">
        Boards
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>Boards</SheetTitle>
        {/* Under the title rather than beside it: the close button already
            holds the top-right corner. */}
        <div className="flex">
          <NewBoardDialog />
        </div>
        {/* The panel itself does not scroll — see components/ui/sheet.tsx —
            so the list owns the scrolling region. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BoardList boards={boards} currentBoardId={currentBoardId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
