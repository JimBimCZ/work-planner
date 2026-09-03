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
  uniqueIndex,
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

export const labels = pgTable(
  'labels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // lower(): 'Bug' and 'bug' must not become two filters. The same fold
    // inviteMember applies to an address, for the same reason.
    uniqueIndex('labels_board_id_name_key').on(t.boardId, sql`lower(${t.name})`),
  ],
);

export const cardLabels = pgTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.labelId] }),
    index('card_labels_label_id_idx').on(t.labelId),
  ],
);

export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready']);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalised for the same reason cards.boardId is: every permission
    // check and every event keys off the board, and a board-wide delete needs
    // the object keys without joining through cards.
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // Set null, not cascade — the rule comments.authorId already follows.
    // /privacy promises boards owned by other people keep your contributions.
    uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    // The value headObject read back, never the browser's claim.
    size: integer('size').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_card_id_created_at_idx').on(t.cardId, t.createdAt),
    index('attachments_board_id_idx').on(t.boardId),
    // One reader only: the per-account storage total.
    index('attachments_uploader_id_idx').on(t.uploaderId),
  ],
);

export const activity = pgTable(
  'activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    // The one user reference here that cascades rather than setting null.
    // An entry is a record about an action, not a contribution: nothing
    // another member wrote is lost with it, and /privacy gets to say the
    // record of what you did is deleted with your account.
    // docs/specs/activity-log.md holds the argument in full.
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    // No foreign key, deliberately. Half of all entries describe something
    // that no longer exists — that is what "deleted the card 'Ship it'"
    // means. A reference would delete the row as it became interesting.
    subjectId: text('subject_id'),
    subject: text('subject'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Postgres scans an ascending index backwards, so this one index serves the
  // feed's `order by created_at desc` and the trim's cutoff both.
  (t) => [index('activity_board_id_created_at_idx').on(t.boardId, t.createdAt)],
);

// Where a reader had got to, so the drawer can draw a line under it. One row
// per board per reader, and nothing of value in it: it goes with either.
export const activityReads = pgTable(
  'activity_reads',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
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
  labels: many(labels),
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
  cardLabels: many(cardLabels),
  attachments: many(attachments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  board: one(boards, { fields: [labels.boardId], references: [boards.id] }),
  cardLabels: many(cardLabels),
}));

export const cardLabelsRelations = relations(cardLabels, ({ one }) => ({
  card: one(cards, { fields: [cardLabels.cardId], references: [cards.id] }),
  label: one(labels, { fields: [cardLabels.labelId], references: [labels.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  card: one(cards, { fields: [attachments.cardId], references: [cards.id] }),
  board: one(boards, { fields: [attachments.boardId], references: [boards.id] }),
  uploader: one(users, { fields: [attachments.uploaderId], references: [users.id] }),
}));

export const activityRelations = relations(activity, ({ one }) => ({
  board: one(boards, { fields: [activity.boardId], references: [boards.id] }),
  actor: one(users, { fields: [activity.actorId], references: [users.id] }),
}));
