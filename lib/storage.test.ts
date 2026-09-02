import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  contentDisposition,
  deleteObjects,
  headObject,
  objectKey,
  presignGet,
  presignPut,
  storageConfigured,
} from '@/lib/storage';

test('storage is configured in CI, so the suite below never silently skips', () => {
  // A skipped integration suite reports as a pass. CLAUDE.md's rule about a
  // passing count not being a passing suite is exactly this failure mode.
  if (process.env.CI === 'true') expect(storageConfigured()).toBe(true);
});

describe.skipIf(!storageConfigured())('round trip against a real bucket', () => {
  const key = objectKey('board-storage-test', `att-${Date.now()}`);
  const body = Buffer.from('hello attachment');

  beforeAll(async () => {
    const url = await presignPut(key, 'text/plain');
    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'content-type': 'text/plain' },
    });
    expect(response.ok, `presigned PUT failed: ${response.status}`).toBe(true);
  });

  test('headObject reads back the real size and type', async () => {
    const head = await headObject(key);
    expect(head).not.toBeNull();
    expect(head?.size).toBe(body.byteLength);
    expect(head?.contentType).toBe('text/plain');
  });

  test('headObject answers null for an object that is not there', async () => {
    expect(await headObject(objectKey('board-storage-test', 'never-uploaded'))).toBeNull();
  });

  test('a presigned GET returns the bytes and names the file', async () => {
    const url = await presignGet(key, 'greeting.txt', false);
    const response = await fetch(url);
    expect(await response.text()).toBe('hello attachment');
    expect(response.headers.get('content-disposition')).toContain('greeting.txt');
    expect(response.headers.get('content-disposition')).toContain('attachment');
  });

  test('two signings inside one five-minute window produce the same URL', async () => {
    // The cost argument rests on this: a fresh URL per render is a browser cache
    // miss and another billable Class B operation. Driving the clock is the
    // point — two calls in the same Promise.all land in the same JS tick, and
    // SigV4's X-Amz-Date has second granularity, so that would pass even with
    // the rounding deleted. If this cannot be made to pass, delete the
    // optimisation rather than keeping an option that does nothing — see the
    // note in presignGet.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:10.000Z'));
      const a = await presignGet(key, 'x.png', true);
      vi.setSystemTime(new Date('2026-01-01T12:03:20.000Z'));
      const b = await presignGet(key, 'x.png', true);
      expect(a).toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  test('two signings across a five-minute window boundary produce different URLs', async () => {
    // The other half of the same guard: without this case, the test above
    // could pass with the window made arbitrarily wide (or infinite) and
    // never notice.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T12:04:59.000Z'));
      const a = await presignGet(key, 'x.png', true);
      vi.setSystemTime(new Date('2026-01-01T12:05:01.000Z'));
      const b = await presignGet(key, 'x.png', true);
      expect(a).not.toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  test('deleteObjects removes it', async () => {
    await deleteObjects([key]);
    expect(await headObject(key)).toBeNull();
  });

  test('deleting nothing is not an error', async () => {
    // deleteCard on a card with no attachments calls this with an empty list.
    await expect(deleteObjects([])).resolves.toBeUndefined();
  });
});

test('the object key puts the board in the prefix', () => {
  // The board prefix is what makes deleting a whole board's objects one
  // listing rather than a query per card.
  expect(objectKey('b1', 'a1')).toBe('boards/b1/a1');
});

describe('contentDisposition', () => {
  // Unit-tested outside the MinIO-gated block above so it always runs — this
  // is the sanitiser whose Latin-1-only quoted form let non-ASCII filenames
  // ship corrupted.
  test('a plain ASCII name', () => {
    expect(contentDisposition('greeting.txt', false)).toBe(
      "attachment; filename=\"greeting.txt\"; filename*=UTF-8''greeting.txt",
    );
  });

  test('an accented name gets a UTF-8 filename* alongside the quoted form', () => {
    const result = contentDisposition('Příloha-café.pdf', false);
    expect(result).toContain('filename="Příloha-café.pdf"');
    expect(result).toContain("filename*=UTF-8''" + encodeURIComponent('Příloha-café.pdf'));
  });

  test('a name containing a double quote has it stripped from the quoted form', () => {
    const result = contentDisposition('quo"te.png', true);
    expect(result).toMatch(/^inline; /);
    expect(result).toContain('filename="quote.png"');
    expect(result).toContain("filename*=UTF-8''" + encodeURIComponent('quo"te.png'));
  });

  test('a name ending in a backslash has it stripped from the quoted form', () => {
    const result = contentDisposition('trailing\\', false);
    expect(result).toContain('filename="trailing"');
    expect(result).toContain("filename*=UTF-8''" + encodeURIComponent('trailing\\'));
  });
});
