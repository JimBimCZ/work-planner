import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { accounts, sessions, users } from './schema';

// DrizzleAdapter is called with no schema argument, so it queries its own
// default table definitions. These names are a contract with the adapter, and
// renaming one produces no type error — only a runtime failure at sign-in.
describe('the adapter tables', () => {
  test('are named as the adapter names them', () => {
    expect(getTableConfig(users).name).toBe('user');
    expect(getTableConfig(accounts).name).toBe('account');
    expect(getTableConfig(sessions).name).toBe('session');
  });

  test('the user table carries every column the adapter reads', () => {
    const columns = getTableConfig(users).columns.map((column) => column.name);
    expect(columns.sort()).toEqual(['email', 'emailVerified', 'id', 'image', 'name']);
  });

  test('the session table is keyed on sessionToken', () => {
    const [primary] = getTableConfig(sessions).columns.filter((column) => column.primary);
    expect(primary.name).toBe('sessionToken');
  });

  test('an account is identified by provider and providerAccountId', () => {
    const [compositePk] = getTableConfig(accounts).primaryKeys;
    expect(compositePk.columns.map((column) => column.name)).toEqual([
      'provider',
      'providerAccountId',
    ]);
  });
});
