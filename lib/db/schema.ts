import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';

// Names mirror @auth/drizzle-adapter's own defaults exactly. DrizzleAdapter is
// called without a schema argument, so it builds its queries from those
// defaults rather than from these definitions — they have to agree.
export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    index('account_userId_idx').on(account.userId),
  ],
);

export const sessions = pgTable(
  'session',
  {
    sessionToken: text('sessionToken').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (session) => [index('session_userId_idx').on(session.userId)],
);

export const boardRole = pgEnum('board_role', ['owner', 'member', 'viewer']);

export const boards = pgTable('boards', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const boardMembers = pgTable(
  'board_members',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: boardRole('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('board_members_user_id_idx').on(t.userId),
  ],
);

export const boardInvites = pgTable(
  'board_invites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: boardRole('role').notNull(),
    invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('board_invites_board_id_email_key').on(t.boardId, t.email),
    index('board_invites_email_idx').on(t.email),
    // The one-owner invariant, in the database rather than only in Zod:
    // ownership moves through transferOwnership and nowhere else.
    check('board_invites_role_not_owner', sql`${t.role} <> 'owner'`),
  ],
);

export const columns = pgTable(
  'columns',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rank: text('rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('columns_board_id_rank_idx').on(t.boardId, t.rank)],
);

export const cards = pgTable(
  'cards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    // No onDelete: Postgres's default NO ACTION is what refuses to orphan a
    // column's cards. deleteColumn moves them to a named target first.
    columnId: text('column_id')
      .notNull()
      .references(() => columns.id),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    rank: text('rank').notNull(),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('cards_column_id_rank_idx').on(t.columnId, t.rank),
    index('cards_board_id_idx').on(t.boardId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // Nullable and set null, not cascade: /privacy promises that boards owned
    // by other people keep your comments when your account is deleted.
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('comments_card_id_created_at_idx').on(t.cardId, t.createdAt)],
);

export const boardsRelations = relations(boards, ({ many }) => ({
  members: many(boardMembers),
  invites: many(boardInvites),
  columns: many(columns),
  cards: many(cards),
}));

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  board: one(boards, { fields: [boardMembers.boardId], references: [boards.id] }),
  user: one(users, { fields: [boardMembers.userId], references: [users.id] }),
}));

export const boardInvitesRelations = relations(boardInvites, ({ one }) => ({
  board: one(boards, { fields: [boardInvites.boardId], references: [boards.id] }),
  invitedBy: one(users, { fields: [boardInvites.invitedById], references: [users.id] }),
}));

export const columnsRelations = relations(columns, ({ one, many }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
  column: one(columns, { fields: [cards.columnId], references: [columns.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));
