import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startHttpServer, type HttpHandle } from '../src/http.ts';
import type { Logger } from '../src/logger.ts';
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

describe('email service HTTP surface', () => {
  let dir: string;
  let handle: HttpHandle;
  let base: string;

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'triplanner-email-http-'));
    const settings = new EmailSettingsStore({
      filePath: path.join(dir, 'email.json'),
      defaults: {
        provider: 'sink',
        apiKey: '',
        from: 'Triplanner <onboarding@resend.dev>',
        replyTo: '',
      },
      logger: silentLogger(),
    });
    handle = await startHttpServer({
      port: 0,
      logger: silentLogger(),
      settings,
      internalToken: 'test-token',
      getState: () => ({
        ready: true,
        provider: 'sink',
        providerReady: true,
        kafkaReady: true,
      }),
    });
    base = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('GET /health and /ready answer for probes', async () => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    assert.equal(((await ready.json()) as { status: string }).status, 'ready');
  });

  test('GET /api/email/config never returns the key', async () => {
    const res = await fetch(`${base}/api/email/config`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.provider, 'sink');
    assert.equal(body.hasKey, false);
    assert.equal('apiKey' in body, false);
  });

  test('POST /api/email/config rejects a missing or wrong token', async () => {
    const missing = await fetch(`${base}/api/email/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'resend' }),
    });
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${base}/api/email/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'nope' },
      body: JSON.stringify({ provider: 'resend' }),
    });
    assert.equal(wrong.status, 401);
  });

  test('POST /api/email/config saves a Resend key without echoing it', async () => {
    const res = await fetch(`${base}/api/email/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'test-token' },
      body: JSON.stringify({
        provider: 'resend',
        apiKey: 're_secret_key',
        from: 'Triplanner <viajes@example.com>',
        replyTo: 'support@example.com',
      }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('re_secret_key'));
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal(body.provider, 'resend');
    assert.equal(body.hasKey, true);
    assert.equal(body.ready, true);
  });

  test('POST /api/email/config rejects an invalid provider', async () => {
    const res = await fetch(`${base}/api/email/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'test-token' },
      body: JSON.stringify({ provider: 'smtp' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'EMAIL_CONFIG_INVALID');
  });
});
