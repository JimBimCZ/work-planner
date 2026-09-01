'use client';

import Pusher from 'pusher-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// import type, not import. lib/events.ts pulls in the pusher server SDK; a
// value import here would put it in the browser bundle and only pnpm build
// would notice. See CLAUDE.md on lib/permissions.ts, which has the same shape.
import type { BoardEvent } from '@/lib/events';

type Handler = (event: BoardEvent) => void;
type Status = 'off' | 'connecting' | 'subscribed' | 'failed';

const EVENT_NAMES: BoardEvent['type'][] = [
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
];

const RealtimeContext = createContext<{
  subscribe: (handler: Handler) => () => void;
  status: Status;
} | null>(null);

export function RealtimeProvider({
  boardId,
  children,
}: {
  boardId: string;
  children: React.ReactNode;
}) {
  // A ref, not state: adding a handler must not re-render the provider and
  // tear down the connection every time the modal opens over the board.
  const handlers = useRef(new Set<Handler>());
  const [status, setStatus] = useState<Status>('off');

  useEffect(() => {
    // Referenced literally, never destructured off process.env: Next inlines
    // NEXT_PUBLIC_* by textual substitution at build time, and a destructured
    // read is not substituted.
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    // No credentials is a supported configuration, not an error: the app is
    // simply not realtime, which is what self-hosting without Pusher gets.
    if (!key || !cluster) return;

    // Deferred a tick rather than called directly: react-hooks/set-state-in-effect
    // flags a setState called synchronously in the effect body. The connection
    // itself is still opened synchronously below; only the status flip is deferred.
    queueMicrotask(() => setStatus('connecting'));
    const pusher = new Pusher(key, {
      cluster,
      channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' },
    });

    const name = `private-board-${boardId}`;
    const channel = pusher.subscribe(name);
    channel.bind('pusher:subscription_succeeded', () => setStatus('subscribed'));
    channel.bind('pusher:subscription_error', () => setStatus('failed'));

    const fanOut = (event: BoardEvent) => {
      for (const handler of handlers.current) handler(event);
    };
    for (const eventName of EVENT_NAMES) channel.bind(eventName, fanOut);

    return () => {
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

  const value = useMemo(() => ({ subscribe, status }), [subscribe, status]);

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
