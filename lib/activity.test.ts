import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ACTIVITY_PER_BOARD } from './activity-limits';

// desc() is called directly inside boardActivity's orderBy callback (not
// handed in as a query-builder helper the way eq/inArray are), so proving it
// orders by createdAt descending means spying on the real export.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, desc: vi.fn((column: unknown) => ({ desc: column })) };
});

const { desc } = await import('drizzle-orm');

type EqHelper = { eq: (column: unknown, value: unknown) => unknown };
type InArrayHelper = { inArray: (column: unknown, values: unknown[]) => unknown };

type ActivityQueryConfig = {
  where: (a: { boardId: string }, helpers: EqHelper) => unknown;
  orderBy: (a: { createdAt: string }) => unknown[];
  limit: number;
  with: Record<string, unknown>;
};

type UsersQueryConfig = {
  where: (u: { id: string }, helpers: InArrayHelper) => unknown;
  columns: Record<string, unknown>;
};

let activityCaptured: ActivityQueryConfig | null = null;
let activityRows: unknown[] = [];
const findMany = vi.fn(async (config: ActivityQueryConfig) => {
  activityCaptured = config;
  return activityRows;
});

let usersCaptured: UsersQueryConfig | null = null;
let userRows: unknown[] = [];
const findUsers = vi.fn(async (config: UsersQueryConfig) => {
  usersCaptured = config;
  return userRows;
});

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      activity: { findMany: (config: ActivityQueryConfig) => findMany(config) },
      users: { findMany: (config: UsersQueryConfig) => findUsers(config) },
    },
  },
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

// A member.* row as boardActivity reads it off the wire: no stored subject
// name, only a subjectId for the join to resolve.
const memberRemovedRow = {
  id: 'a2',
  type: 'member.removed',
  subjectId: 'user-2',
  subject: null,
  detail: null,
  createdAt: new Date('2026-09-03T11:00:00.000Z'),
  actor: { id: 'u1', name: 'Vit', image: null },
};

beforeEach(() => {
  activityCaptured = null;
  activityRows = [];
  usersCaptured = null;
  userRows = [];
  findMany.mockClear();
  findUsers.mockClear();
  vi.mocked(desc).mockClear();
});

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

  expect(activityCaptured?.limit).toBe(ACTIVITY_PER_BOARD);
  expect(activityCaptured?.with).toHaveProperty('actor');
});

// findMany captures its config but never invokes where/orderBy itself, so the
// tests above never actually exercised those callbacks — a dropped or
// inverted eq(a.boardId, boardId) would have stayed green. Invoking the
// captured callbacks here is what would fail if that clause regressed.
test('boardActivity filters by the given board and orders newest first', async () => {
  await boardActivity('b1');

  const eq = vi.fn((column: unknown, value: unknown) => ({ column, value }));
  const whereClause = activityCaptured?.where({ boardId: 'boardId-column' }, { eq });
  expect(eq).toHaveBeenCalledWith('boardId-column', 'b1');
  expect(whereClause).toEqual({ column: 'boardId-column', value: 'b1' });

  const orderClause = activityCaptured?.orderBy({ createdAt: 'createdAt-column' });
  expect(desc).toHaveBeenCalledWith('createdAt-column');
  expect(orderClause).toEqual([{ desc: 'createdAt-column' }]);
});

// Same gap, on the subject-name join: findUsers stubbed to return rows
// regardless of its filter would leave a dropped or inverted inArray
// invisible to every other test here.
test('boardActivity resolves member subjects through inArray on the ids it collected', async () => {
  activityRows = [memberRemovedRow];
  userRows = [{ id: 'user-2', name: 'Alice' }];

  await boardActivity('b1');

  const inArray = vi.fn((column: unknown, values: unknown[]) => ({ column, values }));
  const whereClause = usersCaptured?.where({ id: 'id-column' }, { inArray });
  expect(inArray).toHaveBeenCalledWith('id-column', ['user-2']);
  expect(whereClause).toEqual({ column: 'id-column', values: ['user-2'] });
});

test('resolves a member subject name through the users join when the account still exists', async () => {
  activityRows = [memberRemovedRow];
  userRows = [{ id: 'user-2', name: 'Alice' }];

  const lines = await boardActivity('b1');

  expect(lines[0].sentence).toBe('removed Alice from the board');
});

// The erasure promise itself: this is the assertion that fails loudest if the
// join or its fallback regresses — an inverted `??`, or filtering the wrong
// field before `inArray`, would leak a name /privacy says should be gone.
test('degrades to "a member" when the subject account no longer exists', async () => {
  activityRows = [memberRemovedRow];
  userRows = [];

  const lines = await boardActivity('b1');

  expect(lines[0].sentence).toBe('removed a member from the board');
});
