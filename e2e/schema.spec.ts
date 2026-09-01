import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import {
  boardColumns,
  closeSeedPool,
  removeSeededUser,
  seedBoard,
  seedCard,
  seedComment,
  seedMember,
  seedSession,
} from './support/session';

test.afterAll(async () => {
  await closeSeedPool();
});

// The whole no-orphan design rests on NO ACTION being checked at the end of the
// statement rather than immediately. If this fails, cards.columnId must become
// ON DELETE cascade and the rule moves entirely into deleteColumn.
test('deleting a board takes its columns and cards with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascade');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from boards where id = $1', [boardId]);

    for (const table of ['cards', 'columns', 'board_members']) {
      const { rows } = await pool.query<{ n: number }>(
        `select count(*)::int as n from ${table} where board_id = $1`,
        [boardId],
      );
      expect(rows[0].n, `${table} should be empty`).toBe(0);
    }
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a column that still holds cards is refused by the database', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'No orphans');
  const [first] = await boardColumns(boardId);
  await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await expect(pool.query('delete from columns where id = $1', [first.id])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a card takes its comments with it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Threaded');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });
  await seedComment(cardId, userId);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from cards where id = $1', [cardId]);
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from comments where card_id = $1',
      [cardId],
    );
    expect(rows[0].n).toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// The published privacy policy promises this exact behaviour: a board you do
// not own keeps your comments when your account goes.
test('deleting a user leaves their comments, authorless', async ({ context }) => {
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, 'Outliving');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: owner.userId });

  const commenter = await seedSession(context);
  await seedMember(boardId, commenter.userId, 'member');
  const commentId = await seedComment(cardId, commenter.userId, 'Still here');

  try {
    await removeSeededUser(commenter.userId);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query<{ author_id: string | null; body: string }>(
        'select author_id, body from comments where id = $1',
        [commentId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].author_id).toBeNull();
      expect(rows[0].body).toBe('Still here');
    } finally {
      await pool.end();
    }
  } finally {
    await removeSeededUser(owner.userId);
  }
});

// The scenario this migration exists to prevent: cards.createdById used to
// cascade, so deleting an account would take every comment on every card that
// account created — including comments left by other people, on boards the
// deleted account did not own.
test('deleting a user leaves a card they created elsewhere in place, authorless', async ({
  context,
}) => {
  const creator = await seedSession(context);
  const owner = await seedSession(context);
  const boardId = await seedBoard(owner.userId, "Someone else's board");
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, {
    boardId,
    createdById: creator.userId,
    title: 'Left behind',
  });
  const commentId = await seedComment(cardId, owner.userId, 'Still discussing this');

  try {
    await removeSeededUser(creator.userId);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows: cardRows } = await pool.query<{ created_by_id: string | null; title: string }>(
        'select created_by_id, title from cards where id = $1',
        [cardId],
      );
      expect(cardRows).toHaveLength(1);
      expect(cardRows[0].created_by_id).toBeNull();
      expect(cardRows[0].title).toBe('Left behind');

      const { rows: commentRows } = await pool.query<{ n: number }>(
        'select count(*)::int as n from comments where id = $1',
        [commentId],
      );
      expect(commentRows[0].n).toBe(1);
    } finally {
      await pool.end();
    }
  } finally {
    await removeSeededUser(owner.userId);
  }
});

test('an invite can never carry the owner role', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Guarded');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await expect(
      pool.query('insert into board_invites (id, board_id, email, role) values ($1, $2, $3, $4)', [
        crypto.randomUUID(),
        boardId,
        'someone@example.test',
        'owner',
      ]),
    ).rejects.toThrow(/board_invites_role_not_owner/);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

// This rejection is why inviteMember upserts. An expired invite is filtered out
// of every read but still holds the pair, so a plain insert would fail against a
// row nobody can see.
test('a board cannot hold two pending invites for one address', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Once only');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const insert = () =>
    pool.query('insert into board_invites (id, board_id, email, role) values ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      boardId,
      'twice@example.test',
      'member',
    ]);
  try {
    await insert();
    await expect(insert()).rejects.toThrow(/board_invites_board_id_email_key/);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('a board cannot hold two labels whose names differ only in case', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Vocabulary');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
      'label-lower',
      boardId,
      'bug',
    ]);
    await expect(
      pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
        'label-upper',
        boardId,
        'Bug',
      ]),
    ).rejects.toThrow();
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});

test('deleting a label takes it off every card that carried it', async ({ context }) => {
  const { userId } = await seedSession(context);
  const boardId = await seedBoard(userId, 'Cascading labels');
  const [first] = await boardColumns(boardId);
  const cardId = await seedCard(first.id, { boardId, createdById: userId });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('insert into labels (id, board_id, name) values ($1, $2, $3)', [
      'label-doomed',
      boardId,
      'chore',
    ]);
    await pool.query('insert into card_labels (card_id, label_id) values ($1, $2)', [
      cardId,
      'label-doomed',
    ]);
    await pool.query('delete from labels where id = $1', ['label-doomed']);

    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from card_labels where card_id = $1',
      [cardId],
    );
    expect(rows[0].n, 'the assignment should have gone with the label').toBe(0);
  } finally {
    await pool.end();
    await removeSeededUser(userId);
  }
});
