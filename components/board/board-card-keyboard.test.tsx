// @vitest-environment jsdom
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { BoardCard } from './board-card';
import type { StateCard } from '@/lib/board-state';

afterEach(cleanup);

const card: StateCard = {
  id: 'card-1',
  columnId: 'col-1',
  title: 'Fix the rank tie-break',
  rank: 'a0',
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds: [],
  attachmentCount: 0,
  descriptionPreview: null,
};

// The same two sensors board-canvas.tsx wires onto the real DndContext — a
// shallow render or a mocked useSortable cannot reproduce the KeyboardSensor
// interference this pins.
function Harness({ canDrag, onOpen }: { canDrag: boolean; onOpen: () => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext sensors={sensors}>
      <SortableContext items={[card.id]}>
        <BoardCard
          card={card}
          boardId="board-1"
          canWrite={false}
          canDrag={canDrag}
          demo
          columns={[]}
          labels={[]}
          filtering={false}
          onRename={() => {}}
          onDelete={() => {}}
          onMoveTo={() => {}}
          onOpen={onOpen}
        />
      </SortableContext>
    </DndContext>
  );
}

// Control first, deliberately: with dragging disabled, useSortable hands
// back no listeners at all (@dnd-kit/core's useDraggable returns `listeners:
// disabled ? undefined : listeners`), so the article never carries
// KeyboardSensor's onKeyDown and Enter reaches the button's own default
// activation untouched. This case passing is what proves the other case's
// failure is dnd-kit's interference, not a broken harness — and it runs
// first so it can never inherit an unterminated keyboard-drag session from
// the other test (see the Escape note below).
test('control: with dragging disabled, Enter already opens the card', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<Harness canDrag={false} onOpen={onOpen} />);

  const button = screen.getByRole('button', { name: 'Fix the rank tie-break' });
  button.focus();
  await user.keyboard('{Enter}');

  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('Enter on the focused demo title opens the card', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<Harness canDrag onOpen={onOpen} />);

  const button = screen.getByRole('button', { name: 'Fix the rank tie-break' });
  button.focus();
  await user.keyboard('{Enter}');

  expect(onOpen).toHaveBeenCalledTimes(1);

  // Unfixed, this Enter is consumed by KeyboardSensor's activator and arms a
  // keyboard drag rather than opening the card — Enter is also its "end"
  // code, so an un-terminated drag leaves a real `document`-level keydown
  // listener attached past this test's unmount. Escape cancels it either
  // way (a no-op once the fix means no drag ever started), so this test
  // cannot leak state into whatever runs after it.
  await user.keyboard('{Escape}');
});
