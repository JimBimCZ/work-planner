// The demo board's content, and the only place it lives. There is no board
// row: /boards/[boardId] reads Postgres, and / reads this file.
//
// It imports nothing that reaches the database, in the manner of
// lib/labels-limits.ts. BoardWithCards is an `import type` and is erased —
// a value import from lib/boards.ts would pull in lib/db, which opens a pg
// pool at module scope, and only `pnpm build` would notice.
import type { BoardWithCards } from '@/lib/boards';
import { previewOf } from '@/lib/cards-limits';

export const DEMO_BOARD_ID = 'demo-board';
export const DEMO_BOARD_NAME = 'Launch checklist';

const DAY = 86_400_000;

// Midnight UTC on the day `offset` days from the viewer's today. lib/due.ts
// reduces a due date from its UTC parts and "now" from its local ones, so a
// date built this way is exactly `offset` days out by dueState's reckoning.
// Offsets rather than literal dates are what keep "3d over" true in every
// year this board is served.
const dueOn = (now: Date, offset: number) =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offset * DAY);

const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

// Ordered by name, matching the board read in lib/boards.ts.
const LABELS = [
  { id: 'demo-label-api', name: 'api' },
  { id: 'demo-label-bug', name: 'bug' },
  { id: 'demo-label-design', name: 'design' },
  { id: 'demo-label-docs', name: 'docs' },
  { id: 'demo-label-infra', name: 'infra' },
];

type CardSeed = {
  id: string;
  title: string;
  createdDaysAgo: number;
  dueInDays?: number;
  description?: string;
  labelIds?: string[];
  attachments?: number;
};

type ColumnSeed = { id: string; name: string; cards: CardSeed[] };

// Ids are stable and deliberately not uuids. Nothing here may reach a server
// action, and a non-uuid id fails at the Zod boundary rather than touching a
// real row if one ever does.
const COLUMNS: ColumnSeed[] = [
  {
    id: 'demo-col-ready',
    name: 'Ready to Work',
    cards: [
      {
        id: 'demo-card-search',
        title: 'Search cards across a board',
        createdDaysAgo: 6,
        labelIds: ['demo-label-api'],
      },
      {
        id: 'demo-card-export',
        title: 'Export a board to CSV',
        createdDaysAgo: 5,
        labelIds: ['demo-label-docs'],
      },
      {
        id: 'demo-card-empty',
        title: 'An empty column should read as an invitation',
        createdDaysAgo: 4,
        labelIds: ['demo-label-design'],
      },
    ],
  },
  {
    id: 'demo-col-progress',
    name: 'In Progress',
    cards: [
      {
        id: 'demo-card-migrate',
        title: 'Move attachments to the EU bucket',
        createdDaysAgo: 9,
        dueInDays: -3,
        description:
          'The bucket has to be created against the EU-jurisdiction endpoint. A bucket made there is not visible from the plain host at all, which is what makes the privacy policy true rather than aspirational.',
        labelIds: ['demo-label-infra'],
      },
      {
        id: 'demo-card-presence',
        title: 'Show who else is looking at the board',
        createdDaysAgo: 3,
        dueInDays: 1,
        labelIds: ['demo-label-api', 'demo-label-design'],
      },
    ],
  },
  {
    id: 'demo-col-testing',
    name: 'In Testing',
    cards: [
      {
        id: 'demo-card-drag',
        title: 'Drag between columns on a phone',
        createdDaysAgo: 2,
        description:
          'Below 700px the board shows one column at a time, so a cross-column drag has to arm the column it lands in rather than draw a line the reader cannot see.',
        labelIds: ['demo-label-bug', 'demo-label-design'],
        attachments: 1,
      },
      {
        id: 'demo-card-invite',
        title: 'Invite by email, accept from the board list',
        createdDaysAgo: 7,
        labelIds: ['demo-label-api'],
      },
    ],
  },
  {
    id: 'demo-col-review',
    name: 'In Review',
    cards: [
      {
        id: 'demo-card-activity',
        title: 'Draw the line where the reader left off',
        createdDaysAgo: 1,
        description:
          'The marker is read before it is written. Upsert it first and the line sits at the top of every visit, which answers "what is new" with "everything".',
        labelIds: ['demo-label-design'],
      },
      {
        id: 'demo-card-ranks',
        title: 'Two people drop a card in the same place',
        createdDaysAgo: 8,
        labelIds: ['demo-label-infra'],
      },
    ],
  },
  {
    id: 'demo-col-done',
    name: 'Done',
    cards: [
      {
        id: 'demo-card-oauth',
        title: 'Sign in with Google and GitHub',
        createdDaysAgo: 21,
        labelIds: ['demo-label-api'],
      },
      {
        id: 'demo-card-theme',
        title: 'Dark and light, following the system',
        createdDaysAgo: 18,
        labelIds: ['demo-label-design'],
      },
      {
        id: 'demo-card-privacy',
        title: 'Name every sub-processor in the policy',
        createdDaysAgo: 14,
        labelIds: ['demo-label-docs'],
      },
    ],
  },
];

// Returns exactly the shape lib/boards.ts produces, so toBoardState consumes
// it unchanged and the canvas cannot tell the difference.
export function demoBoard(now: Date): BoardWithCards {
  return {
    id: DEMO_BOARD_ID,
    name: DEMO_BOARD_NAME,
    labels: LABELS,
    columns: COLUMNS.map((column, columnIndex) => ({
      id: column.id,
      name: column.name,
      rank: `a${columnIndex}`,
      cards: column.cards.map((card, cardIndex) => ({
        id: card.id,
        columnId: column.id,
        title: card.title,
        rank: `a${cardIndex}`,
        createdAt: ago(now, card.createdDaysAgo),
        dueDate: card.dueInDays === undefined ? null : dueOn(now, card.dueInDays),
        descriptionPreview: previewOf(card.description ?? null),
        cardLabels: (card.labelIds ?? []).map((labelId) => ({ labelId })),
        attachments: Array.from({ length: card.attachments ?? 0 }, (_, index) => ({
          id: `${card.id}-file-${index}`,
        })),
      })),
    })),
  };
}
