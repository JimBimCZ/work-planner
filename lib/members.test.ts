import { beforeEach, describe, expect, test, vi } from 'vitest';

type Clause = unknown[];
type Helpers = {
  and: (...parts: Clause[]) => Clause;
  eq: (column: string, value: unknown) => Clause;
  gt: (column: string, value: unknown) => Clause;
};
type Config = {
  where: (table: Record<string, string>, helpers: Helpers) => Clause;
  columns?: Record<string, boolean>;
};

let captured: Config | null = null;
let rows: unknown[] = [];
const findMany = vi.fn(async (config: Config) => {
  captured = config;
  return rows;
});
const findFirst = vi.fn(async (config: Config) => {
  captured = config;
  return rows[0];
});

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      boardMembers: { findMany: (c: Config) => findMany(c) },
      boardInvites: { findMany: (c: Config) => findMany(c), findFirst: (c: Config) => findFirst(c) },
    },
  },
}));

const { INVITE_TTL_DAYS, listInvitesForUser, listPendingInvites, findPendingInvite } = await import(
  './members'
);

const table = { boardId: 'boardId', email: 'email', createdAt: 'createdAt', id: 'id' };
const helpers: Helpers = {
  and: (...parts) => ['and', ...parts],
  eq: (column, value) => ['eq', column, value],
  gt: (column, value) => ['gt', column, value],
};

// The cutoff is a Date built at call time, so the assertion is on the column and
// on the magnitude, not on an exact instant.
function cutoffFrom(clause: Clause): Date | null {
  const found = (clause as unknown[]).find(
    (part) => Array.isArray(part) && part[0] === 'gt' && part[1] === 'createdAt',
  ) as Clause | undefined;
  return found ? (found[2] as Date) : null;
}

beforeEach(() => {
  captured = null;
  rows = [];
  findMany.mockClear();
  findFirst.mockClear();
});

describe('the invite reads', () => {
  test('exports a thirty-day window', () => {
    expect(INVITE_TTL_DAYS).toBe(30);
  });

  test.each([
    ['listPendingInvites', () => listPendingInvites('board-1')],
    ['listInvitesForUser', () => listInvitesForUser('me@example.test')],
    ['findPendingInvite', () => findPendingInvite('invite-1')],
  ])('%s refuses invites older than the window', async (_name, call) => {
    await call();
    expect(captured).not.toBeNull();
    const cutoff = cutoffFrom(captured!.where(table, helpers));
    expect(cutoff).toBeInstanceOf(Date);
    const days = (Date.now() - (cutoff as Date).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);
  });

  test('listInvitesForUser matches the address in lower case', async () => {
    await listInvitesForUser('  ME@Example.test ');
    const clause = JSON.stringify(captured!.where(table, helpers));
    expect(clause).toContain('me@example.test');
  });
});
