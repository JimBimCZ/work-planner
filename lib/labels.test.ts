import { beforeEach, expect, test, vi } from 'vitest';

type EqCall = ['eq', unknown, unknown];
type AscCall = ['asc', unknown];
type SqlExpr = { strings: readonly string[]; values: unknown[] };
type WhereHelpers = { eq: (column: unknown, value: unknown) => EqCall };
type OrderHelpers = {
  asc: (expr: unknown) => AscCall;
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => SqlExpr;
};
type Config = {
  columns: Record<string, boolean>;
  where: (cols: Record<string, string>, helpers: WhereHelpers) => unknown;
  orderBy: (cols: Record<string, string>, helpers: OrderHelpers) => unknown[];
};

const findMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: { labels: { findMany: (args: unknown) => findMany(args) } } },
}));

const { LABELS_PER_BOARD, LABEL_NAME_MAX, boardLabels } = await import('./labels');

// Stub column identifiers, the same role `table` plays in members.test.ts:
// the callback under test only needs to see *some* value per column name.
const cols = { boardId: 'boardId', name: 'name' };

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

test('the caps are the numbers the payload maths depends on', () => {
  expect(LABEL_NAME_MAX).toBe(32);
  // 50 ids at 36 bytes is roughly 1.8KB, well under PAYLOAD_CEILING's 8192.
  expect(LABELS_PER_BOARD).toBe(50);
});

test('reads only this board, and only id and name', async () => {
  await boardLabels('board-1');
  const [args] = findMany.mock.calls[0] as [Config];
  expect(args.columns).toEqual({ id: true, name: true });
  expect(findMany).toHaveBeenCalledTimes(1);

  const eq = vi.fn((column: unknown, value: unknown): EqCall => ['eq', column, value]);
  const clause = args.where(cols, { eq });
  expect(eq).toHaveBeenCalledWith('boardId', 'board-1');
  expect(clause).toEqual(['eq', 'boardId', 'board-1']);
});

test('orders case-folded by name, not the bare column', async () => {
  await boardLabels('board-1');
  const [args] = findMany.mock.calls[0] as [Config];

  const asc = vi.fn((expr: unknown): AscCall => ['asc', expr]);
  const sql = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]): SqlExpr => ({
      strings: [...strings],
      values,
    }),
  );
  const [orderExpr] = args.orderBy(cols, { asc, sql });

  expect(sql).toHaveBeenCalledTimes(1);
  expect(orderExpr).toEqual(['asc', { strings: ['lower(', ')'], values: ['name'] }]);
});

test('hands back what the query returned, unchanged', async () => {
  findMany.mockResolvedValue([
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'chore' },
  ]);
  await expect(boardLabels('board-1')).resolves.toEqual([
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'chore' },
  ]);
});
