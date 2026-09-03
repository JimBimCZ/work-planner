import { describe, expect, test, vi } from 'vitest';

import { ACTIVITY_PER_BOARD } from './activity-limits';

const findMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db', () => ({
  db: { query: { activity: { findMany: (...a: unknown[]) => findMany(...a) } } },
}));

const { boardActivity, describeActivity } = await import('./activity');
type ActivityEntry = import('./activity').ActivityEntry;

const base: ActivityEntry = {
  id: 'a1',
  type: 'card.created',
  subjectId: 'card-1',
  subject: 'Ship it',
  detail: 'In Progress',
  createdAt: new Date('2026-09-03T10:00:00.000Z'),
  actor: { id: 'u1', name: 'Vit', image: null },
  subjectName: null,
};

describe('describeActivity', () => {
  test('names the card and the column it landed in', () => {
    expect(describeActivity(base)).toBe('added Ship it to In Progress');
  });

  test('a move names the destination', () => {
    expect(describeActivity({ ...base, type: 'card.moved', detail: 'In Review' })).toBe(
      'moved Ship it to In Review',
    );
  });

  test('a deletion still names what was deleted', () => {
    expect(describeActivity({ ...base, type: 'card.deleted', detail: null })).toBe(
      'deleted Ship it',
    );
  });

  test('a column deletion says where its cards went', () => {
    expect(
      describeActivity({ ...base, type: 'column.deleted', subject: 'Blocked', detail: 'Backlog' }),
    ).toBe('deleted the column Blocked and moved its cards to Backlog');
  });

  // The rule that keeps the erasure promise: a member entry carries no stored
  // name, so a deleted account degrades to "a member" rather than lingering.
  test('a member entry reads its name from the join, not from the row', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.removed',
        subject: null,
        detail: null,
        subjectName: 'Alice',
      }),
    ).toBe('removed Alice from the board');
  });

  test('and falls back when that member is gone', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.removed',
        subject: null,
        detail: null,
        subjectName: null,
      }),
    ).toBe('removed a member from the board');
  });

  test('a role change names the role', () => {
    expect(
      describeActivity({
        ...base,
        type: 'member.role_changed',
        subject: null,
        detail: 'viewer',
        subjectName: 'Alice',
      }),
    ).toBe('made Alice a viewer');
  });
});

test('boardActivity asks for the newest entries and joins the actor', async () => {
  await boardActivity('b1');

  const config = findMany.mock.calls[0][0] as { limit: number; with: Record<string, unknown> };
  expect(config.limit).toBe(ACTIVITY_PER_BOARD);
  expect(config.with).toHaveProperty('actor');
});
