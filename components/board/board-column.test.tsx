import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: () => {} }) }));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
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

const { BoardColumn } = await import('./board-column');

const column = { id: 'col-1', name: 'In progress', rank: 'a0' };

const card = (id: string, title: string, rank: string) => ({
  id,
  columnId: 'col-1',
  title,
  rank,
  createdAt: '2026-09-01T00:00:00.000Z',
  dueDate: null,
  labelIds: [],
  attachmentCount: 0,
});

const cards = [card('c1', 'First', 'a0'), card('c2', 'Second', 'a1')];

const render = (props: Partial<Parameters<typeof BoardColumn>[0]> = {}) =>
  renderToStaticMarkup(
    <BoardColumn
      column={column}
      cards={cards}
      filtering={false}
      rings={new Map()}
      boardId="board-1"
      hue={185}
      nextHue={165}
      canWrite
      composerOpen={false}
      onOpenComposer={() => {}}
      onCloseComposer={() => {}}
      onAddCard={() => {}}
      columns={[column]}
      labels={[]}
      dropIndicator={null}
      onRenameCard={() => {}}
      onDeleteCard={() => {}}
      onMoveCardTo={() => {}}
      isFirst
      isLast
      onRenameColumn={() => {}}
      onAddColumnAfter={() => {}}
      onMoveColumn={() => {}}
      onDeleteColumn={null}
      {...props}
    />,
  );

const indicator = (afterCardId: string | null) => ({
  toColumnId: 'col-1',
  beforeCardId: null,
  afterCardId,
});

describe('the drop indicator', () => {
  test('a column that is not the target draws no line', () => {
    expect(render()).not.toContain('data-testid="drop-indicator"');
  });

  test('the line sits above the card it will land before', () => {
    const html = render({ dropIndicator: indicator('c2') });
    expect(html).toContain('data-testid="drop-indicator"');
    expect(html.indexOf('drop-indicator')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('drop-indicator'));
  });

  test('a null afterCardId puts the line below the last card', () => {
    const html = render({ dropIndicator: indicator(null) });
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('drop-indicator'));
  });

  test('an empty target column draws the line instead of its empty state', () => {
    const html = render({ cards: [], dropIndicator: indicator(null) });
    expect(html).toContain('data-testid="drop-indicator"');
    expect(html).not.toContain('Nothing here yet');
  });

  test('an empty column that is not the target still says it is empty', () => {
    const html = render({ cards: [] });
    expect(html).toContain('Nothing here yet');
    expect(html).not.toContain('data-testid="drop-indicator"');
  });

  // dnd-kit already announces the move; the line must not be the only channel.
  // aria-hidden sits on the wrapping <li>, not just DropLine's own div — a
  // reader must not see the column's list gain an extra item while dragging.
  test('the line is hidden from assistive technology', () => {
    const html = render({ dropIndicator: indicator('c2') });
    const innerTagStart = html.lastIndexOf('<', html.indexOf('data-testid="drop-indicator"'));
    const wrapperStart = html.lastIndexOf('<', innerTagStart - 1);
    expect(html.slice(wrapperStart, innerTagStart)).toContain('aria-hidden');
  });

  test('the line is hidden from assistive technology in an empty column', () => {
    const html = render({ cards: [], dropIndicator: indicator(null) });
    const innerTagStart = html.lastIndexOf('<', html.indexOf('data-testid="drop-indicator"'));
    const wrapperStart = html.lastIndexOf('<', innerTagStart - 1);
    expect(html.slice(wrapperStart, innerTagStart)).toContain('aria-hidden');
  });

  // The hue is the column's own, so the line says which column as well as
  // where. hsl(173 80% 36%) is --flow-mid (#12A594) converted to the same
  // "H S% L%" shape flowColor emits — the accent's actual rendered form,
  // not just its hex spelling.
  test('the line takes the column hue, not the accent', () => {
    const html = render({ dropIndicator: indicator('c2'), hue: 185 });
    expect(html).toContain('hsl(185 60% 45%)');
    expect(html).not.toContain('hsl(173 80% 36%)');
  });
});
