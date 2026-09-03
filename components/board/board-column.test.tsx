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
  // where. flowColor hardcodes saturation and lightness (lib/flow.ts), so
  // hue is the only value that could smuggle the accent through: 173 is
  // --flow-mid (#12A594, app/globals.css) converted with
  // colorsys.rgb_to_hls. Asserting on the hue alone — not the full
  // "hsl(173 80% 36%)" string, which mixes in the hex's own unrelated
  // saturation and lightness and could never appear here — is what makes
  // this catch a DropLine that wrongly hardcoded the accent's hue: that
  // regression would emit "hsl(173 60% 45%)", which still starts with
  // "hsl(173".
  test('the line takes the column hue, not the accent', () => {
    const html = render({ dropIndicator: indicator('c2'), hue: 185 });
    expect(html).toContain('hsl(185 60% 45%)');
    expect(html).not.toContain('hsl(173');
  });
});

describe('the column body', () => {
  test('the column sits on a well of its own', () => {
    expect(render()).toContain('bg-well');
  });

  // The defect this fixes: the header used to live inside the scrolling
  // element, so a long column scrolled its own name out of view and left the
  // hue behind. CLAUDE.md requires the name to be visible whenever the hue is.
  test('the header is not inside the scrolling element', () => {
    const html = render();
    const scroller = html.indexOf('overflow-y-auto');
    const name = html.indexOf('data-testid="column-name"');
    expect(name).toBeGreaterThan(-1);
    expect(scroller).toBeGreaterThan(-1);
    expect(name).toBeLessThan(scroller);
  });

  // The droppable must stay on the scrolling body: the empty area below the
  // last card is a drop target, and moving the ref would change which element
  // answers a drop.
  test('the cards still scroll', () => {
    expect(render()).toContain('overflow-y-auto');
  });
});
