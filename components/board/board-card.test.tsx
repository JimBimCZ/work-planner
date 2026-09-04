import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

const dragging = vi.hoisted(() => ({ current: false }));
const sortableArgs = vi.hoisted(() => ({ current: null as { disabled?: boolean } | null }));
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: (args: { disabled?: boolean }) => {
    sortableArgs.current = args;
    return {
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      get isDragging() {
        return dragging.current;
      },
    };
  },
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
  attachmentCount: 0, descriptionPreview: null,
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
      canDrag
      columns={[]}
      labels={labels}
      filtering={false}
      onRename={() => {}}
      onDelete={() => {}}
      onMoveTo={() => {}}
      {...props}
    />,
  );

describe('the description preview', () => {
  test('sits under the title, clamped so the card cannot grow', () => {
    const html = render({ card: { ...card, descriptionPreview: 'Because the ranks disagree.' } });
    expect(html).toContain('Because the ranks disagree.');
    // Two lines, always. A card whose height varied with its description
    // would reflow its column under a drag in progress — the same reason
    // LabelLine truncates rather than wraps.
    expect(html).toContain('line-clamp-2');
  });

  test('renders nothing at all for a card with no description', () => {
    const html = render({ card: { ...card, descriptionPreview: null } });
    expect(html).toContain('Fix the rank tie-break');
    expect(html).not.toContain('data-testid="card-description"');
  });

  // Prose, not data: CLAUDE.md gives the mono family to dates, ids and counts.
  test('is prose, so it does not borrow the data family', () => {
    const html = render({ card: { ...card, descriptionPreview: 'Because the ranks disagree.' } });
    const preview = html.slice(html.indexOf('data-testid="card-description"'));
    expect(preview.slice(0, 120)).not.toContain('font-mono');
  });
});

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
    const html = render({ card: { ...card, attachmentCount: 3, descriptionPreview: null } });
    expect(html).toContain('3 attachments');
  });

  test('one attachment reads in the singular', () => {
    expect(render({ card: { ...card, attachmentCount: 1, descriptionPreview: null } })).toContain('1 attachment');
  });

  test('a card with none renders nothing at all', () => {
    const html = render({ card: { ...card, attachmentCount: 0, descriptionPreview: null } });
    expect(html).not.toContain('data-testid="card-attachments"');
  });

  // CLAUDE.md allows three colour roles, and warm is never at rest on the
  // board except a due date. The count is muted mono, like every other meta.
  test('the count carries no colour of its own', () => {
    const html = render({ card: { ...card, attachmentCount: 3, descriptionPreview: null } });
    // Bounded to this element: slicing to the end of the string would drag in
    // CardMenu's markup and fail for something that is not this line's doing.
    const start = html.indexOf('data-testid="card-attachments"');
    const line = html.slice(start, html.indexOf('</p>', start));
    expect(line).toContain('text-muted');
    expect(line).not.toContain('text-time-');
  });
});

describe('the card being dragged', () => {
  afterEach(() => {
    dragging.current = false;
  });

  test('at rest it is a surface with a border', () => {
    const html = render();
    expect(html).toContain('bg-surface');
    expect(html).not.toContain('bg-slot');
  });

  test('while dragging it becomes a slot, not a faded card', () => {
    dragging.current = true;
    const html = render();
    expect(html).toContain('bg-slot');
    expect(html).toContain('inset');
    // The old treatment. A 40% card still reads as a card.
    expect(html).not.toContain('opacity-40');
  });

  // The border is kept and made transparent rather than removed: dropping a
  // 1px border changes the box height, and a column must not reflow mid-drag.
  test('the slot keeps the border box it had', () => {
    dragging.current = true;
    expect(render()).toContain('border-transparent');
  });

  test('the slot hides the content without unmounting it', () => {
    dragging.current = true;
    const html = render();
    expect(html).toContain('invisible');
    expect(html).toContain('Fix the rank tie-break');
  });
});

const { CardFace } = await import('./board-card');

describe('the face carried by the drag overlay', () => {
  const withMeta = { ...card, dueDate: '2026-09-05', attachmentCount: 2, descriptionPreview: null };

  test('it is the card, not a label for it', () => {
    const html = renderToStaticMarkup(<CardFace card={withMeta} labels={labels} />);
    expect(html).toContain('Fix the rank tie-break');
    expect(html).toContain('bug · blocked');
    expect(html).toContain('2 attachments');
  });

  // The overlay is aria-hidden and sits outside the board's own DOM order, so
  // a link inside it is a duplicate target for keyboard and screen readers.
  test('it carries no link and no menu', () => {
    const html = renderToStaticMarkup(<CardFace card={withMeta} labels={labels} />);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });
});

describe('the card has room', () => {
  test('it is padded at 16px, not 14', () => {
    expect(render()).toContain('p-4');
  });

  // A title-only card and one carrying a due date, labels and an attachment
  // count should not differ wildly, so rows across columns broadly line up.
  test('it has a floor so ragged rows even out', () => {
    expect(render()).toContain('min-h-[76px]');
  });
});

describe('the demo board', () => {
  // The intercepting route lives under /boards/[boardId]; at / it does not
  // exist. A link there sends a signed-out visitor to /signin from a
  // middle-click, a long-press, or the status bar they read before clicking.
  test('renders the title as plain text, not a link', () => {
    const html = render({ demo: true, canWrite: false });
    expect(html).toContain('Fix the rank tie-break');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });

  test('still links on a real board', () => {
    expect(render()).toContain('href="/boards/board-1/cards/card-1"');
  });
});

test('a demo card title is a button that asks to be opened', () => {
  const html = render({ demo: true, onOpen: () => {} });
  expect(html).toContain('<button');
  expect(html).toContain('Fix the rank tie-break');
  expect(html).not.toContain('href');
});

describe('dragging apart from writing', () => {
  // The demo drags but has no ⋯ menu, no composer and no server. Before this,
  // both behaviours rode on canWrite and could not be separated.
  test('a demo card is draggable while it carries no write controls', () => {
    const html = render({ canWrite: false, canDrag: true, demo: true });
    expect(sortableArgs.current?.disabled).toBe(false);
    expect(html).not.toContain('Card actions');
  });

  test('a viewer still cannot drag', () => {
    render({ canWrite: false, canDrag: false });
    expect(sortableArgs.current?.disabled).toBe(true);
  });

  test('a pending card never drags, whatever else is true', () => {
    render({ canWrite: true, canDrag: true, card: { ...card, pending: true } });
    expect(sortableArgs.current?.disabled).toBe(true);
  });

  test('a filtered board never drags', () => {
    render({ canWrite: true, canDrag: true, filtering: true });
    expect(sortableArgs.current?.disabled).toBe(true);
  });
});
