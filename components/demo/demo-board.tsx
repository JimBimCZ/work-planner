'use client';

import { useState } from 'react';

import { BoardCanvas } from '@/components/board/board-canvas';
import { DemoCard } from '@/components/demo/demo-card';
import type { BoardWithCards } from '@/lib/boards';
import { demoCard } from '@/lib/demo-board';

// The open card is state, not a route: the intercepting parallel route exists
// so a real card has a shareable URL, and a demo card has nothing to share.
export function DemoBoard({ board }: { board: BoardWithCards }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? demoCard(openId, new Date()) : null;

  return (
    <>
      <BoardCanvas board={board} canWrite={false} demo onOpenCard={setOpenId} />
      {open ? <DemoCard card={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
