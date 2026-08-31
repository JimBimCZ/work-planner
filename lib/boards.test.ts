import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cards } from '@/lib/db/schema';

let boardRow: unknown;
const findFirst = vi.fn(async (config: unknown) => {
  void config;
  return boardRow;
});

vi.mock('@/lib/db', () => ({ db: { query: { boards: { findFirst: (config: unknown) => findFirst(config) } } } }));

const { getBoardWithColumns } = await import('./boards');

type CardsRelationConfig = {
  columns: Record<string, boolean>;
  orderBy: (card: typeof cards, helpers: { asc: (column: unknown) => unknown }) => unknown[];
};

type FindFirstConfig = { with: { columns: { with: { cards: CardsRelationConfig } } } };

beforeEach(() => {
  boardRow = undefined;
  findFirst.mockClear();
});

describe('getBoardWithColumns', () => {
  test('returns null for a board that is not there', async () => {
    await expect(getBoardWithColumns('missing')).resolves.toBeNull();
  });

  test('asks for cards nested under their column', async () => {
    boardRow = {
      id: 'b1',
      name: 'Roadmap',
      columns: [
        {
          id: 'c1',
          name: 'Ready to Work',
          rank: 'a0',
          cards: [
            { id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: new Date(0) },
          ],
        },
      ],
    };

    const board = await getBoardWithColumns('b1');

    expect(board?.columns[0].cards).toEqual([
      { id: 'k1', columnId: 'c1', title: 'Ship it', rank: 'a0', createdAt: new Date(0) },
    ]);
  });

  test('gives a column with no cards an empty array, not undefined', async () => {
    boardRow = { id: 'b1', name: 'Roadmap', columns: [{ id: 'c1', name: 'Done', rank: 'a1', cards: [] }] };

    const board = await getBoardWithColumns('b1');

    expect(board?.columns[0].cards).toEqual([]);
  });

  test("requests each column's cards, selecting the fields the row needs", async () => {
    await getBoardWithColumns('shape-check');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;

    expect(config.with.columns.with.cards.columns).toEqual({
      id: true,
      columnId: true,
      title: true,
      rank: true,
      createdAt: true,
      dueDate: true,
    });
  });

  test('orders cards by rank, then createdAt, then id', async () => {
    await getBoardWithColumns('order-check');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;
    const asc = vi.fn((column: unknown) => column);

    expect(config.with.columns.with.cards.orderBy(cards, { asc })).toEqual([
      cards.rank,
      cards.createdAt,
      cards.id,
    ]);
  });
});
