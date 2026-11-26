import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createResendProvider } from '../src/providers/resend.ts';
import { EmailProviderError, type OutgoingEmail } from '../src/providers/types.ts';

const message: OutgoingEmail = {
  to: 'friend@example.com',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  idempotencyKey: 'evt-1',
  eventId: 'evt-1',
  eventType: 'email.invite.v1',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchInput = string | URL | Request;

function mockFetch(handler: (input: FetchInput, init?: RequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

async function expectProviderError(promise: Promise<unknown>): Promise<EmailProviderError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof EmailProviderError);
    return error;
  }
  assert.fail('expected the provider to reject');
}

describe('Resend provider', () => {
  test('posts the email with auth and idempotency headers', async () => {
    let captured: { input: FetchInput; init?: RequestInit } | undefined;
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      replyTo: 'support@example.com',
      fetchImpl: mockFetch(async (input, init) => {
        captured = { input, init };
        return response({ id: 're_123' });
      }),
    });

    const receipt = await provider.send(message);
    assert.equal(receipt.providerMessageId, 're_123');
    assert.equal(String(captured?.input), 'https://api.resend.com/emails');

    const headers = new Headers(captured?.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer re_test_key');
    assert.equal(headers.get('idempotency-key'), 'evt-1');

    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    assert.equal(body.from, 'Triplanner <viajes@example.com>');
    assert.deepEqual(body.to, ['friend@example.com']);
    assert.equal(body.reply_to, 'support@example.com');
  });

  test('classifies 429 as retryable', async () => {
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () => response({ name: 'rate_limit_exceeded' }, 429)),
    });
    const error = await expectProviderError(provider.send(message));
    assert.equal(error.retryable, true);
    assert.equal(error.status, 429);
  });

  test('classifies 422 as non-retryable', async () => {
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () => response({ name: 'validation_error' }, 422)),
    });
    const error = await expectProviderError(provider.send(message));
    assert.equal(error.retryable, false);
    assert.equal(error.status, 422);
  });

  test('treats a concurrent idempotent request as retryable, but a payload conflict as terminal', async () => {
    const concurrent = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () => response({ name: 'concurrent_idempotent_requests' }, 409)),
    });
    assert.equal((await expectProviderError(concurrent.send(message))).retryable, true);

    const conflict = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () => response({ name: 'invalid_idempotent_request' }, 409)),
    });
    assert.equal((await expectProviderError(conflict.send(message))).retryable, false);
  });

  test('classifies a network failure as retryable', async () => {
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () => {
        throw new TypeError('network down');
      }),
    });
    const error = await expectProviderError(provider.send(message));
    assert.equal(error.retryable, true);
  });

  test('classifies a timeout as retryable', async () => {
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      timeoutMs: 10,
      fetchImpl: mockFetch(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    });
    const error = await expectProviderError(provider.send(message));
    assert.equal(error.retryable, true);
    assert.match(error.message, /timed out/);
  });

  test('redacts recipient addresses from provider error messages', async () => {
    const provider = createResendProvider({
      apiKey: 're_test_key',
      from: 'Triplanner <viajes@example.com>',
      fetchImpl: mockFetch(async () =>
        response({ name: 'validation_error', message: 'Invalid recipient marco@example.com' }, 422),
      ),
    });
    const error = await expectProviderError(provider.send(message));
    assert.ok(!error.message.includes('marco@example.com'));
    assert.ok(error.message.includes('[redacted]'));
  });

  test('reports readiness without a key', () => {
    const provider = createResendProvider({ apiKey: '', from: 'Triplanner <viajes@example.com>' });
    assert.deepEqual(provider.ready(), { ok: false, reason: 'RESEND_API_KEY is empty' });
  });
});
