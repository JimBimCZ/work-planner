import { describe, expect, test } from 'vitest';

import { DEMO_BOARD_NAME, demoBoard, demoCard } from '@/lib/demo-board';
import { DESCRIPTION_PREVIEW_MAX } from '@/lib/cards-limits';
import { dueLabel, dueState } from '@/lib/due';

const NOW = new Date('2026-09-04T09:30:00.000Z');

const allCards = (now: Date) => demoBoard(now).columns.flatMap((column) => column.cards);
// CLAUDE.md bans non-null assertions, so the dates are narrowed by flatMap
// rather than filtered and asserted.
const allDue = (now: Date) => allCards(now).flatMap((card) => (card.dueDate ? [card.dueDate] : []));

describe('demoBoard', () => {
  test('is the five seeded columns, in rank order', () => {
    const board = demoBoard(NOW);
    expect(board.name).toBe(DEMO_BOARD_NAME);
    expect(board.columns.map((column) => column.name)).toEqual([
      'Ready to Work',
      'In Progress',
      'In Testing',
      'In Review',
      'Done',
    ]);
    const ranks = board.columns.map((column) => column.rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  test('orders the cards in every column by rank, ascending by code point', () => {
    for (const column of demoBoard(NOW).columns) {
      const ranks = column.cards.map((card) => card.rank);
      expect([...ranks].sort()).toEqual(ranks);
      expect(new Set(ranks).size).toBe(ranks.length);
    }
  });

  test('gives every card the column that holds it, and a unique id', () => {
    const board = demoBoard(NOW);
    for (const column of board.columns) {
      for (const card of column.cards) expect(card.columnId).toBe(column.id);
    }
    const ids = allCards(NOW).map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('assigns only labels the board actually carries', () => {
    const board = demoBoard(NOW);
    const known = new Set(board.labels.map((label) => label.id));
    const assigned = allCards(NOW).flatMap((card) => card.cardLabels.map((row) => row.labelId));
    expect(assigned.length).toBeGreaterThan(0);
    for (const labelId of assigned) expect(known.has(labelId)).toBe(true);
  });

  test('orders labels by name, the way the board read does', () => {
    const names = demoBoard(NOW).labels.map((label) => label.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  test('resolves due dates against now: one overdue, one due soon', () => {
    const states = allDue(NOW).map((due) => dueState(due, NOW));
    expect(states).toContain('over');
    expect(states).toContain('soon');
  });

  // The reason the fixture stores offsets rather than dates. A hardcoded
  // 2026 due date passes every test above and fails this one.
  test('still reads 3d over a year later', () => {
    const later = new Date('2027-09-04T09:30:00.000Z');
    const due = allDue(later);
    expect(due.map((date) => dueState(date, later))).toContain('over');
    expect(due.map((date) => dueLabel(date, later))).toContain('3d over');
  });

  test('caps a description preview at the same length Postgres would', () => {
    for (const card of allCards(NOW)) {
      expect(card.descriptionPreview?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_PREVIEW_MAX);
    }
    expect(allCards(NOW).some((card) => card.descriptionPreview !== null)).toBe(true);
  });

  test('carries an attachment count on exactly one card', () => {
    const withFiles = allCards(NOW).filter((card) => card.attachments.length > 0);
    expect(withFiles).toHaveLength(1);
  });
});

describe('demoCard', () => {
  test('returns the whole description, not the preview', () => {
    const card = demoCard('demo-card-migrate', NOW);
    expect(card?.title).toBe('Move attachments to the EU bucket');
    expect(card?.description?.length ?? 0).toBeGreaterThan(DESCRIPTION_PREVIEW_MAX);
  });

  test('resolves labels to names, in the board order', () => {
    expect(demoCard('demo-card-drag', NOW)?.labels.map((label) => label.name)).toEqual([
      'bug',
      'design',
    ]);
  });

  test('carries comments, oldest first, dated against now', () => {
    const comments = demoCard('demo-card-migrate', NOW)?.comments ?? [];
    expect(comments.length).toBeGreaterThan(0);
    const times = comments.map((comment) => comment.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const time of times) expect(time).toBeLessThan(NOW.getTime());
  });

  test('agrees with the board about the due date', () => {
    const onBoard = allCards(NOW).find((card) => card.id === 'demo-card-migrate');
    expect(demoCard('demo-card-migrate', NOW)?.dueDate).toEqual(onBoard?.dueDate);
  });

  test('answers null for a card that is not on the demo board', () => {
    expect(demoCard('demo-card-nope', NOW)).toBeNull();
    expect(demoCard('11111111-2222-3333-4444-555555555555', NOW)).toBeNull();
  });
});
