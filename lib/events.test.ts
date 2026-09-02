import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const trigger = vi.fn();
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger;
    authorizeChannel = vi.fn();
  },
}));

const { PAYLOAD_CEILING, channelFor, publish, publishComment } = await import('./events');

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

describe('publishComment', () => {
  const created = {
    type: 'comment.created',
    mutationId: 'm1',
    actorId: 'user-1',
    id: 'comment-1',
    cardId: 'card-1',
    createdAt: '2026-08-31T00:00:00.000Z',
    author: { id: 'user-1', name: 'Alice', image: null },
  } as const;

  test('ships a short body inline', async () => {
    await publishComment('b1', { ...created, body: 'Looks right' });
    expect(trigger).toHaveBeenCalledWith(
      'private-board-b1',
      'comment.created',
      expect.objectContaining({ body: 'Looks right' }),
    );
  });

  // 4,000 characters is under the ceiling in ASCII and far over it in emoji.
  // The cap counts characters; the guard has to count bytes.
  test('degrades a body that is under the character cap but over the byte ceiling', async () => {
    await publishComment('b1', { ...created, body: '😀'.repeat(4_000) });
    expect(trigger).toHaveBeenCalledWith('private-board-b1', 'comment.created.truncated', {
      type: 'comment.created.truncated',
      mutationId: 'm1',
      actorId: 'user-1',
      id: 'comment-1',
      cardId: 'card-1',
    });
  });

  test('a maximum-length ASCII comment still ships inline', async () => {
    await publishComment('b1', { ...created, body: 'x'.repeat(4_000) });
    expect(trigger).toHaveBeenCalledWith(
      'private-board-b1',
      'comment.created',
      expect.objectContaining({ body: 'x'.repeat(4_000) }),
    );
  });
});

test('every event the server can publish is one the client binds', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync('components/board/realtime.tsx', 'utf8'),
  );
  const bound = source.slice(source.indexOf('EVENT_NAMES'), source.indexOf('CLAIM_MEMORY'));

  for (const name of [
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
  ]) {
    expect(bound, `${name} is published but never delivered`).toContain(`'${name}'`);
  }
});
