export type StateCard = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: string;
  dueDate: string | null;
  pending?: boolean;
};

export type StateColumn = { id: string; name: string; rank: string; pending?: boolean };

export type BoardState = { columns: StateColumn[]; cards: StateCard[] };

export type BoardAction =
  | { type: 'card.create'; card: StateCard }
  | { type: 'card.rename'; cardId: string; title: string }
  | { type: 'card.delete'; cardId: string }
  | { type: 'card.move'; cardId: string; toColumnId: string; rank: string }
  | { type: 'card.setDueDate'; cardId: string; dueDate: string | null }
  | { type: 'card.settle'; tempId: string; id: string; rank: string }
  | { type: 'column.create'; column: StateColumn }
  | { type: 'column.rename'; columnId: string; name: string }
  | { type: 'column.move'; columnId: string; rank: string }
  | { type: 'column.delete'; columnId: string; targetColumnId: string | null; ranks: string[] }
  | { type: 'column.settle'; tempId: string; id: string; rank: string };

const byRank = <T extends { rank: string; id: string }>(a: T, b: T) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function orderedColumns(state: BoardState): StateColumn[] {
  return [...state.columns].sort(byRank);
}

export function cardsIn(state: BoardState, columnId: string): StateCard[] {
  return state.cards
    .filter((card) => card.columnId === columnId)
    .sort((a, b) =>
      a.rank !== b.rank
        ? byRank(a, b)
        : a.createdAt !== b.createdAt
          ? a.createdAt < b.createdAt
            ? -1
            : 1
          : byRank(a, b),
    );
}

const mapCard = (state: BoardState, cardId: string, change: (card: StateCard) => StateCard) => ({
  ...state,
  cards: state.cards.map((card) => (card.id === cardId ? change(card) : card)),
});

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'card.create':
      return { ...state, cards: [...state.cards, action.card] };

    case 'card.rename':
      return mapCard(state, action.cardId, (card) => ({ ...card, title: action.title }));

    case 'card.delete':
      return { ...state, cards: state.cards.filter((card) => card.id !== action.cardId) };

    case 'card.move':
      return mapCard(state, action.cardId, (card) => ({
        ...card,
        columnId: action.toColumnId,
        rank: action.rank,
      }));

    case 'card.setDueDate':
      return mapCard(state, action.cardId, (card) => ({ ...card, dueDate: action.dueDate }));

    case 'card.settle':
      return mapCard(state, action.tempId, ({ pending: _pending, ...card }) => ({
        ...card,
        id: action.id,
        rank: action.rank,
      }));

    case 'column.create':
      return { ...state, columns: [...state.columns, action.column] };

    case 'column.rename':
      return {
        ...state,
        columns: state.columns.map((column) =>
          column.id === action.columnId ? { ...column, name: action.name } : column,
        ),
      };

    case 'column.move':
      return {
        ...state,
        columns: state.columns.map((column) =>
          column.id === action.columnId ? { ...column, rank: action.rank } : column,
        ),
      };

    case 'column.delete': {
      const moving = cardsIn(state, action.columnId);
      const ranks = new Map(moving.map((card, position) => [card.id, action.ranks[position]]));

      return {
        columns: state.columns.filter((column) => column.id !== action.columnId),
        cards: state.cards.map((card) =>
          ranks.has(card.id) && action.targetColumnId
            ? { ...card, columnId: action.targetColumnId, rank: ranks.get(card.id) ?? card.rank }
            : card,
        ),
      };
    }

    case 'column.settle':
      return {
        ...state,
        columns: state.columns.map(({ pending: _pending, ...column }) =>
          column.id === action.tempId ? { ...column, id: action.id, rank: action.rank } : column,
        ),
        cards: state.cards.map((card) =>
          card.columnId === action.tempId ? { ...card, columnId: action.id } : card,
        ),
      };
  }
}

export function applyAll(state: BoardState, actions: BoardAction[]): BoardState {
  return actions.reduce(boardReducer, state);
}

// Computed from the state BEFORE the action is applied. An array, because
// undoing a column delete means restoring the column and every card in it.
export function inverse(state: BoardState, action: BoardAction): BoardAction[] {
  switch (action.type) {
    case 'card.create':
      return [{ type: 'card.delete', cardId: action.card.id }];

    case 'card.rename': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.rename', cardId: card.id, title: card.title }] : [];
    }

    case 'card.delete': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.create', card }] : [];
    }

    case 'card.move': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card
        ? [{ type: 'card.move', cardId: card.id, toColumnId: card.columnId, rank: card.rank }]
        : [];
    }

    case 'card.setDueDate': {
      const card = state.cards.find((c) => c.id === action.cardId);
      return card ? [{ type: 'card.setDueDate', cardId: card.id, dueDate: card.dueDate }] : [];
    }

    case 'column.create':
      return [
        { type: 'column.delete', columnId: action.column.id, targetColumnId: null, ranks: [] },
      ];

    case 'column.rename': {
      const column = state.columns.find((c) => c.id === action.columnId);
      return column ? [{ type: 'column.rename', columnId: column.id, name: column.name }] : [];
    }

    case 'column.move': {
      const column = state.columns.find((c) => c.id === action.columnId);
      return column ? [{ type: 'column.move', columnId: column.id, rank: column.rank }] : [];
    }

    case 'column.delete': {
      const column = state.columns.find((c) => c.id === action.columnId);
      if (!column) return [];
      return [
        { type: 'column.create', column },
        ...cardsIn(state, action.columnId).map(
          (card): BoardAction => ({
            type: 'card.move',
            cardId: card.id,
            toColumnId: card.columnId,
            rank: card.rank,
          }),
        ),
      ];
    }

    case 'card.settle':
    case 'column.settle':
      return [];
  }
}

// The hardest part of a drag, kept pure and out of the component so it is
// testable without a browser: onDragEnd becomes three lines that call this.
// The dragged card is removed from the target list before neighbours are read,
// so it is never its own neighbour — which would ask the server to rank a card
// against itself.
export function dropTarget(
  state: BoardState,
  activeId: string,
  overId: string,
): { toColumnId: string; beforeCardId: string | null; afterCardId: string | null } | null {
  if (activeId === overId) return null;

  const overCard = state.cards.find((card) => card.id === overId);
  const toColumnId = overCard?.columnId ?? state.columns.find((c) => c.id === overId)?.id;
  if (!toColumnId) return null;

  const siblings = cardsIn(state, toColumnId).filter((card) => card.id !== activeId);
  const position = overCard
    ? siblings.findIndex((card) => card.id === overCard.id)
    : siblings.length;

  return {
    toColumnId,
    beforeCardId: siblings[position - 1]?.id ?? null,
    afterCardId: siblings[position]?.id ?? null,
  };
}
