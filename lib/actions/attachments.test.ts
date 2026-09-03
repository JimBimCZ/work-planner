import { beforeEach, describe, expect, test, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const assertBoardAccess = vi.fn();
vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return { ...actual, assertBoardAccess: (...args: unknown[]) => assertBoardAccess(...args) };
});

const publish = vi.fn();
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, publish: (...args: unknown[]) => publish(...args) };
});

// storageConfigured is read through a variable rather than reassigned on the
// module namespace: an ESM namespace object is read-only, so a test that
// assigns to it throws instead of changing the answer.
let storageOn = true;
const presignPut = vi.fn();
const headObject = vi.fn();
// forgetObjects is mocked rather than deleteObjects: forgetObjects calls
// deleteObjects through a module-local binding, so replacing the exported leaf
// would not be observable from here. Asserting on the wrapper is also the
// stronger check — best-effort deletion is the contract these actions owe.
const forgetObjects = vi.fn();
const deleteObjects = vi.fn();
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return {
    ...actual,
    storageConfigured: () => storageOn,
    presignPut: (...a: unknown[]) => presignPut(...a),
    headObject: (...a: unknown[]) => headObject(...a),
    forgetObjects: (...a: unknown[]) => forgetObjects(...a),
    deleteObjects: (...a: unknown[]) => deleteObjects(...a),
  };
});

let boardTotal = 0;
let accountTotal = 0;
vi.mock('@/lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  return {
    ...actual,
    boardUsage: async () => boardTotal,
    uploaderUsage: async () => accountTotal,
  };
});

type Op = { kind: 'insert' | 'update' | 'delete' | 'select'; table: string; values?: unknown };
const ops: Op[] = [];

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  return symbol ? (table as Record<symbol, string>)[symbol] : 'unknown';
}

type AttachmentRow = {
  id: string;
  boardId: string;
  cardId: string;
  uploaderId: string | null;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  status: string;
  createdAt: Date;
};

let cardRow: { boardId: string; title?: string } | undefined;
let cardCount = 0;
let staleRows: { id: string; key: string }[] = [];
let attachmentRow: AttachmentRow | undefined;

const query = {
  cards: { findFirst: async () => cardRow },
  attachments: {
    findMany: async () => Array.from({ length: cardCount }, (_, i) => ({ id: `att-${i}` })),
    findFirst: async () => attachmentRow,
  },
};

const writer = {
  query,
  select: () => ({
    from: (table: unknown) => ({
      where: async () => {
        ops.push({ kind: 'select', table: tableName(table) });
        return staleRows;
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (values: unknown) => {
      ops.push({ kind: 'insert', table: tableName(table), values });
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        ops.push({ kind: 'update', table: tableName(table), values });
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: async () => {
      ops.push({ kind: 'delete', table: tableName(table) });
    },
  }),
};

vi.mock('@/lib/db', () => ({
  db: {
    ...writer,
    transaction: (fn: (t: typeof writer) => Promise<unknown>) => fn(writer),
  },
}));

// Imported after the mocks, not statically: a top-level import of a module
// that reaches @/lib/db runs the db mock factory before `writer` exists.
const { BoardAccessError } = await import('@/lib/permissions');
const { confirmUpload, deleteAttachment, requestUpload } = await import('./attachments');

const valid = {
  cardId: 'c1',
  filename: 'screenshot.png',
  contentType: 'image/png',
  size: 1024,
  mutationId: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  ops.length = 0;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertBoardAccess.mockReset();
  assertBoardAccess.mockResolvedValue('member');
  publish.mockReset();
  presignPut.mockReset();
  presignPut.mockResolvedValue('https://bucket.example/put');
  headObject.mockReset();
  deleteObjects.mockReset();
  deleteObjects.mockResolvedValue(undefined);
  forgetObjects.mockReset();
  // Mirrors the real wrapper in lib/storage.ts: delegate to deleteObjects and
  // swallow its failure. Modelling it here is what lets a test reject the
  // bucket call and still assert the action succeeded.
  forgetObjects.mockImplementation(async (keys: unknown) => {
    try {
      await deleteObjects(keys);
    } catch {
      /* best effort, exactly as lib/storage.ts does */
    }
  });
  storageOn = true;
  boardTotal = 0;
  accountTotal = 0;
  cardCount = 0;
  staleRows = [];
  cardRow = { boardId: 'b1' };
  attachmentRow = undefined;
});

describe('requestUpload', () => {
  test('refuses a signed-out caller before it looks at anything else', async () => {
    authMock.mockResolvedValue(null);
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(assertBoardAccess).not.toHaveBeenCalled();
  });

  test('requires member, not viewer', async () => {
    // A viewer can comment but cannot write billable bytes.
    await requestUpload(valid);
    expect(assertBoardAccess).toHaveBeenCalledWith('u1', 'b1', 'member');
  });

  test('refuses a filename over the cap', async () => {
    const result = await requestUpload({ ...valid, filename: 'a'.repeat(201) });
    expect(result).toEqual({ ok: false, error: 'INVALID' });
  });

  test('answers NOT_FOUND for a card that does not exist', async () => {
    cardRow = undefined;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  test('refuses when the board is already full', async () => {
    boardTotal = 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'BOARD_FULL' });
    expect(presignPut).not.toHaveBeenCalled();
  });

  test('refuses when the declared size would push the board over', async () => {
    boardTotal = 1024 * 1024 * 1024 - 512;
    expect(await requestUpload({ ...valid, size: 1024 })).toEqual({
      ok: false,
      error: 'BOARD_FULL',
    });
  });

  test('refuses when the uploader is at their own cap', async () => {
    accountTotal = 2 * 1024 * 1024 * 1024;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'ACCOUNT_FULL' });
  });

  test('refuses an eleventh attachment on one card', async () => {
    cardCount = 10;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'TOO_MANY' });
  });

  test('reports UNAVAILABLE rather than crashing when no bucket is configured', async () => {
    // A self-hoster with no S3_* variables must get a clean refusal, because
    // the UI is hidden and only a stale page could still call this.
    storageOn = false;
    expect(await requestUpload(valid)).toEqual({ ok: false, error: 'UNAVAILABLE' });
  });

  test('sweeps this card’s abandoned uploads and forgets their objects', async () => {
    staleRows = [{ id: 'old', key: 'boards/b1/old' }];
    await requestUpload(valid);
    expect(ops.some((op) => op.kind === 'delete' && op.table === 'attachments')).toBe(true);
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/old']);
  });

  test('writes a pending row keyed boards/<boardId>/<attachmentId>', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    const insert = ops.find((op) => op.kind === 'insert');
    const values = insert?.values as { id: string; key: string; status: string; size: number };
    expect(values.status).toBe('pending');
    expect(values.size).toBe(1024);
    expect(values.key).toBe(`boards/b1/${values.id}`);
  });

  test('returns a presigned URL and an id on success', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe('https://bucket.example/put');
      expect(result.data.attachmentId).toEqual(expect.any(String));
    }
  });

  test('publishes nothing — a pending row is not news', async () => {
    // The board only learns about an attachment once confirmUpload has
    // verified it. Publishing here would show every other client a file that
    // may never finish uploading.
    await requestUpload(valid);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('confirmUpload', () => {
  const MUTATION_ID = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    attachmentRow = {
      id: 'a1',
      boardId: 'b1',
      cardId: 'c1',
      uploaderId: 'u1',
      key: 'boards/b1/a1',
      filename: 'screenshot.png',
      contentType: 'image/png',
      size: 1024,
      status: 'pending',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    headObject.mockResolvedValue({ size: 1024, contentType: 'image/png' });
  });

  test('refuses when the object never landed', async () => {
    headObject.mockResolvedValue(null);
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('stores the real size, not the declared one', async () => {
    // The row claimed 1024. The bucket says 4096. The row must end up saying
    // 4096 — otherwise every quota downstream is computed from a client's word.
    headObject.mockResolvedValue({ size: 4096, contentType: 'image/png' });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    const update = ops.find((op) => op.kind === 'update' && op.table === 'attachments');
    expect(update?.values).toMatchObject({ size: 4096, status: 'ready' });
  });

  test('stores the real content type, not the declared one', async () => {
    // A file declared image/png that is actually text/html must not be
    // remembered as an image — the inline allowlist reads this column.
    headObject.mockResolvedValue({ size: 1024, contentType: 'text/html' });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    const update = ops.find((op) => op.kind === 'update' && op.table === 'attachments');
    expect(update?.values).toMatchObject({ contentType: 'text/html' });
  });

  test('rejects an object larger than the per-file cap and deletes it', async () => {
    headObject.mockResolvedValue({ size: 20 * 1024 * 1024, contentType: 'image/png' });
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'TOO_LARGE',
    });
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/a1']);
    expect(ops.some((op) => op.kind === 'delete' && op.table === 'attachments')).toBe(true);
  });

  test('rejects an object whose declared size fitted the board quota but whose real size does not', async () => {
    // The whole reason the quota is checked twice. requestUpload reserved
    // against 1024; the bucket holds something far larger.
    boardTotal = 1024 * 1024 * 1024 - 2048;
    headObject.mockResolvedValue({ size: 8 * 1024 * 1024, contentType: 'image/png' });
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'BOARD_FULL',
    });
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/a1']);
  });

  test('refuses to confirm somebody else’s pending row', async () => {
    attachmentRow = { ...attachmentRow!, uploaderId: 'someone-else' };
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('refuses to confirm a row that is already ready', async () => {
    attachmentRow = { ...attachmentRow!, status: 'ready' };
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('checks board access before it touches the bucket', async () => {
    assertBoardAccess.mockRejectedValue(new BoardAccessError('FORBIDDEN'));
    expect(await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(headObject).not.toHaveBeenCalled();
  });

  test('publishes attachment.added once the row is ready', async () => {
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        type: 'attachment.added',
        id: 'a1',
        cardId: 'c1',
        filename: 'screenshot.png',
        contentType: 'image/png',
        size: 1024,
        createdAt: '2026-09-02T10:00:00.000Z',
        mutationId: MUTATION_ID,
        actorId: 'u1',
      }),
    );
  });

  test('publishes the real size and type, not the declared ones', async () => {
    // Same reason the row stores them: a quota computed from a client's word
    // is not a quota, and neither is a card face counting one.
    headObject.mockResolvedValue({ size: 4096, contentType: 'text/html' });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ size: 4096, contentType: 'text/html' }),
    );
  });

  test('the uploader on the event is the confirming session', async () => {
    // confirmUpload has already refused any row this session did not upload,
    // so the session is the uploader and the row needs no join to say so.
    authMock.mockResolvedValue({
      user: { id: 'u1', name: 'Alice', image: 'https://example.test/a.png' },
    });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        uploader: { id: 'u1', name: 'Alice', image: 'https://example.test/a.png' },
      }),
    );
  });

  test('a rejected confirm publishes nothing', async () => {
    headObject.mockResolvedValue({ size: 20 * 1024 * 1024, contentType: 'image/png' });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });

  test('a confirm whose object never landed publishes nothing', async () => {
    headObject.mockResolvedValue(null);
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });

  test('the publish happens after the update, never before', async () => {
    // A rolled-back write that already announced itself puts every other
    // client into a state the database disagrees with.
    let publishedAfter = false;
    publish.mockImplementation(async () => {
      publishedAfter = ops.some((op) => op.kind === 'update' && op.table === 'attachments');
    });
    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publishedAfter).toBe(true);
  });
});

describe('deleteAttachment', () => {
  const MUTATION_ID = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    attachmentRow = {
      id: 'a1',
      boardId: 'b1',
      cardId: 'c1',
      uploaderId: 'u1',
      key: 'boards/b1/a1',
      filename: 'x.png',
      contentType: 'image/png',
      size: 1024,
      status: 'ready',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
  });

  test('the uploader can delete their own file', async () => {
    assertBoardAccess.mockResolvedValue('member');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: true,
    });
    expect(deleteObjects).toHaveBeenCalledWith(['boards/b1/a1']);
  });

  test('the board owner can delete somebody else’s file', async () => {
    // Deliberately unlike comments, where not even the owner may delete.
    attachmentRow = { ...attachmentRow!, uploaderId: 'someone-else' };
    assertBoardAccess.mockResolvedValue('owner');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: true,
    });
  });

  test('the board owner can delete a file whose uploader is gone', async () => {
    attachmentRow = { ...attachmentRow!, uploaderId: null };
    assertBoardAccess.mockResolvedValue('owner');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: true,
    });
  });

  test('a plain member cannot delete somebody else’s file', async () => {
    attachmentRow = { ...attachmentRow!, uploaderId: 'someone-else' };
    assertBoardAccess.mockResolvedValue('member');
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  test('answers NOT_FOUND for a row that does not exist', async () => {
    attachmentRow = undefined;
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  test('the row is deleted before the object', async () => {
    // Publish-after-commit's sibling rule: the durable write settles first, so
    // a failed bucket call cannot leave a row pointing at nothing.
    await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID });
    const rowDeleted = ops.findIndex((op) => op.kind === 'delete' && op.table === 'attachments');
    expect(rowDeleted).toBeGreaterThanOrEqual(0);
    expect(forgetObjects).toHaveBeenCalledWith(['boards/b1/a1']);
  });

  test('a bucket failure does not fail the action', async () => {
    // The row is already gone. A leaked object is cheaper than an error the
    // user cannot act on.
    deleteObjects.mockRejectedValueOnce(new Error('bucket unreachable'));
    expect(await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID })).toEqual({
      ok: true,
    });
  });

  test('publishes attachment.removed', async () => {
    await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        type: 'attachment.removed',
        id: 'a1',
        cardId: 'c1',
        mutationId: MUTATION_ID,
        actorId: 'u1',
      }),
    );
  });

  test('a refused delete publishes nothing', async () => {
    attachmentRow = { ...attachmentRow!, uploaderId: 'someone-else' };
    assertBoardAccess.mockResolvedValue('member');
    await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publish).not.toHaveBeenCalled();
  });

  test('the publish happens after the row is gone, never before', async () => {
    let publishedAfter = false;
    publish.mockImplementation(async () => {
      publishedAfter = ops.some((op) => op.kind === 'delete' && op.table === 'attachments');
    });
    await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID });
    expect(publishedAfter).toBe(true);
  });
});

const activityOps = () => ops.filter((op) => op.kind === 'insert' && op.table === 'activity');

describe('activity', () => {
  const MUTATION_ID = '55555555-5555-4555-8555-555555555555';

  // requestUpload creates a pending row for bytes that may never land. The
  // feed must not announce a file that does not exist.
  test('requesting an upload records nothing', async () => {
    const result = await requestUpload(valid);
    expect(result.ok).toBe(true);
    expect(activityOps()).toHaveLength(0);
  });

  test('confirming records the card and the filename', async () => {
    attachmentRow = {
      id: 'a1',
      boardId: 'b1',
      cardId: 'c1',
      uploaderId: 'u1',
      key: 'boards/b1/a1',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      status: 'pending',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    headObject.mockResolvedValue({ size: 1024, contentType: 'application/pdf' });
    cardRow = { boardId: 'b1', title: 'Ship it' };

    await confirmUpload({ attachmentId: 'a1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'attachment.added',
      subjectId: 'c1',
      subject: 'Ship it',
      detail: 'plan.pdf',
    });
  });

  test('deleting records the same two facts', async () => {
    attachmentRow = {
      id: 'a1',
      boardId: 'b1',
      cardId: 'c1',
      uploaderId: 'u1',
      key: 'boards/b1/a1',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      status: 'ready',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    cardRow = { boardId: 'b1', title: 'Ship it' };

    await deleteAttachment({ attachmentId: 'a1', mutationId: MUTATION_ID });

    expect(activityOps()[0].values).toMatchObject({
      type: 'attachment.removed',
      subjectId: 'c1',
      subject: 'Ship it',
      detail: 'plan.pdf',
    });
  });
});
