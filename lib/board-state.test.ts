import { describe, expect, test } from 'vitest';

import {
  applyAll,
  boardReducer,
  cardsIn,
  dropTarget,
  inverse,
  orderedColumns,
  type BoardAction,
  type BoardState,
} from './board-state';

const base = (): BoardState => ({
  columns: [
    { id: 'col-1', name: 'Ready to Work', rank: 'a0' },
    { id: 'col-2', name: 'In Progress', rank: 'a1' },
  ],
  cards: [
    { id: 'card-a', columnId: 'col-1', title: 'First', rank: 'b0', createdAt: '2026-01-01', dueDate: null },
    { id: 'card-b', columnId: 'col-1', title: 'Second', rank: 'b1', createdAt: '2026-01-02', dueDate: null },
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
      columns: base().columns,
      cards: [
        { id: 'z', columnId: 'col-1', title: 'z', rank: 'b0', createdAt: '2026-01-02', dueDate: null },
        { id: 'a', columnId: 'col-1', title: 'a', rank: 'b0', createdAt: '2026-01-01', dueDate: null },
        { id: 'b', columnId: 'col-1', title: 'b', rank: 'b0', createdAt: '2026-01-01', dueDate: null },
      ],
    };
    expect(cardsIn(state, 'col-1').map((c) => c.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('card actions', () => {
  test('create adds a card', () => {
    const card = {
      id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: '2026-02-01',
      dueDate: null, pending: true,
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
      card: { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x', dueDate: null, pending: true },
    });

    const next = boardReducer(withTemp, { type: 'card.settle', tempId: 'tmp-1', id: 'card-c', rank: 'c9' });

    expect(cardsIn(next, 'col-2')).toEqual([
      { id: 'card-c', columnId: 'col-2', title: 'New', rank: 'c9', createdAt: 'x', dueDate: null },
    ]);
  });
});

describe('card.setDueDate', () => {
  const seeded = {
    columns: [{ id: 'c1', name: 'Ready to Work', rank: 'a0' }],
    cards: [{ id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: '', dueDate: null }],
  };

  test('sets the date on the named card', () => {
    const next = boardReducer(seeded, {
      type: 'card.setDueDate',
      cardId: 'k1',
      dueDate: '2026-09-01',
    });
    expect(next.cards[0].dueDate).toBe('2026-09-01');
  });

  test('inverts back to what was there before, including null', () => {
    const undo = inverse(seeded, { type: 'card.setDueDate', cardId: 'k1', dueDate: '2026-09-01' });
    expect(undo).toEqual([{ type: 'card.setDueDate', cardId: 'k1', dueDate: null }]);
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
      type: 'column.delete', columnId: 'col-1', targetColumnId: 'col-2', ranks: ['e0', 'e1'],
    });

    expect(next.columns.map((c) => c.id)).toEqual(['col-2']);
    expect(cardsIn(next, 'col-2').map((c) => [c.id, c.rank])).toEqual([
      ['card-a', 'e0'],
      ['card-b', 'e1'],
    ]);
  });

  test('delete with no target drops an empty column', () => {
    const next = boardReducer(base(), {
      type: 'column.delete', columnId: 'col-2', targetColumnId: null, ranks: [],
    });
    expect(next.columns.map((c) => c.id)).toEqual(['col-1']);
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
    const card = { id: 'tmp-1', columnId: 'col-2', title: 'New', rank: 'c0', createdAt: 'x', dueDate: null };
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
    // Annotated rather than `as const`: `as const` makes `ranks` a readonly
    // tuple, which BoardAction's mutable string[] does not accept.
    const action: BoardAction = {
      type: 'column.delete',
      columnId: 'col-1',
      targetColumnId: 'col-2',
      ranks: ['e0', 'e1'],
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
      columns: base().columns,
      cards: [
        { id: 'k1', columnId: 'col-1', title: '1', rank: 'b0', createdAt: '1', dueDate: null },
        { id: 'k2', columnId: 'col-1', title: '2', rank: 'b1', createdAt: '2', dueDate: null },
        { id: 'k3', columnId: 'col-1', title: '3', rank: 'b2', createdAt: '3', dueDate: null },
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
