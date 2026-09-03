import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';

// closestCorners scores a droppable by the mean distance between corresponding
// corners, so a column — a rect as tall as the board — carries a fixed penalty
// from its two bottom corners that a card-sized droppable never pays. A card in
// a column the pointer has already left therefore outranks the column the
// pointer is inside, and the pointer's own position is not part of the sum at
// all. Measured on a 1440px board: a card 278px behind the cursor scored 278
// against the surrounding column's 400.
//
// pointerWithin considers only droppables the pointer is actually inside and
// ranks them by distance from the pointer, so the column under the cursor arms
// and the card under the cursor still wins inside it. It reports nothing when
// there are no pointer coordinates — a keyboard drag — which is what the
// fallback is for, and why it must stay closestCorners.
export const boardCollision: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCorners(args);
};
