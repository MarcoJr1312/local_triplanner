import { describe, expect, test } from 'bun:test';
import { createShutdown } from '../src/shutdown.ts';

describe('createShutdown', () => {
  test('stops the server, closes the pool and exits 0', async () => {
    const calls: string[] = [];
    const shutdown = createShutdown({
      server: { stop: () => { calls.push('stop'); } },
      db: { close: async () => { calls.push('close'); } },
      timeoutMs: 1_000,
      exit: (code) => { calls.push(`exit:${code}`); },
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['stop', 'close', 'exit:0']);
  });

  test('runs beforeClose before stopping', async () => {
    const calls: string[] = [];
    const shutdown = createShutdown({
      server: { stop: () => { calls.push('stop'); } },
      db: { close: async () => { calls.push('close'); } },
      timeoutMs: 1_000,
      exit: (code) => { calls.push(`exit:${code}`); },
      beforeClose: async () => { calls.push('before'); },
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['before', 'stop', 'close', 'exit:0']);
  });

  test('is idempotent across concurrent signals', async () => {
    let stopCalls = 0;
    const exits: number[] = [];
    const shutdown = createShutdown({
      server: { stop: () => { stopCalls += 1; } },
      db: { close: async () => undefined },
      timeoutMs: 1_000,
      exit: (code) => { exits.push(code); },
    });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(stopCalls).toBe(1);
    expect(exits).toEqual([0]);
  });

  test('exits after the timeout when the pool close hangs', async () => {
    const exits: number[] = [];
    const shutdown = createShutdown({
      server: { stop: () => undefined },
      db: { close: () => new Promise<void>(() => undefined) },
      timeoutMs: 10,
      exit: (code) => { exits.push(code); },
    });

    const started = Date.now();
    await shutdown('SIGTERM');

    expect(exits).toEqual([0]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('still exits when closing the server throws', async () => {
    const exits: number[] = [];
    const messages: string[] = [];
    const shutdown = createShutdown({
      server: { stop: () => { throw new Error('stop failed'); } },
      db: { close: async () => undefined },
      timeoutMs: 1_000,
      exit: (code) => { exits.push(code); },
      log: (message) => { messages.push(message); },
    });

    await shutdown('SIGTERM');

    expect(exits).toEqual([0]);
    expect(messages.join('\n')).toContain('stop failed');
  });
});
