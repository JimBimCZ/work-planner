import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DESCRIPTION_PREVIEW_MAX } from '@/lib/cards-limits';
import { attachments, cards } from '@/lib/db/schema';

let boardRow: unknown;
const findFirst = vi.fn(async (config: unknown) => {
  void config;
  return boardRow;
});

vi.mock('@/lib/db', () => ({ db: { query: { boards: { findFirst: (config: unknown) => findFirst(config) } } } }));

const { getBoardWithColumns } = await import('./boards');

type CardsRelationConfig = {
  columns: Record<string, boolean>;
  extras: CardsExtras;
  orderBy: (card: typeof cards, helpers: { asc: (column: unknown) => unknown }) => unknown[];
  with: {
    attachments: {
      columns: Record<string, boolean>;
      where: (
        row: typeof attachments,
        helpers: { eq: (column: unknown, value: unknown) => unknown },
      ) => unknown;
    };
  };
};

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => { as: (alias: string) => unknown };

type CardsExtras = (
  fields: typeof cards,
  operators: { sql: SqlTag },
) => Record<string, unknown>;

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

  test("asks for each card's attachment ids and nothing else", async () => {
    // The card face shows a count. Pulling filenames onto every card of a
    // board would be paying for data nothing renders.
    await getBoardWithColumns('shape-check');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;

    expect(config.with.columns.with.cards.with.attachments.columns).toEqual({ id: true });
  });

  test('counts only ready attachments, never pending ones', async () => {
    // The one line in this query that can be quietly wrong: a where that does
    // not apply would raise a count on every other member's screen for an
    // upload that may never land.
    await getBoardWithColumns('shape-check');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;
    const eq = vi.fn((column: unknown, value: unknown) => ({ column, value }));

    expect(config.with.columns.with.cards.with.attachments.where(attachments, { eq })).toEqual({
      column: attachments.status,
      value: 'ready',
    });
  });

  test('truncates the description in SQL rather than selecting the whole thing', async () => {
    // The card face shows two clamped lines. Selecting a 10,000-character
    // column for every card of a board would put the full text in the RSC
    // payload to render a hundred and forty of it — and the columns assertion
    // above is the other half of this rule.
    await getBoardWithColumns('shape-check');

    const config = findFirst.mock.calls[0][0] as FindFirstConfig;
    const seen: { values: unknown[]; alias: string }[] = [];
    const sql: SqlTag = (_strings, ...values) => ({
      as: (alias: string) => {
        seen.push({ values, alias });
        return { values, alias };
      },
    });

    const extras = config.with.columns.with.cards.extras(cards, { sql });

    expect(Object.keys(extras)).toEqual(['descriptionPreview']);
    expect(seen[0].values).toContain(cards.description);
    expect(seen[0].values).toContain(DESCRIPTION_PREVIEW_MAX);
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
