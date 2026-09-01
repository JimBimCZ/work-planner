import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@dnd-kit/sortable', () => ({
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

const { BoardCard } = await import('./board-card');

const card = {
  id: 'card-1',
  columnId: 'col-1',
  title: 'Fix the rank tie-break',
  rank: 'a0',
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds: ['l1', 'l2'],
};

const labels = [
  { id: 'l1', name: 'bug' },
  { id: 'l2', name: 'blocked' },
  { id: 'l3', name: 'chore' },
];

const render = (props: Partial<Parameters<typeof BoardCard>[0]> = {}) =>
  renderToStaticMarkup(
    <BoardCard
      card={card}
      boardId="board-1"
      canWrite
      columns={[]}
      labels={labels}
      onRename={() => {}}
      onDelete={() => {}}
      onMoveTo={() => {}}
      {...props}
    />,
  );

describe('the label line', () => {
  test('names this card labels, and no others', () => {
    const html = render();
    expect(html).toContain('bug');
    expect(html).toContain('blocked');
    expect(html).not.toContain('chore');
  });

  test('renders nothing at all for a card with no labels', () => {
    const html = render({ card: { ...card, labelIds: [] } });
    expect(html).toContain('Fix the rank tie-break');
    expect(html).not.toContain('data-testid="card-labels"');
  });

  // A label deleted by someone else can still be named by a card this client
  // has not caught up on. Dropping it beats rendering 'undefined'.
  test('ignores an id the board no longer has a label for', () => {
    const html = render({ card: { ...card, labelIds: ['l1', 'gone'] } });
    expect(html).toContain('bug');
    expect(html).not.toContain('gone');
  });
});
