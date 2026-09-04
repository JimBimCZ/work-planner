// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// vitest.config.mts does not set globals: true, so Testing Library never
// registers afterEach(cleanup) for itself. CLAUDE.md requires it by hand.
afterEach(cleanup);

// jsdom implements no matchMedia, and BoardCanvas reads it through
// useSyncExternalStore for prefers-reduced-motion. Stubbed per file rather
// than in a setup file, matching the per-file jsdom pragma this repo uses.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Same gap: BoardCanvas observes its columns to drive the mobile switcher.
// Nothing here scrolls, so an observer that never reports is the honest stub.
window.IntersectionObserver = class {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
} as unknown as typeof IntersectionObserver;

// DndContext is mocked so the test can hold the real onDragEnd and call it
// with a drop, rather than simulating pointer physics in jsdom.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((event: unknown) => void) | null }));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (e: unknown) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: () => null,
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => {} }),
  // lib/board-collision.ts imports both at module scope, and board-canvas.tsx
  // imports it. Neither is reached: the test calls onDragEnd directly.
  closestCorners: () => [],
  pointerWithin: () => [],
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  sortableKeyboardCoordinates: () => {},
  verticalListSortingStrategy: undefined,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

const cardActions = vi.hoisted(() => ({
  createCard: vi.fn(),
  deleteCard: vi.fn(),
  moveCard: vi.fn(),
  renameCard: vi.fn(),
}));
vi.mock('@/lib/actions/cards', () => cardActions);
vi.mock('@/lib/actions/board', () => ({ readBoard: vi.fn() }));
vi.mock('@/lib/actions/columns', () => ({
  addColumn: vi.fn(),
  deleteColumn: vi.fn(),
  moveColumn: vi.fn(),
  renameColumn: vi.fn(),
}));

const { BoardCanvas } = await import('./board-canvas');
const { RealtimeProvider } = await import('./realtime');
const { BoardActionsProvider } = await import('./board-actions');
const { demoBoard } = await import('@/lib/demo-board');

const NOW = new Date('2026-09-04T09:30:00.000Z');

const renderDemo = () =>
  render(
    <RealtimeProvider boardId={null}>
      <BoardActionsProvider>
        <BoardCanvas board={demoBoard(NOW)} canWrite={false} demo />
      </BoardActionsProvider>
    </RealtimeProvider>,
  );

test('a demo drop moves the card and tells no one', () => {
  renderDemo();

  // 'demo-card-search' starts in Ready to Work; drop it on In Progress.
  // act() because onDragEnd is called straight rather than through an event,
  // so nothing else flushes the reducer before the assertions read the DOM.
  act(() => {
    dnd.onDragEnd?.({
      active: { id: 'demo-card-search' },
      over: { id: 'demo-col-progress' },
    });
  });

  const progress = document.querySelector('[data-column-id="demo-col-progress"]');
  expect(progress?.textContent).toContain('Search cards across a board');

  // The claim the whole feature rests on.
  expect(cardActions.moveCard).not.toHaveBeenCalled();
  expect(cardActions.createCard).not.toHaveBeenCalled();
  expect(cardActions.renameCard).not.toHaveBeenCalled();
  expect(cardActions.deleteCard).not.toHaveBeenCalled();
});

test('the card leaves the column it came from', () => {
  renderDemo();

  act(() => {
    dnd.onDragEnd?.({
      active: { id: 'demo-card-search' },
      over: { id: 'demo-col-progress' },
    });
  });

  const ready = document.querySelector('[data-column-id="demo-col-ready"]');
  expect(ready?.textContent).not.toContain('Search cards across a board');
});
