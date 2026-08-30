import { beforeEach, describe, expect, test, vi } from 'vitest';

let boardRow: unknown;
const findFirst = vi.fn(async () => boardRow);

vi.mock('@/lib/db', () => ({ db: { query: { boards: { findFirst: () => findFirst() } } } }));

const { getBoardWithColumns } = await import('./boards');

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
});
