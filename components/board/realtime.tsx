'use client';

import Pusher from 'pusher-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// import type, not import. lib/events.ts pulls in the pusher server SDK; a
// value import here would put it in the browser bundle and only pnpm build
// would notice. See CLAUDE.md on lib/permissions.ts, which has the same shape.
import type { BoardEvent } from '@/lib/events';

type Handler = (event: BoardEvent) => void;
type Status = 'off' | 'connecting' | 'subscribed' | 'failed';

const EVENT_NAMES = [
  'card.created',
  'card.updated',
  'card.moved',
  'card.deleted',
  'column.created',
  'column.updated',
  'column.moved',
  'column.deleted',
  'comment.created',
  'comment.created.truncated',
  'comment.updated',
  'comment.deleted',
  'member.added',
  'member.updated',
  'member.removed',
  'label.created',
  'label.updated',
  'label.deleted',
  'card.labelled',
  'attachment.added',
  'attachment.removed',
] as const satisfies readonly BoardEvent['type'][];

// An event the server can publish and this list omits is delivered nowhere, and
// nothing at runtime can notice: Pusher simply never calls a handler nobody
// bound. `satisfies` above catches a name that is not an event; this catches an
// event that is not a name, which is the direction that actually breaks.
//
// The `T extends true` constraint is what does the work — an unbound event makes
// the argument `false`, which fails the constraint and names this line. A bare
// alias resolving to `never` would compile silently, which is what the first
// version of this did.
type Assert<T extends true> = T;
export type EveryEventIsBound = Assert<
  Exclude<BoardEvent['type'], (typeof EVENT_NAMES)[number]> extends never ? true : false
>;

// Bounded: an echo arrives within milliseconds of its action resolving, so the
// window only has to outlive one round trip. Unbounded, this would grow for as
// long as the board stays open.
const CLAIM_MEMORY = 50;

const RealtimeContext = createContext<{
  subscribe: (handler: Handler) => () => void;
  claim: () => string;
  status: Status;
  reconnected: number;
} | null>(null);

export function RealtimeProvider({
  boardId,
  children,
}: {
  // Null is a surface with no channel to join — the demo board, which is a
  // fixture rather than a row. It is not an error state: the provider is
  // still required, because the canvas calls useRealtime() unconditionally.
  boardId: string | null;
  children: React.ReactNode;
}) {
  // A ref, not state: adding a handler must not re-render the provider and
  // tear down the connection every time the modal opens over the board.
  const handlers = useRef(new Set<Handler>());
  const claimed = useRef<string[]>([]);
  const [status, setStatus] = useState<Status>('off');
  const [reconnected, setReconnected] = useState(0);

  useEffect(() => {
    // Referenced literally, never destructured off process.env: Next inlines
    // NEXT_PUBLIC_* by textual substitution at build time, and a destructured
    // read is not substituted.
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    // No credentials is a supported configuration, not an error: the app is
    // simply not realtime, which is what self-hosting without Pusher gets.
    // No board id is the same answer for a different reason — see the prop.
    if (!key || !cluster || !boardId) return;

    // Deferred a tick rather than called directly: react-hooks/set-state-in-effect
    // flags a setState called synchronously in the effect body. The connection
    // itself is still opened synchronously below; only the status flip is deferred.
    queueMicrotask(() => setStatus('connecting'));
    const pusher = new Pusher(key, {
      cluster,
      channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' },
    });

    // The first `connected` is the initial connection and means nothing. Every
    // later one follows a gap the client slept through — Pusher does not
    // replay, so what was missed is gone unless someone goes and asks.
    let everConnected = false;
    pusher.connection.bind('connected', () => {
      if (everConnected) setReconnected((count) => count + 1);
      everConnected = true;
    });

    // The status has to be honest about a socket that dropped, not only about a
    // subscription that once succeeded on it. pusher-js re-subscribes itself on
    // reconnection, so subscription_succeeded puts it back.
    pusher.connection.bind('state_change', ({ current }: { current: string }) => {
      if (current !== 'connected') setStatus('connecting');
    });

    const name = `private-board-${boardId}`;
    const channel = pusher.subscribe(name);
    channel.bind('pusher:subscription_succeeded', () => setStatus('subscribed'));
    channel.bind('pusher:subscription_error', () => setStatus('failed'));

    const fanOut = (event: BoardEvent) => {
      // Our own change is already applied optimistically. Applying the echo as
      // well would fight the optimistic update rather than confirm it.
      const index = claimed.current.indexOf(event.mutationId);
      if (index !== -1) {
        claimed.current.splice(index, 1);
        return;
      }
      for (const handler of handlers.current) handler(event);
    };
    for (const eventName of EVENT_NAMES) channel.bind(eventName, fanOut);

    return () => {
      pusher.connection.unbind_all();
      channel.unbind_all();
      pusher.unsubscribe(name);
      pusher.disconnect();
      setStatus('off');
    };
  }, [boardId]);

  const subscribe = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const claim = useCallback(() => {
    const mutationId = crypto.randomUUID();
    claimed.current.push(mutationId);
    if (claimed.current.length > CLAIM_MEMORY) claimed.current.shift();
    return mutationId;
  }, []);

  const value = useMemo(
    () => ({ subscribe, claim, status, reconnected }),
    [subscribe, claim, status, reconnected],
  );

  return (
    <RealtimeContext.Provider value={value}>
      <div className="contents" data-realtime={status}>
        {children}
      </div>
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime used outside RealtimeProvider');
  return context;
}
