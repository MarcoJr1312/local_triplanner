import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createEmailSettingsClient, EmailSettingsError } from '../src/email-settings.ts';

describe('email settings client', () => {
  let server: Server;
  let baseUrl: string;
  let lastToken: string | undefined;
  let lastBody: Record<string, unknown> | undefined;

  before(async () => {
    server = createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload);
      };

      if (req.method === 'GET' && req.url === '/api/email/config') {
        send(200, {
          provider: 'sink',
          from: 'Triplanner <onboarding@resend.dev>',
          replyTo: '',
          hasKey: false,
          ready: true,
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/email/config') {
        lastToken = req.headers['x-internal-token'] as string | undefined;
        let raw = '';
        req.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8');
        });
        req.on('end', () => {
          lastBody = JSON.parse(raw) as Record<string, unknown>;
          if (lastToken !== 'test-token') {
            send(401, { error: { code: 'AUTH_INVALID', message: 'invalid internal token' } });
            return;
          }
          if (lastBody.provider === 'smtp') {
            send(400, { error: { code: 'EMAIL_CONFIG_INVALID', message: 'provider must be sink or resend' } });
            return;
          }
          if (lastBody.provider === 'explode') {
            send(500, { error: { code: 'EMAIL_SETTINGS_PERSIST_FAILED', message: 'disk full' } });
            return;
          }
          send(200, {
            provider: 'resend',
            from: 'Triplanner <viajes@example.com>',
            replyTo: '',
            hasKey: true,
            ready: true,
          });
        });
        return;
      }

      send(404, { error: { code: 'not_found', message: 'not found' } });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test('reads public settings without a key', async () => {
    const client = createEmailSettingsClient({ baseUrl, token: 'test-token' });
    const settings = await client.get();
    assert.equal(settings.provider, 'sink');
    assert.equal(settings.hasKey, false);
    assert.equal(settings.ready, true);
  });

  test('sends the internal token and update payload', async () => {
    const client = createEmailSettingsClient({ baseUrl, token: 'test-token' });
    const settings = await client.update({
      provider: 'resend',
      apiKey: 're_secret',
      from: 'Triplanner <viajes@example.com>',
      replyTo: '',
    });
    assert.equal(settings.provider, 'resend');
    assert.equal(settings.hasKey, true);
    assert.equal(lastToken, 'test-token');
    assert.equal(lastBody?.provider, 'resend');
    assert.equal(lastBody?.apiKey, 're_secret');
  });

  test('maps a validation error to EMAIL_CONFIG_INVALID', async () => {
    const client = createEmailSettingsClient({ baseUrl, token: 'test-token' });
    await assert.rejects(
      client.update({ provider: 'smtp' }),
      (error: unknown) =>
        error instanceof EmailSettingsError && error.code === 'EMAIL_CONFIG_INVALID',
    );
  });

  test('maps a server error to EMAIL_SETTINGS_FAILED', async () => {
    const client = createEmailSettingsClient({ baseUrl, token: 'test-token' });
    await assert.rejects(
      client.update({ provider: 'explode' }),
      (error: unknown) =>
        error instanceof EmailSettingsError && error.code === 'EMAIL_SETTINGS_FAILED',
    );
  });

  test('rejects with EMAIL_SETTINGS_FAILED when the service is unreachable', async () => {
    const client = createEmailSettingsClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token' });
    await assert.rejects(
      client.get(),
      (error: unknown) =>
        error instanceof EmailSettingsError && error.code === 'EMAIL_SETTINGS_FAILED',
    );
  });
});
