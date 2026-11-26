import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryIdempotencyStore } from '../src/idempotency.ts';

describe('MemoryIdempotencyStore', () => {
  test('remembers keys until the TTL expires', () => {
    let now = 1_000;
    const store = new MemoryIdempotencyStore({ ttlMs: 100, now: () => now });

    store.add('evt-1');
    assert.equal(store.has('evt-1'), true);

    now = 1_101;
    assert.equal(store.has('evt-1'), false);
  });

  test('evicts the oldest key at capacity', () => {
    const store = new MemoryIdempotencyStore({ maxEntries: 2 });
    store.add('a');
    store.add('b');
    store.add('c');

    assert.equal(store.has('a'), false);
    assert.equal(store.has('b'), true);
    assert.equal(store.has('c'), true);
  });
});
