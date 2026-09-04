// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// vitest.config.mts does not set globals: true, so Testing Library never
// registers its own afterEach(cleanup). CLAUDE.md requires wiring it by hand.
afterEach(cleanup);

const channel = { bind: vi.fn(), unbind_all: vi.fn() };
const constructed = vi.hoisted(() => vi.fn());
// A class, not vi.fn(impl): the provider calls `new Pusher(...)`, and a spy
// wrapping an arrow function is not a constructor.
vi.mock('pusher-js', () => ({
  default: class {
    connection = { bind: vi.fn(), unbind_all: vi.fn() };
    subscribe = vi.fn(() => channel);
    unsubscribe = vi.fn();
    disconnect = vi.fn();
    constructor(...args: unknown[]) {
      constructed(...args);
    }
  },
}));

const { RealtimeProvider } = await import('./realtime');

beforeEach(() => {
  constructed.mockClear();
  vi.stubEnv('NEXT_PUBLIC_PUSHER_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_PUSHER_CLUSTER', 'eu');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('connects for a board', () => {
  render(
    <RealtimeProvider boardId="11111111-2222-3333-4444-555555555555">
      <p>board</p>
    </RealtimeProvider>,
  );
  expect(constructed).toHaveBeenCalledTimes(1);
});

// The demo has no channel it could be authorised on: its board id is not a
// uuid, so /api/pusher/auth rejects it by construction. Connecting anyway
// would spend a free-tier connection per anonymous visitor to fail.
test('never opens a socket when there is no board', () => {
  render(
    <RealtimeProvider boardId={null}>
      <p>demo</p>
    </RealtimeProvider>,
  );
  expect(constructed).not.toHaveBeenCalled();
});

test('still renders its children with no board', () => {
  const { getByText } = render(
    <RealtimeProvider boardId={null}>
      <p>demo</p>
    </RealtimeProvider>,
  );
  expect(getByText('demo')).toBeTruthy();
});
