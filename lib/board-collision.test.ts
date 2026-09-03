import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core';
import { closestCorners } from '@dnd-kit/core';
import { describe, expect, test } from 'vitest';

import { boardCollision } from './board-collision';

// The numbers are measured, not invented: a 1440x900 board, five 312px column
// sections, their 300px panels, and a card dragged along the row its own
// neighbours sit on. See lib/board-collision.ts for what they demonstrate.
const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const COLUMN_TOP = 55;
const COLUMN_HEIGHT = 845;
const CARD_ROW = 115;
const CARD_HEIGHT = 58;

const rects = {
  'col-ready': rect(6, COLUMN_TOP, 300, COLUMN_HEIGHT),
  'col-progress': rect(318, COLUMN_TOP, 300, COLUMN_HEIGHT),
  'col-testing': rect(630, COLUMN_TOP, 300, COLUMN_HEIGHT),
  'card-progress': rect(330, CARD_ROW, 276, CARD_HEIGHT),
} satisfies Record<string, ClientRect>;

const container = (id: string): DroppableContainer => ({
  id,
  key: id,
  disabled: false,
  data: { current: undefined },
  node: { current: null },
  rect: { current: rects[id as keyof typeof rects] },
});

const active: Active = {
  id: 'card-dragged',
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

// The pointer sits 120px inside the third column; the dragged card straddles
// the boundary behind it, which is exactly what a hand does mid-drag.
const args = (pointer: { x: number; y: number } | null) => ({
  active,
  collisionRect: rect(pointer ? pointer.x - 138 : 612, CARD_ROW, 276, CARD_HEIGHT),
  droppableRects: new Map(Object.entries(rects)),
  droppableContainers: Object.keys(rects).map(container),
  pointerCoordinates: pointer,
});

describe('boardCollision', () => {
  test('the column under the pointer wins, not a card in another column', () => {
    const [first] = boardCollision(args({ x: 750, y: 144 }));

    expect(first?.id).toBe('col-testing');
  });

  test('a card under the pointer still wins over its own column', () => {
    const [first] = boardCollision(args({ x: 468, y: 144 }));

    expect(first?.id).toBe('card-progress');
  });

  test('with no pointer — a keyboard drag — it falls back to closestCorners', () => {
    const keyboard = args(null);

    expect(boardCollision(keyboard)).toEqual(closestCorners(keyboard));
    expect(boardCollision(keyboard).length).toBeGreaterThan(0);
  });
});
