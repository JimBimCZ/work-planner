import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const trigger = vi.fn();
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger;
    authorizeChannel = vi.fn();
  },
}));

const { PAYLOAD_CEILING, channelFor, publish } = await import('./events');

const CREDENTIALS = {
  PUSHER_APP_ID: '1234567',
  PUSHER_SECRET: 'secret',
  NEXT_PUBLIC_PUSHER_KEY: 'key',
  NEXT_PUBLIC_PUSHER_CLUSTER: 'eu',
};

const moved = {
  type: 'card.moved',
  mutationId: 'm1',
  actorId: 'user-1',
  id: 'card-1',
  columnId: 'col-2',
  rank: 'a1',
} as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  trigger.mockReset();
  trigger.mockResolvedValue(undefined);
  saved = { ...process.env };
  Object.assign(process.env, CREDENTIALS);
});

afterEach(() => {
  for (const key of Object.keys(CREDENTIALS)) delete process.env[key];
  Object.assign(process.env, saved);
});

test('the channel is private and names the board', () => {
  expect(channelFor('b1')).toBe('private-board-b1');
});

describe('publish', () => {
  test('triggers on the board channel, using the event type as the event name', async () => {
    await publish('b1', moved);
    expect(trigger).toHaveBeenCalledWith('private-board-b1', 'card.moved', moved);
  });

  test('does nothing when the credentials are absent', async () => {
    delete process.env.PUSHER_APP_ID;
    await publish('b1', moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  test('does nothing when only some credentials are present', async () => {
    delete process.env.PUSHER_SECRET;
    await publish('b1', moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  // The write has already committed by the time publish runs. Throwing here
  // would turn a successful action into a failed one.
  test('swallows a transport failure', async () => {
    trigger.mockRejectedValue(new Error('network'));
    await expect(publish('b1', moved)).resolves.toBeUndefined();
  });

  test('refuses to send a payload over the ceiling', async () => {
    const huge = { ...moved, rank: 'x'.repeat(PAYLOAD_CEILING) };
    await publish('b1', huge as unknown as typeof moved);
    expect(trigger).not.toHaveBeenCalled();
  });

  test('the ceiling leaves headroom under Pusher documented 10KB limit', () => {
    expect(PAYLOAD_CEILING).toBeLessThan(10 * 1024);
  });
});
