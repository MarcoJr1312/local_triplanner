import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '../src/logger.ts';
import { createSettingsProvider } from '../src/providers/router.ts';
import type { OutgoingEmail } from '../src/providers/types.ts';
import { EmailSettingsStore } from '../src/settings.ts';

function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

const message: OutgoingEmail = {
  to: 'friend@example.com',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  idempotencyKey: 'evt-1',
  eventId: 'evt-1',
  eventType: 'email.invite.v1',
};

describe('settings provider router', () => {
  test('switches between sink and Resend without a restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'triplanner-email-router-'));
    try {
      const store = new EmailSettingsStore({
        filePath: path.join(dir, 'email.json'),
        defaults: {
          provider: 'sink',
          apiKey: '',
          from: 'Triplanner <onboarding@resend.dev>',
          replyTo: '',
        },
        logger: silentLogger(),
      });

      const authHeaders: string[] = [];
      const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
        authHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
        return new Response(JSON.stringify({ id: 're_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const provider = createSettingsProvider(store, silentLogger(), {
        endpoint: 'https://api.resend.com/emails',
        timeoutMs: 1_000,
        fetchImpl,
      });

      assert.equal(provider.name, 'sink');
      const sinkReceipt = await provider.send(message);
      assert.match(sinkReceipt.providerMessageId, /^sink\//);

      store.update({ provider: 'resend', apiKey: 're_one', from: 'Triplanner <a@example.com>' });
      assert.equal(provider.name, 'resend');
      assert.equal(provider.ready().ok, true);
      const first = await provider.send(message);
      assert.equal(first.providerMessageId, 're_1');
      assert.equal(authHeaders[0], 'Bearer re_one');

      store.update({ provider: 'resend', apiKey: 're_two', from: 'Triplanner <a@example.com>' });
      await provider.send(message);
      assert.equal(authHeaders[1], 'Bearer re_two');

      store.update({ provider: 'sink', clearKey: true });
      assert.equal(provider.name, 'sink');
      await provider.send(message);
      assert.equal(authHeaders.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
