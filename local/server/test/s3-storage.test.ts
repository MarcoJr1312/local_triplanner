// S3 storage integration tests against MinIO from docker-compose.
// Skips when MinIO is unreachable.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStorage, LocalDiskStorage, S3Storage } from '../src/storage.ts';

const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const bucket = process.env.S3_TEST_BUCKET ?? 'triplanner-test';

let storage: S3Storage | null = null;

before(async () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const candidate = new S3Storage(bucket, {
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'triplanner', secretAccessKey: 'triplanner123' },
      });
      await candidate.ensureBucket();
      storage = candidate;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  storage = null;
});

after(async () => {
  await storage?.deletePrefix('test/');
});

beforeEach(async () => {
  await storage?.deletePrefix('test/');
});

describe('S3 storage', () => {
  test('writes, reads and deletes an object', async () => {
    if (!storage) return;
    const bytes = Buffer.from('boleto de prueba');

    await storage.put('test/attachments/a.pdf', bytes, 'application/pdf');
    assert.deepEqual(await storage.read('test/attachments/a.pdf'), bytes);

    await storage.delete('test/attachments/a.pdf');
    assert.equal(await storage.read('test/attachments/a.pdf'), null);
  });

  test('deleting a missing object is a no-op', async () => {
    if (!storage) return;
    await storage.delete('test/never-existed.pdf');
    assert.equal(await storage.read('test/never-existed.pdf'), null);
  });

  test('deletePrefix removes every object under the prefix', async () => {
    if (!storage) return;
    await storage.put('test/trip-1/one.pdf', Buffer.from('1'));
    await storage.put('test/trip-1/two.pdf', Buffer.from('2'));
    await storage.put('test/trip-2/three.pdf', Buffer.from('3'));

    await storage.deletePrefix('test/trip-1');

    assert.equal(await storage.read('test/trip-1/one.pdf'), null);
    assert.equal(await storage.read('test/trip-1/two.pdf'), null);
    assert.deepEqual(await storage.read('test/trip-2/three.pdf'), Buffer.from('3'));
  });

  test('publicPath stays same-origin so /uploads can validate the signature', () => {
    if (!storage) return;
    assert.equal(storage.publicPath('attachments/x/y.pdf'), '/uploads/attachments/x/y.pdf');
  });

  test('defaultStorage picks S3 when S3_BUCKET is set, disk otherwise', () => {
    const previous = process.env.S3_BUCKET;
    try {
      delete process.env.S3_BUCKET;
      assert.ok(defaultStorage() instanceof LocalDiskStorage);

      process.env.S3_BUCKET = 'triplanner-uploads';
      assert.ok(defaultStorage() instanceof S3Storage);
    } finally {
      if (previous === undefined) delete process.env.S3_BUCKET;
      else process.env.S3_BUCKET = previous;
    }
  });
});
