import { beforeEach, describe, expect, test, vi } from 'vitest';

type Op = { kind: 'insert' | 'delete'; table: string; values?: Record<string, unknown> };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

const tx = {
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
      return { then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)) };
    },
  }),
  delete: (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table: tableName(table) });
    },
  }),
};

vi.mock('@/lib/db', () => ({ db: {} }));

const { recordActivity } = await import('./scope');
const { ACTIVITY_SUBJECT_MAX } = await import('@/lib/activity-limits');

beforeEach(() => {
  ops.length = 0;
});

describe('recordActivity', () => {
  test('writes one entry, then trims the board', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, {
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subjectId: 'card-1',
      subject: 'Ship it',
      detail: 'In Progress',
    });

    expect(ops.map((op) => `${op.kind} ${op.table}`)).toEqual([
      'insert activity',
      'delete activity',
    ]);
    expect(ops[0].values).toMatchObject({
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subjectId: 'card-1',
      subject: 'Ship it',
      detail: 'In Progress',
    });
  });

  test('caps the stored subject', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, {
      boardId: 'b1',
      actorId: 'u1',
      type: 'card.created',
      subject: 'x'.repeat(ACTIVITY_SUBJECT_MAX + 40),
    });

    expect((ops[0].values?.subject as string).length).toBe(ACTIVITY_SUBJECT_MAX);
  });

  test('defaults the three optional columns to null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake tx is structural
    await recordActivity(tx as any, { boardId: 'b1', actorId: 'u1', type: 'member.joined' });

    expect(ops[0].values).toMatchObject({ subjectId: null, subject: null, detail: null });
  });
});
