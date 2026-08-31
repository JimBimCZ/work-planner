import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { accounts, boardMembers, boardRole, boards, cards, columns, comments, sessions, users } from './schema';

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

describe('board tables', () => {
  test('use snake_case names of our own, not the adapter dialect', () => {
    expect(getTableName(boards)).toBe('boards');
    expect(getTableName(boardMembers)).toBe('board_members');
    expect(getTableName(columns)).toBe('columns');
  });

  test('key membership off the text user id the adapter defines', () => {
    expect(boardMembers.userId.columnType).toBe('PgText');
    expect(boards.ownerId.columnType).toBe('PgText');
  });

  test('constrain the role to the three roles CLAUDE.md defines', () => {
    expect(boardRole.enumValues).toEqual(['owner', 'member', 'viewer']);
  });
});

describe('the cards table', () => {
  test('is named cards and carries the columns CLAUDE.md documents', () => {
    expect(getTableName(cards)).toBe('cards');
    expect(getTableConfig(cards).columns.map((column) => column.name).sort()).toEqual([
      'board_id',
      'column_id',
      'created_at',
      'created_by_id',
      'description',
      'due_date',
      'id',
      'rank',
      'title',
      'updated_at',
    ]);
  });

  test('makes title and rank required, and leaves SP5 fields nullable', () => {
    const byName = Object.fromEntries(
      getTableConfig(cards).columns.map((column) => [column.name, column.notNull]),
    );
    expect(byName.title).toBe(true);
    expect(byName.rank).toBe(true);
    expect(byName.description).toBe(false);
    expect(byName.due_date).toBe(false);
    expect(byName.created_by_id).toBe(false);
  });

  // The whole no-orphan design rests on this pair. board_id cascades so
  // deleting a board takes its cards; column_id declares no action at all, so
  // Postgres refuses a column delete that would orphan them. Changing either
  // silently changes what deleteColumn is allowed to do.
  test('cascades from its board but declares no action on its column', () => {
    const actions = getTableConfig(cards).foreignKeys.map((key) => ({
      column: key.reference().columns[0].name,
      onDelete: key.onDelete,
    }));

    expect(actions).toContainEqual({ column: 'board_id', onDelete: 'cascade' });
    expect(actions).toContainEqual({ column: 'created_by_id', onDelete: 'set null' });
    expect(actions).toContainEqual({ column: 'column_id', onDelete: 'no action' });
  });

  test('indexes the read path and the permission path', () => {
    const indexes = getTableConfig(cards)
      .indexes.map((index) => index.config.name)
      .sort();
    expect(indexes).toEqual(['cards_board_id_idx', 'cards_column_id_rank_idx']);
  });
});

describe('comments', () => {
  test('belongs to a card and cascades with it', () => {
    const config = getTableConfig(comments);
    const cardFk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'card_id'),
    );
    expect(cardFk?.onDelete).toBe('cascade');
  });

  // The published privacy policy says other people's boards keep your comments
  // when your account goes. A cascade here would make that sentence false.
  test('keeps the comment when its author is deleted', () => {
    const config = getTableConfig(comments);
    const authorFk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'author_id'),
    );
    expect(authorFk?.onDelete).toBe('set null');
    expect(config.columns.find((c) => c.name === 'author_id')?.notNull).toBe(false);
  });

  test('indexes the thread the way it is read', () => {
    const config = getTableConfig(comments);
    const names = config.indexes.map((i) => i.config.name);
    expect(names).toContain('comments_card_id_created_at_idx');
  });
});
