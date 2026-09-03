// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { BoardEvent } from '@/lib/events';

// The action module reaches lib/db, which builds a pg pool at module scope and
// does not resolve under vitest's node-backed jsdom environment.
vi.mock('@/lib/actions/comments', () => ({
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  readComments: vi.fn(),
}));

// The real provider constructs a Pusher client. This one hands the test the
// handler instead, so a comment can be delivered on demand.
const handlers: ((event: BoardEvent) => void)[] = [];
vi.mock('@/components/board/realtime', () => ({
  useRealtime: () => ({
    claim: () => 'mutation-1',
    subscribe: (handler: (event: BoardEvent) => void) => {
      handlers.push(handler);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
    status: 'subscribed' as const,
    reconnected: 0,
  }),
}));

const mounted = vi.hoisted(() => ({ current: true }));
vi.mock('@/lib/use-mounted', () => ({
  useMounted: () => mounted.current,
}));

const { addComment } = await import('@/lib/actions/comments');
const { CardComments } = await import('@/components/board/card-comments');

// This repo does not set vitest's `globals: true` (see vitest.config.mts), so
// @testing-library/react's automatic afterEach(cleanup) never registers.
afterEach(cleanup);

const viewer = { id: 'u1', name: 'Alex' };

const deliver = (event: BoardEvent) => act(() => handlers.forEach((handler) => handler(event)));

beforeEach(() => {
  handlers.length = 0;
  mounted.current = true;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'));
  vi.mocked(addComment).mockReset();
});

afterEach(() => vi.useRealTimers());

const existing = {
  id: 'c1',
  body: 'Ranks collate by code point here.',
  createdAt: new Date('2026-09-03T09:00:00.000Z'),
  author: { id: 'u2', name: 'Robin', image: null },
};

describe('CardComments timestamps', () => {
  test('a stored comment carries a relative label and the exact instant', () => {
    render(<CardComments cardId="card-1" comments={[existing]} viewer={viewer} />);

    const stamp = screen.getByTestId('comment-time');
    expect(stamp).toHaveTextContent('3 hours ago');
    expect(stamp).toHaveAttribute('dateTime', '2026-09-03T09:00:00.000Z');
    expect(stamp.getAttribute('title')).toMatch(/2026/);
  });

  // The relative text depends on the viewer's clock and locale, so rendering it
  // on the server would hydrate to a mismatch — the trap DueDate already avoids.
  // The element and its machine-readable instant are stable across both renders.
  test('the relative text waits for the client, the instant does not', () => {
    mounted.current = false;
    render(<CardComments cardId="card-1" comments={[existing]} viewer={viewer} />);

    const stamp = screen.getByTestId('comment-time');
    expect(stamp).toHaveAttribute('dateTime', '2026-09-03T09:00:00.000Z');
    expect(stamp).toHaveTextContent('');
  });

  test('a comment you just posted is stamped before the server answers', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Never resolves: the optimistic row is all there is to look at.
    vi.mocked(addComment).mockReturnValue(new Promise(() => {}));

    render(<CardComments cardId="card-1" comments={[]} viewer={viewer} />);
    await user.type(screen.getByLabelText('Add a comment'), 'Just now');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(screen.getByTestId('comment-body')).toHaveTextContent('Just now'));
    expect(screen.getByTestId('comment-time')).toHaveTextContent('this minute');
  });

  test("a teammate's comment arrives stamped", async () => {
    render(<CardComments cardId="card-1" comments={[]} viewer={viewer} />);

    await deliver({
      type: 'comment.created',
      id: 'c2',
      cardId: 'card-1',
      body: 'Landed it.',
      createdAt: '2026-09-03T11:00:00.000Z',
      author: { id: 'u2', name: 'Robin', image: null },
      mutationId: 'someone-else',
      actorId: 'u2',
    });

    expect(screen.getByTestId('comment-time')).toHaveTextContent('1 hour ago');
  });
});
