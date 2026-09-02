import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const presignGet = vi.fn();
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, presignGet: (...a: unknown[]) => presignGet(...a) };
});

type AttachmentRow = {
  boardId: string;
  key: string;
  filename: string;
  contentType: string;
};

let attachmentRow: AttachmentRow | undefined;

vi.mock('@/lib/db', () => ({
  db: { query: { attachments: { findFirst: async () => attachmentRow } } },
}));

// Imported after the mocks: a static import would run the db mock factory
// before the variables it closes over exist.
const { BoardAccessError } = await import('@/lib/permissions');
const { GET } = await import('./route');

const call = (attachmentId: string) =>
  GET(new Request('http://localhost/api/attachments/' + attachmentId), {
    params: Promise.resolve({ attachmentId }),
  });

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('viewer');
  presignGet.mockReset();
  presignGet.mockResolvedValue('https://bucket.example/get');
  attachmentRow = {
    boardId: 'b1',
    key: 'boards/b1/a1',
    filename: 'x.png',
    contentType: 'image/png',
  };
});

describe('the attachment download route', () => {
  test('404s for a signed-out caller', async () => {
    authMock.mockResolvedValue(null);
    expect((await call('a1')).status).toBe(404);
  });

  test('404s for an attachment that does not exist', async () => {
    attachmentRow = undefined;
    expect((await call('a1')).status).toBe(404);
  });

  test('404s for somebody who is not on the board', async () => {
    // Not 403: a 403 would confirm a guessed id is real, which is the same
    // reasoning assertBoardAccess already follows.
    assertBoardAccess.mockRejectedValue(new BoardAccessError('NOT_FOUND'));
    expect((await call('a1')).status).toBe(404);
  });

  test('a viewer may read — seeing the card is seeing its files', async () => {
    assertBoardAccess.mockResolvedValue('viewer');
    expect((await call('a1')).status).toBe(302);
    expect(assertBoardAccess).toHaveBeenCalledWith('u1', 'b1', 'viewer');
  });

  test('redirects to the presigned URL', async () => {
    const response = await call('a1');
    expect(response.headers.get('location')).toBe('https://bucket.example/get');
  });

  test('renders a PNG inline', async () => {
    attachmentRow = { ...attachmentRow!, contentType: 'image/png' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.png', true);
  });

  test('forces an SVG to download', async () => {
    // An SVG opened in a tab executes script. This is the assertion that keeps
    // it a download forever.
    attachmentRow = { ...attachmentRow!, contentType: 'image/svg+xml', filename: 'x.svg' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.svg', false);
  });

  test('forces a PDF to download', async () => {
    attachmentRow = { ...attachmentRow!, contentType: 'application/pdf', filename: 'x.pdf' };
    await call('a1');
    expect(presignGet).toHaveBeenCalledWith('boards/b1/a1', 'x.pdf', false);
  });

  test('never caches the redirect itself', async () => {
    // Caching the 302 would stretch revocation from seconds to minutes. The
    // stability that saves operations lives in presignGet's signing window.
    const response = await call('a1');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
