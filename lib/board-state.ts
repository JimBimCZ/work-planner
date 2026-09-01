import { toDateInputValue } from '@/lib/due';
// import type, not import: lib/boards imports lib/db, which builds a pg pool
// at module scope, and this module is in the client bundle.
import type { BoardWithCards } from '@/lib/boards';
import type { BoardLabel } from '@/lib/labels';

export type StateCard = {
  id: string;
  columnId: string;
  title: string;
  rank: string;
  createdAt: string;
  dueDate: string | null;
  labelIds: string[];
  pending?: boolean;
};

export type StateColumn = { id: string; name: string; rank: string; pending?: boolean };

export type BoardState = { columns: StateColumn[]; cards: StateCard[]; labels: BoardLabel[] };

// The initial render and a reconnect's catch-up build the same shape from the
// same code, so the two can never disagree about dates or ordering.
export function toBoardState(board: BoardWithCards): BoardState {
  return {
    labels: board.labels,
    columns: board.columns.map(({ id, name, rank }) => ({ id, name, rank })),
    cards: board.columns.flatMap((column) =>
      column.cards.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        title: card.title,
        rank: card.rank,
        createdAt: card.createdAt.toISOString(),
        dueDate: card.dueDate ? toDateInputValue(card.dueDate) : null,
        labelIds: card.cardLabels.map((assignment) => assignment.labelId),
      })),
    ),
  };
}

export type BoardAction =
  | { type: 'card.create'; card: StateCard }
  | { type: 'card.rename'; cardId: string; title: string }
  | { type: 'card.patch'; cardId: string; title?: string; dueDate?: string | null }
  | { type: 'card.delete'; cardId: string }
  | { type: 'card.move'; cardId: string; toColumnId: string; rank: string }
  | { type: 'card.settle'; tempId: string; id: string; rank: string }
  | { type: 'column.create'; column: StateColumn }
  | { type: 'column.rename'; columnId: string; name: string }
  | { type: 'column.move'; columnId: string; rank: string }
  | {
      type: 'column.delete';
      columnId: string;
      targetColumnId: string | null;
      // Keyed by card id rather than by position: a remote delete carries the
      // ranks the server assigned, and this client's own list of that column
      // can differ from the server's — a card still pending, say — which would
      // slide every rank onto the wrong card.
      moves: { id: string; rank: string }[];
    }
  | { type: 'column.settle'; tempId: string; id: string; rank: string }
  | { type: 'board.reseed'; state: BoardState };

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

    // An absent key leaves the field alone; an explicit null clears it. Those
    // are different instructions, so neither is spread in blindly.
    case 'card.patch':
      return mapCard(state, action.cardId, (card) => ({
        ...card,
        ...(action.title !== undefined ? { title: action.title } : {}),
        ...(action.dueDate !== undefined ? { dueDate: action.dueDate } : {}),
      }));

    case 'card.delete':
      return { ...state, cards: state.cards.filter((card) => card.id !== action.cardId) };

    case 'card.move':
      return mapCard(state, action.cardId, (card) => ({
        ...card,
        columnId: action.toColumnId,
        rank: action.rank,
      }));

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
      const { columnId, targetColumnId } = action;
      const ranks = new Map(action.moves.map((move) => [move.id, move.rank]));

      return {
        ...state,
        columns: state.columns.filter((column) => column.id !== columnId),
        // Membership comes from the column, the new rank from the card's id. A
        // card in the column that the moves do not name is one the sender had
        // never heard of — a create still in flight — so it travels too, keeping
        // the rank it has rather than being left on a column that is now gone.
        cards: state.cards.map((card) =>
          card.columnId === columnId && targetColumnId
            ? { ...card, columnId: targetColumnId, rank: ranks.get(card.id) ?? card.rank }
            : card,
        ),
      };
    }

    case 'board.reseed':
      return action.state;

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

    case 'card.patch': {
      const card = state.cards.find((c) => c.id === action.cardId);
      if (!card) return [];
      return [
        { type: 'card.patch', cardId: action.cardId, title: card.title, dueDate: card.dueDate },
      ];
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


    case 'column.create':
      return [
        { type: 'column.delete', columnId: action.column.id, targetColumnId: null, moves: [] },
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

    // The whole board is replaced, so the whole board is what restores it.
    case 'board.reseed':
      return [{ type: 'board.reseed', state }];

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
