import { beforeEach, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const authorizeChannel = vi.fn();
const pusherServer = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, pusherServer: () => pusherServer() };
});

const { POST } = await import('./route');
const { BoardAccessError } = await import('@/lib/permissions');

const BOARD = '4f1c2a90-8b3d-4e6f-9a12-7c5d8e0b3a44';

function request(body: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  return new Request('http://localhost/api/pusher/auth', { method: 'POST', body: form });
}

const valid = { socket_id: '123.456', channel_name: `private-board-${BOARD}` };

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  authorizeChannel.mockReset();
  authorizeChannel.mockReturnValue({ auth: 'key:signature' });
  pusherServer.mockReset();
  pusherServer.mockReturnValue({ authorizeChannel });
});

test('authorises a member of the board', async () => {
  const response = await POST(request(valid));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ auth: 'key:signature' });
  expect(authorizeChannel).toHaveBeenCalledWith('123.456', `private-board-${BOARD}`);
});

// viewer is the floor: CLAUDE.md grants viewers read and comment, so they
// belong on the channel.
test('asks for viewer, not member', async () => {
  await POST(request(valid));
  expect(assertBoardAccess).toHaveBeenCalledWith('user-1', BOARD, 'viewer');
});

test('refuses without a session', async () => {
  authMock.mockResolvedValue(null);
  expect((await POST(request(valid))).status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

test('refuses a board the user is not a member of', async () => {
  assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
  expect((await POST(request(valid))).status).toBe(403);
  expect(authorizeChannel).not.toHaveBeenCalled();
});

// The channel name is client input. It is parsed before anything is looked up,
// so a malformed name never reaches the database.
test('refuses a channel name that is not a board channel', async () => {
  const response = await POST(request({ ...valid, channel_name: 'private-secrets' }));
  expect(response.status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

test('refuses a presence channel for the same board', async () => {
  const response = await POST(request({ ...valid, channel_name: `presence-board-${BOARD}` }));
  expect(response.status).toBe(403);
  expect(assertBoardAccess).not.toHaveBeenCalled();
});

// Defence in depth rather than a known exploit: the auth string Pusher signs is
// socket_id:channel_name, so the socket id is not a free-form field.
test('refuses a malformed socket id', async () => {
  const response = await POST(request({ ...valid, socket_id: '1.1:private-board-other' }));
  expect(response.status).toBe(403);
  expect(authorizeChannel).not.toHaveBeenCalled();
});

test('refuses a request with no form fields', async () => {
  const response = await POST(
    new Request('http://localhost/api/pusher/auth', { method: 'POST', body: new FormData() }),
  );
  expect(response.status).toBe(400);
});

// The self-hosting configuration: Pusher credentials are absent from the
// environment, so pusherServer() returns null even for an otherwise-valid,
// authorised request.
test('refuses when Pusher is not configured', async () => {
  pusherServer.mockReturnValue(null);
  const response = await POST(request(valid));
  expect(response.status).toBe(403);
  expect(authorizeChannel).not.toHaveBeenCalled();
});
