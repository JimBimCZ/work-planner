import Pusher from 'pusher';

import type { BoardRole } from '@/lib/permissions';

// Pusher's REST API answers anything over 10KB with a 413. The gap is headroom
// for the envelope Pusher wraps around the payload; the number is asserted in
// lib/events.test.ts rather than trusted.
export const PAYLOAD_CEILING = 8_192;

type Envelope = { mutationId: string; actorId: string };

export type BoardEvent = Envelope &
  (
    | {
        type: 'card.created';
        id: string;
        columnId: string;
        title: string;
        rank: string;
        createdAt: string;
        dueDate: string | null;
      }
    | {
        type: 'card.updated';
        id: string;
        title: string;
        dueDate: string | null;
        descriptionChanged: boolean;
      }
    | { type: 'card.moved'; id: string; columnId: string; rank: string }
    | { type: 'card.deleted'; id: string }
    | { type: 'column.created'; id: string; name: string; rank: string }
    | { type: 'column.updated'; id: string; name: string }
    | { type: 'column.moved'; id: string; rank: string }
    | {
        type: 'column.deleted';
        id: string;
        targetColumnId: string;
        cards: { id: string; columnId: string; rank: string }[];
      }
    | {
        type: 'comment.created';
        id: string;
        cardId: string;
        body: string;
        createdAt: string;
        author: { id: string; name: string | null; image: string | null } | null;
      }
    | { type: 'comment.created.truncated'; id: string; cardId: string }
    | { type: 'comment.updated'; id: string; cardId: string; body: string; updatedAt: string }
    | { type: 'comment.deleted'; id: string; cardId: string }
    | { type: 'member.added'; userId: string; role: BoardRole }
    | { type: 'member.updated'; userId: string; role: BoardRole }
    | { type: 'member.removed'; userId: string }
    | { type: 'label.created'; id: string; name: string }
    | { type: 'label.updated'; id: string; name: string }
    | { type: 'label.deleted'; id: string }
    | { type: 'card.labelled'; id: string; labelIds: string[] }
  );

export const channelFor = (boardId: string) => `private-board-${boardId}`;

// Built per call rather than held at module scope. CLAUDE.md permits exactly
// one module-level singleton and lib/db/index.ts spends it; this SDK is a
// stateless HTTPS wrapper holding no sockets, so re-creating it costs nothing.
export function pusherServer(): Pusher | null {
  const appId = process.env.PUSHER_APP_ID;
  const secret = process.env.PUSHER_SECRET;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !secret || !key || !cluster) return null;
  return new Pusher({ appId, key, secret, cluster, useTLS: true });
}

export async function publish(boardId: string, event: BoardEvent): Promise<void> {
  const client = pusherServer();
  if (!client) return;

  const bytes = Buffer.byteLength(JSON.stringify(event));
  if (bytes > PAYLOAD_CEILING) {
    // Reaching here is a payload bug, not a user error. Sending it would earn a
    // 413; dropping it loses one update, which is the lesser failure.
    console.error(`[events] ${event.type} is ${bytes}B, over the ${PAYLOAD_CEILING}B ceiling`);
    return;
  }

  try {
    await client.trigger(channelFor(boardId), event.type, event);
  } catch (error) {
    console.error('[events] publish failed', error);
  }
}

// The one place the size branch lives. Everything else in this module either
// always fits or never ships its large field at all. The body cap counts
// characters and this counts bytes, so a comment well under 4,000 characters
// of emoji can still be far over the ceiling.
export async function publishComment(
  boardId: string,
  event: Extract<BoardEvent, { type: 'comment.created' }>,
): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(event)) <= PAYLOAD_CEILING) {
    return publish(boardId, event);
  }

  return publish(boardId, {
    type: 'comment.created.truncated',
    mutationId: event.mutationId,
    actorId: event.actorId,
    id: event.id,
    cardId: event.cardId,
  });
}
