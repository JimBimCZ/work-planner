import { beforeEach, expect, test, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { query: { labels: { findMany: (args: unknown) => findMany(args) } } },
}));

const { LABELS_PER_BOARD, LABEL_NAME_MAX, boardLabels } = await import('./labels');

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
  const [args] = findMany.mock.calls[0] as [{ columns: Record<string, boolean> }];
  expect(args.columns).toEqual({ id: true, name: true });
  expect(findMany).toHaveBeenCalledTimes(1);
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
