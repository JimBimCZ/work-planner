// The union is closed and the switch below is exhaustive, so adding a type
// without giving it a sentence fails `pnpm typecheck` on the `never`
// assignment — the guarantee EveryEventIsBound gives the event set.
export type ActivityType =
  | 'board.created'
  | 'board.renamed'
  | 'column.created'
  | 'column.renamed'
  | 'column.deleted'
  | 'card.created'
  | 'card.renamed'
  | 'card.described'
  | 'card.due_set'
  | 'card.due_cleared'
  | 'card.moved'
  | 'card.deleted'
  | 'comment.added'
  | 'comment.edited'
  | 'comment.deleted'
  | 'label.created'
  | 'label.renamed'
  | 'label.deleted'
  | 'card.labelled'
  | 'attachment.added'
  | 'attachment.removed'
  | 'member.joined'
  | 'member.left'
  | 'member.removed'
  | 'member.role_changed'
  | 'member.ownership_transferred';

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  subjectId: string | null;
  subject: string | null;
  detail: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; image: string | null };
  // Resolved by join for member.* entries, whose subject is a person. Null
  // once that account is gone, which is the point: no name is stored.
  subjectName: string | null;
};

// The predicate only — the actor's name is rendered by the component, beside
// their avatar, so it is never baked into the string.
export function describeActivity(entry: ActivityEntry): string {
  const it = entry.subject ?? 'an item';
  const who = entry.subjectName ?? 'a member';
  const to = entry.detail;

  switch (entry.type) {
    case 'board.created':
      return 'created this board';
    case 'board.renamed':
      return `renamed the board to ${it}`;
    case 'column.created':
      return `added the column ${it}`;
    case 'column.renamed':
      return `renamed the column ${to} to ${it}`;
    case 'column.deleted':
      return `deleted the column ${it} and moved its cards to ${to}`;
    case 'card.created':
      return `added ${it} to ${to}`;
    case 'card.renamed':
      return `renamed ${to} to ${it}`;
    case 'card.described':
      return `updated the description of ${it}`;
    case 'card.due_set':
      return `set the due date on ${it} to ${to}`;
    case 'card.due_cleared':
      return `cleared the due date on ${it}`;
    case 'card.moved':
      return `moved ${it} to ${to}`;
    case 'card.deleted':
      return `deleted ${it}`;
    case 'comment.added':
      return `commented on ${it}`;
    case 'comment.edited':
      return `edited a comment on ${it}`;
    case 'comment.deleted':
      return `deleted a comment on ${it}`;
    case 'label.created':
      return `added the label ${it}`;
    case 'label.renamed':
      return `renamed the label ${to} to ${it}`;
    case 'label.deleted':
      return `deleted the label ${it}`;
    case 'card.labelled':
      return `changed the labels on ${it}`;
    case 'attachment.added':
      return `attached ${to} to ${it}`;
    case 'attachment.removed':
      return `removed ${to} from ${it}`;
    case 'member.joined':
      return 'joined the board';
    case 'member.left':
      return 'left the board';
    case 'member.removed':
      return `removed ${who} from the board`;
    case 'member.role_changed':
      return `made ${who} a ${to}`;
    case 'member.ownership_transferred':
      return `handed the board to ${who}`;
    default: {
      const unreachable: never = entry.type;
      return unreachable;
    }
  }
}
