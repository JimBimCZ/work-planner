import Pusher from 'pusher';

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
