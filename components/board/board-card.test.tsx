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
  attachmentCount: 0,
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
      filtering={false}
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

  test('reads in the board order, not the order the labels were applied', () => {
    // The same two labels, assigned the other way round, must render the same
    // way: the assignment order is whatever the picker was clicked in.
    expect(render({ card: { ...card, labelIds: ['l2', 'l1'] } })).toContain('bug · blocked');
    expect(render({ card: { ...card, labelIds: ['l1', 'l2'] } })).toContain('bug · blocked');
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

describe('the attachment count', () => {
  test('a card with attachments says how many', () => {
    const html = render({ card: { ...card, attachmentCount: 3 } });
    expect(html).toContain('3 attachments');
  });

  test('one attachment reads in the singular', () => {
    expect(render({ card: { ...card, attachmentCount: 1 } })).toContain('1 attachment');
  });

  test('a card with none renders nothing at all', () => {
    const html = render({ card: { ...card, attachmentCount: 0 } });
    expect(html).not.toContain('data-testid="card-attachments"');
  });

  // CLAUDE.md allows three colour roles, and warm is never at rest on the
  // board except a due date. The count is muted mono, like every other meta.
  test('the count carries no colour of its own', () => {
    const html = render({ card: { ...card, attachmentCount: 3 } });
    // Bounded to this element: slicing to the end of the string would drag in
    // CardMenu's markup and fail for something that is not this line's doing.
    const start = html.indexOf('data-testid="card-attachments"');
    const line = html.slice(start, html.indexOf('</p>', start));
    expect(line).toContain('text-muted');
    expect(line).not.toContain('text-time-');
  });
});
