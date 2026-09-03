import { describe, expect, test } from 'vitest';

import {
  applyAll,
  boardReducer,
  cardsIn,
  dropTarget,
  inverse,
  matchesFilter,
  orderedColumns,
  parseLabelFilter,
  sameDropTarget,
  toBoardState,
  type BoardAction,
  type BoardState,
  type StateCard,
} from './board-state';

const base = (): BoardState => ({
  labels: [],
  columns: [
    { id: 'col-1', name: 'Ready to Work', rank: 'a0' },
    { id: 'col-2', name: 'In Progress', rank: 'a1' },
  ],
  cards: [
    { id: 'card-a', columnId: 'col-1', title: 'First', rank: 'b0', createdAt: '2026-01-01', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null },
    { id: 'card-b', columnId: 'col-1', title: 'Second', rank: 'b1', createdAt: '2026-01-02', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null },
  ],
});

describe('selectors', () => {
  test('order columns by rank', () => {
    const state = { ...base(), columns: [...base().columns].reverse() };
    expect(orderedColumns(state).map((c) => c.id)).toEqual(['col-1', 'col-2']);
  });

  test("order a column's cards by rank and return only that column's", () => {
    expect(cardsIn(base(), 'col-1').map((c) => c.id)).toEqual(['card-a', 'card-b']);
    expect(cardsIn(base(), 'col-2')).toEqual([]);
  });

  // CLAUDE.md: if two ranks collide, break the tie on createdAt then id.
  test('break a rank collision on createdAt, then id', () => {
    const state: BoardState = {
      labels: [],
      columns: base().columns,
      cards: [
        { id: 'z', columnId: 'col-1', title: 'z', rank: 'b0', createdAt: '2026-01-02', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
        { id: 'a', columnId: 'col-1', title: 'a', rank: 'b0', createdAt: '2026-01-01', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
        { id: 'b', columnId: 'col-1', title: 'b', rank: 'b0', createdAt: '2026-01-01', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
      ],
    };
    expect(cardsIn(state, 'col-1').map((c) => c.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('card actions', () => {
  test('create adds a card', () => {
    const card = {
      id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: '2026-02-01',
      dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, pending: true,
    };
    const next = boardReducer(base(), { type: 'card.create', card });
    expect(cardsIn(next, 'col-2')).toEqual([card]);
  });

  test('rename changes only the title', () => {
    const next = boardReducer(base(), { type: 'card.rename', cardId: 'card-a', title: 'Renamed' });
    expect(next.cards.find((c) => c.id === 'card-a')).toMatchObject({
      title: 'Renamed', columnId: 'col-1', rank: 'b0',
    });
  });

  test('delete removes the card and leaves the rest alone', () => {
    const next = boardReducer(base(), { type: 'card.delete', cardId: 'card-a' });
    expect(next.cards.map((c) => c.id)).toEqual(['card-b']);
  });

  test('move sets the column and the rank', () => {
    const next = boardReducer(base(), {
      type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'd0',
    });
    expect(next.cards.find((c) => c.id === 'card-a')).toMatchObject({
      columnId: 'col-2', rank: 'd0',
    });
  });

  // A card holding a temp id has no server row yet; settling swaps in the real
  // id and rank so a later move does not name an id the server has never seen.
  test('settle swaps the temp id for the real one and clears pending', () => {
    const withTemp = boardReducer(base(), {
      type: 'card.create',
      card: { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, pending: true },
    });

    const next = boardReducer(withTemp, { type: 'card.settle', tempId: 'tmp-1', id: 'card-c', rank: 'c9' });

    expect(cardsIn(next, 'col-2')).toEqual([
      { id: 'card-c', columnId: 'col-2', title: 'New', rank: 'c9', createdAt: 'x', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
    ]);
  });
});

describe('card.patch', () => {
  const dated = (): BoardState => ({
    labels: [],
    columns: [{ id: 'col-1', name: 'Ready', rank: 'a0' }],
    cards: [
      {
        id: 'card-1', columnId: 'col-1', title: 'Ship it', rank: 'a0',
        createdAt: '2026-08-31T00:00:00.000Z', dueDate: '2026-09-10', labelIds: [], attachmentCount: 0, descriptionPreview: null,
      },
    ],
  });

  test('sets the title alone, leaving the due date untouched', () => {
    const next = boardReducer(dated(), { type: 'card.patch', cardId: 'card-1', title: 'Shipped' });
    expect(next.cards[0]).toMatchObject({ title: 'Shipped', dueDate: '2026-09-10' });
  });

  test('sets the due date alone, leaving the title untouched', () => {
    const next = boardReducer(dated(), { type: 'card.patch', cardId: 'card-1', dueDate: null });
    expect(next.cards[0]).toMatchObject({ title: 'Ship it', dueDate: null });
  });

  // An absent key and an explicit null mean different things: one says "leave
  // it", the other says "clear it". A shallow spread would conflate them.
  test('an absent key is not a null', () => {
    const next = boardReducer(dated(), { type: 'card.patch', cardId: 'card-1', title: 'Shipped' });
    expect(next.cards[0].dueDate).toBe('2026-09-10');
  });

  test('a card that is not there changes nothing', () => {
    expect(boardReducer(dated(), { type: 'card.patch', cardId: 'gone', title: 'x' })).toEqual(dated());
  });

  test('its inverse restores both fields from the pre-state', () => {
    const action: BoardAction = { type: 'card.patch', cardId: 'card-1', title: 'Shipped' };
    const undone = applyAll(boardReducer(dated(), action), inverse(dated(), action));
    expect(undone.cards[0]).toMatchObject({ title: 'Ship it', dueDate: '2026-09-10' });
  });

  test('sets the description preview alone', () => {
    const next = boardReducer(dated(), {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: 'Why this matters',
    });
    expect(next.cards[0]).toMatchObject({
      title: 'Ship it',
      dueDate: '2026-09-10',
      descriptionPreview: 'Why this matters',
    });
  });

  // A rename publishes card.updated too and carries no preview, so an absent
  // key must leave the card face alone rather than blank it.
  test('a patch with no preview key leaves the preview alone', () => {
    const described = boardReducer(dated(), {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: 'Why this matters',
    });
    const renamed = boardReducer(described, {
      type: 'card.patch',
      cardId: 'card-1',
      title: 'Shipped',
    });
    expect(renamed.cards[0].descriptionPreview).toBe('Why this matters');
  });

  test('an emptied description clears the preview', () => {
    const described = boardReducer(dated(), {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: 'Why this matters',
    });
    const cleared = boardReducer(described, {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: null,
    });
    expect(cleared.cards[0].descriptionPreview).toBeNull();
  });

  test('its inverse restores the preview too', () => {
    const described = boardReducer(dated(), {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: 'The old why',
    });
    const action: BoardAction = {
      type: 'card.patch',
      cardId: 'card-1',
      descriptionPreview: 'A new why',
    };
    const undone = applyAll(boardReducer(described, action), inverse(described, action));
    expect(undone.cards[0].descriptionPreview).toBe('The old why');
  });
});

describe('column actions', () => {
  test('create adds a column', () => {
    const column = { id: 'tmp-c', name: 'Blocked', rank: 'a2', pending: true };
    const next = boardReducer(base(), { type: 'column.create', column });
    expect(orderedColumns(next).map((c) => c.id)).toEqual(['col-1', 'col-2', 'tmp-c']);
  });

  test('rename changes only the name', () => {
    const next = boardReducer(base(), { type: 'column.rename', columnId: 'col-2', name: 'Doing' });
    expect(next.columns.find((c) => c.id === 'col-2')).toMatchObject({ name: 'Doing', rank: 'a1' });
  });

  test('move re-ranks one column', () => {
    const next = boardReducer(base(), { type: 'column.move', columnId: 'col-2', rank: 'Zz' });
    expect(orderedColumns(next).map((c) => c.id)).toEqual(['col-2', 'col-1']);
  });

  test('delete moves the cards to the target and drops the column', () => {
    const next = boardReducer(base(), {
      type: 'column.delete',
      columnId: 'col-1',
      targetColumnId: 'col-2',
      moves: [
        { id: 'card-a', rank: 'e0' },
        { id: 'card-b', rank: 'e1' },
      ],
    });

    expect(next.columns.map((c) => c.id)).toEqual(['col-2']);
    expect(cardsIn(next, 'col-2').map((c) => [c.id, c.rank])).toEqual([
      ['card-a', 'e0'],
      ['card-b', 'e1'],
    ]);
  });

  // Positional matching would slide the ranks onto the wrong cards whenever
  // this client's view of the column differs from the sender's — a card still
  // pending being the obvious case.
  test('delete places each card by id, not by position', () => {
    const withPending = boardReducer(base(), {
      type: 'card.create',
      card: {
        id: 'tmp-1', columnId: 'col-1', title: 'Pending', rank: 'b00',
        createdAt: '2026-01-03', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, pending: true,
      },
    });

    const next = boardReducer(withPending, {
      type: 'column.delete',
      columnId: 'col-1',
      targetColumnId: 'col-2',
      moves: [
        { id: 'card-a', rank: 'e0' },
        { id: 'card-b', rank: 'e1' },
      ],
    });

    // The pending card is not in the moves — the sender has never seen it — so
    // it travels on its own rank rather than borrowing card-b's.
    expect(cardsIn(next, 'col-2').map((c) => [c.id, c.rank])).toEqual([
      ['tmp-1', 'b00'],
      ['card-a', 'e0'],
      ['card-b', 'e1'],
    ]);
  });

  test('delete with no target drops an empty column', () => {
    const next = boardReducer(base(), {
      type: 'column.delete', columnId: 'col-2', targetColumnId: null, moves: [],
    });
    expect(next.columns.map((c) => c.id)).toEqual(['col-1']);
  });
});

describe('board.reseed', () => {
  const before = (): BoardState => ({
    labels: [],
    columns: [{ id: 'col-1', name: 'Ready', rank: 'a0' }],
    cards: [],
  });

  test('replaces the whole state', () => {
    const after: BoardState = {
      labels: [],
      columns: [{ id: 'col-2', name: 'Doing', rank: 'a1' }],
      cards: [],
    };
    expect(boardReducer(before(), { type: 'board.reseed', state: after })).toEqual(after);
  });

  test('its inverse restores the state it replaced', () => {
    const action: BoardAction = { type: 'board.reseed', state: { labels: [], columns: [], cards: [] } };
    expect(applyAll(boardReducer(before(), action), inverse(before(), action))).toEqual(before());
  });
});

describe('inverses', () => {
  // Compared through the selectors, not with toEqual on the state: raw array
  // position carries no meaning here — orderedColumns and cardsIn both sort by
  // rank, and an inverse restores an entity's identity, not its array slot.
  const rendered = (state: BoardState) =>
    orderedColumns(state).map((column) => [column, cardsIn(state, column.id)] as const);

  const restoresTheBoard = (action: BoardAction) => {
    const next = boardReducer(base(), action);
    expect(rendered(applyAll(next, inverse(base(), action)))).toEqual(rendered(base()));
  };

  test('undo a create by deleting it', () => {
    const card = { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, };
    const action = { type: 'card.create', card } as const;

    restoresTheBoard(action);
  });

  test('undo a rename by restoring the old title', () => {
    const action = { type: 'card.rename', cardId: 'card-a', title: 'Renamed' } as const;
    restoresTheBoard(action);
  });

  test('undo a delete by putting the card back', () => {
    const action = { type: 'card.delete', cardId: 'card-a' } as const;
    restoresTheBoard(action);
  });

  test('undo a move by moving it back', () => {
    const action = { type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'z0' } as const;
    restoresTheBoard(action);
  });

  test('undo a column delete by restoring it and every card in it', () => {
    // Annotated rather than `as const`: `as const` makes `moves` readonly,
    // which BoardAction's mutable array does not accept.
    const action: BoardAction = {
      type: 'column.delete',
      columnId: 'col-1',
      targetColumnId: 'col-2',
      moves: [
        { id: 'card-a', rank: 'e0' },
        { id: 'card-b', rank: 'e1' },
      ],
    };
    restoresTheBoard(action);
  });

  test('settling is a reconciliation, so it has no inverse', () => {
    expect(inverse(base(), { type: 'card.settle', tempId: 't', id: 'r', rank: 'x' })).toEqual([]);
  });

  // The reason for inverses rather than a snapshot: reverting must not undo a
  // change that landed while the failed request was still in flight.
  test('an inverse leaves a change that landed in between untouched', () => {
    const failing = { type: 'card.move', cardId: 'card-a', toColumnId: 'col-2', rank: 'z0' } as const;
    const undo = inverse(base(), failing);

    const afterFailing = boardReducer(base(), failing);
    const meanwhile = boardReducer(afterFailing, {
      type: 'card.rename', cardId: 'card-b', title: 'Edited while in flight',
    });

    const reverted = applyAll(meanwhile, undo);

    expect(reverted.cards.find((c) => c.id === 'card-a')).toMatchObject({
      columnId: 'col-1', rank: 'b0',
    });
    expect(reverted.cards.find((c) => c.id === 'card-b')?.title).toBe('Edited while in flight');
  });
});

describe('dropTarget', () => {
  test('dropping on a column with nothing in it appends to it', () => {
    expect(dropTarget(base(), 'card-a', 'col-2')).toEqual({
      toColumnId: 'col-2',
      beforeCardId: null,
      afterCardId: null,
    });
  });

  test('dropping on a card puts the dragged card above it', () => {
    expect(dropTarget(base(), 'card-b', 'card-a')).toEqual({
      toColumnId: 'col-1',
      beforeCardId: null,
      afterCardId: 'card-a',
    });
  });

  // The dragged card is removed from the target list first, so it is never its
  // own neighbour — which would ask the server to rank a card against itself.
  test('never returns the dragged card as its own neighbour', () => {
    const state: BoardState = {
      labels: [],
      columns: base().columns,
      cards: [
        { id: 'k1', columnId: 'col-1', title: '1', rank: 'b0', createdAt: '1', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
        { id: 'k2', columnId: 'col-1', title: '2', rank: 'b1', createdAt: '2', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
        { id: 'k3', columnId: 'col-1', title: '3', rank: 'b2', createdAt: '3', dueDate: null, labelIds: [], attachmentCount: 0, descriptionPreview: null, },
      ],
    };

    const target = dropTarget(state, 'k2', 'k3');

    expect(target).toEqual({ toColumnId: 'col-1', beforeCardId: 'k1', afterCardId: 'k3' });
  });

  test('dropping a card onto a column that already holds cards appends below them', () => {
    const state = boardReducer(base(), {
      type: 'card.move',
      cardId: 'card-b',
      toColumnId: 'col-2',
      rank: 'c0',
    });

    expect(dropTarget(state, 'card-a', 'col-2')).toEqual({
      toColumnId: 'col-2',
      beforeCardId: 'card-b',
      afterCardId: null,
    });
  });

  test('returns null when the drop target is neither a card nor a column', () => {
    expect(dropTarget(base(), 'card-a', 'nowhere')).toBeNull();
  });

  test('returns null when a card is dropped on itself', () => {
    expect(dropTarget(base(), 'card-a', 'card-a')).toBeNull();
  });
});

describe('toBoardState', () => {
  const board = (
    cardLabels: { labelId: string }[],
    labels: { id: string; name: string }[],
    attachments: { id: string }[] = [],
    descriptionPreview: string | null = null,
  ) => ({
    id: 'board-1',
    name: 'Roadmap',
    labels,
    columns: [
      {
        id: 'col-1',
        name: 'Ready to Work',
        rank: 'a0',
        cards: [
          {
            id: 'card-1',
            columnId: 'col-1',
            title: 'Fix the rank tie-break',
            rank: 'a0',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            dueDate: null,
            descriptionPreview,
            cardLabels,
            attachments,
          },
        ],
      },
    ],
  });

  test('a card carries its label ids, in the order the query returned them', () => {
    const state = toBoardState(board([{ labelId: 'l1' }], [{ id: 'l1', name: 'bug' }]));

    expect(state.cards[0].labelIds).toEqual(['l1']);
    expect(state.labels).toEqual([{ id: 'l1', name: 'bug' }]);
  });

  test('a card with no labels carries an empty array, never undefined', () => {
    const state = toBoardState(board([], []));

    expect(state.cards[0].labelIds).toEqual([]);
  });

  test('a card carries the count of its attachments, not the rows', () => {
    // Only the ids are queried: the card face shows a number, and pulling
    // filenames onto the board would be paying for data nothing renders.
    const state = toBoardState(board([], [], [{ id: 'a1' }, { id: 'a2' }]));

    expect(state.cards[0].attachmentCount).toBe(2);
  });

  test('a card with no attachments counts zero, never undefined', () => {
    expect(toBoardState(board([], [])).cards[0].attachmentCount).toBe(0);
  });

  // Already cut to the cap by the query — see lib/boards.ts — so this carries
  // it rather than truncating a second time in a second place.
  test('a card carries the preview the query truncated, and null when there is none', () => {
    expect(toBoardState(board([], [], [], 'Because the ranks disagree.')).cards[0]).toMatchObject({
      descriptionPreview: 'Because the ranks disagree.',
    });
    expect(toBoardState(board([], [])).cards[0].descriptionPreview).toBeNull();
  });
});

describe('attachment actions', () => {
  test('attachment.add increments the count on that card alone', () => {
    const next = boardReducer(base(), { type: 'attachment.add', cardId: 'card-a' });

    expect(next.cards[0].attachmentCount).toBe(1);
    expect(next.cards[1].attachmentCount).toBe(0);
  });

  test('attachment.remove decrements it', () => {
    const state = applyAll(base(), [
      { type: 'attachment.add', cardId: 'card-a' },
      { type: 'attachment.add', cardId: 'card-a' },
      { type: 'attachment.remove', cardId: 'card-a' },
    ]);

    expect(state.cards[0].attachmentCount).toBe(1);
  });

  test('attachment.remove never takes the count below zero', () => {
    // A removal for a card whose count is already zero can arrive after a
    // reseed. Clamping is cheaper than reasoning about ordering.
    const next = boardReducer(base(), { type: 'attachment.remove', cardId: 'card-a' });

    expect(next.cards[0].attachmentCount).toBe(0);
  });

  test('an event for a card this client does not have changes nothing', () => {
    const state = base();
    expect(boardReducer(state, { type: 'attachment.add', cardId: 'gone' }).cards).toEqual(
      state.cards,
    );
  });

  test('neither has an inverse — the count is not a local edit to undo', () => {
    const state = base();
    expect(inverse(state, { type: 'attachment.add', cardId: 'card-a' })).toEqual([]);
    expect(inverse(state, { type: 'attachment.remove', cardId: 'card-a' })).toEqual([]);
  });
});

describe('matchesFilter', () => {
  const card = (labelIds: string[]): StateCard => ({
    id: 'card-1',
    columnId: 'col-1',
    attachmentCount: 0, descriptionPreview: null,
    title: 'Card',
    rank: 'a0',
    createdAt: '2026-09-01T00:00:00.000Z',
    dueDate: null,
    labelIds,
  });

  test('an empty filter matches everything, including an unlabelled card', () => {
    expect(matchesFilter(card([]), [])).toBe(true);
    expect(matchesFilter(card(['l1']), [])).toBe(true);
  });

  // AND, not OR: the job is narrowing a board too full to read.
  test('every selected label must be on the card', () => {
    expect(matchesFilter(card(['l1', 'l2']), ['l1', 'l2'])).toBe(true);
    expect(matchesFilter(card(['l1']), ['l1', 'l2'])).toBe(false);
  });

  test('a card may carry labels the filter did not ask for', () => {
    expect(matchesFilter(card(['l1', 'l2', 'l3']), ['l1'])).toBe(true);
  });

  test('an unlabelled card never survives a populated filter', () => {
    expect(matchesFilter(card([]), ['l1'])).toBe(false);
  });
});

describe('parseLabelFilter', () => {
  const labels = [
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'blocked' },
  ];

  test('reads every repeated label parameter', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=l2'), labels)).toEqual([
      'l1',
      'l2',
    ]);
  });

  // A deleted label, or one from another board, leaves a URL naming an id
  // this board does not have. Ignored, so the board renders unfiltered
  // rather than empty.
  test('drops an id the board has no label for', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=gone'), labels)).toEqual(['l1']);
  });

  test('deduplicates, so a repeated id cannot narrow twice', () => {
    expect(parseLabelFilter(new URLSearchParams('label=l1&label=l1'), labels)).toEqual(['l1']);
  });

  test('no parameter at all is an empty filter', () => {
    expect(parseLabelFilter(new URLSearchParams(''), labels)).toEqual([]);
  });
});

describe('label actions', () => {
  const card = (labelIds: string[]): StateCard => ({
    id: 'card-1',
    columnId: 'col-1',
    attachmentCount: 0, descriptionPreview: null,
    title: 'First',
    rank: 'b0',
    createdAt: '2026-01-01',
    dueDate: null,
    labelIds,
  });

  test('a created label joins the board vocabulary', () => {
    const before: BoardState = { columns: [], labels: [], cards: [] };
    const after = boardReducer(before, {
      type: 'label.create',
      label: { id: 'l1', name: 'bug' },
    });

    expect(after.labels).toEqual([{ id: 'l1', name: 'bug' }]);
  });

  test('a created label lands where a reload would put it, not at the end', () => {
    const before: BoardState = {
      columns: [],
      labels: [
        { id: 'l1', name: 'api' },
        { id: 'l2', name: 'zebra' },
      ],
      cards: [],
    };
    const after = boardReducer(before, {
      type: 'label.create',
      label: { id: 'l3', name: 'Bug' },
    });

    expect(after.labels.map((label) => label.name)).toEqual(['api', 'Bug', 'zebra']);
  });

  test('a renamed label moves to its new place in the order', () => {
    const before: BoardState = {
      columns: [],
      labels: [
        { id: 'l1', name: 'api' },
        { id: 'l2', name: 'zebra' },
      ],
      cards: [],
    };
    const after = boardReducer(before, { type: 'label.rename', labelId: 'l1', name: 'zzz' });

    expect(after.labels.map((label) => label.name)).toEqual(['zebra', 'zzz']);
  });

  test('a deleted label leaves every card that carried it', () => {
    const before: BoardState = {
      columns: [],
      labels: [{ id: 'l1', name: 'bug' }],
      cards: [card(['l1', 'l2'])],
    };
    const after = boardReducer(before, { type: 'label.delete', labelId: 'l1' });

    expect(after.labels).toEqual([]);
    expect(after.cards[0].labelIds).toEqual(['l2']);
  });

  test('a renamed label repaints every card without touching one', () => {
    const before: BoardState = {
      columns: [],
      labels: [{ id: 'l1', name: 'bug' }],
      cards: [card(['l1'])],
    };
    const after = boardReducer(before, { type: 'label.rename', labelId: 'l1', name: 'defect' });

    expect(after.labels).toEqual([{ id: 'l1', name: 'defect' }]);
    expect(after.cards[0]).toBe(before.cards[0]);
  });

  test('card.labels replaces the whole set', () => {
    const before: BoardState = { columns: [], labels: [], cards: [card(['l1'])] };
    const after = boardReducer(before, {
      type: 'card.labels',
      cardId: 'card-1',
      labelIds: ['l2', 'l3'],
    });

    expect(after.cards[0].labelIds).toEqual(['l2', 'l3']);
  });
});

describe('sameDropTarget', () => {
  const target = { toColumnId: 'c1', beforeCardId: 'a', afterCardId: 'b' };

  test('two nulls are the same target', () => {
    expect(sameDropTarget(null, null)).toBe(true);
  });

  test('a target and null are different', () => {
    expect(sameDropTarget(target, null)).toBe(false);
    expect(sameDropTarget(null, target)).toBe(false);
  });

  test('equal fields are the same target, even as separate objects', () => {
    expect(sameDropTarget(target, { ...target })).toBe(true);
  });

  test('a different column is a different target', () => {
    expect(sameDropTarget(target, { ...target, toColumnId: 'c2' })).toBe(false);
  });

  // The two neighbour fields are what place the line, so a change in either
  // has to re-render even when the column has not changed.
  test('a different neighbour is a different target', () => {
    expect(sameDropTarget(target, { ...target, beforeCardId: 'z' })).toBe(false);
    expect(sameDropTarget(target, { ...target, afterCardId: null })).toBe(false);
  });
});
