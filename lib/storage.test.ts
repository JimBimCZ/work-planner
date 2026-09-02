import { beforeAll, describe, expect, test } from 'vitest';

import {
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

  test('two signatures inside one window produce the same URL', async () => {
    // The cost argument rests on this: a fresh URL per render is a browser cache
    // miss and another billable Class B operation. If this cannot be made to
    // pass, delete the optimisation rather than keeping an option that does
    // nothing — see the note in presignGet.
    const [a, b] = await Promise.all([
      presignGet(key, 'x.png', true),
      presignGet(key, 'x.png', true),
    ]);
    expect(a).toBe(b);
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
