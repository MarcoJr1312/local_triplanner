import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEmailEvent, type HandleEmailEventDeps } from '../src/handler.ts';
import { MemoryIdempotencyStore } from '../src/idempotency.ts';
import type { Logger } from '../src/logger.ts';
import { EmailProviderError, type EmailProvider, type OutgoingEmail, type SendReceipt } from '../src/providers/types.ts';
import type { RenderedEmail } from '../src/templates/types.ts';

function inviteEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-0001',
    type: 'email.invite.v1',
    version: 1,
    occurredAt: '2026-11-19T10:00:00.000Z',
    source: 'triplanner-api',
    payload: {
      to: 'friend@example.com',
      tripName: 'Toronto 2026',
      ownerName: 'Marco',
      code: 'abcDEF123_-x',
      joinUrl: 'https://triplanner.example.com/join?trip=t1&code=abcDEF123_-x',
      role: 'viewer',
      language: 'es',
    },
    ...overrides,
  };
}

type Outcome = { kind: 'ok'; id?: string } | { kind: 'error'; error: EmailProviderError };

function fakeProvider(outcomes: Outcome[] = []): { provider: EmailProvider; calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  const provider: EmailProvider = {
    name: 'fake',
    ready: () => ({ ok: true }),
    async send(email: OutgoingEmail): Promise<SendReceipt> {
      calls.push(email);
      const outcome = outcomes.shift();
      if (!outcome || outcome.kind === 'ok') return { providerMessageId: outcome?.id ?? 'msg-1' };
      throw outcome.error;
    },
  };
  return { provider, calls };
}

function captureLogger(): { logger: Logger; entries: Record<string, unknown>[] } {
  const entries: Record<string, unknown>[] = [];
  const push = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
    entries.push({ level, msg, ...fields });
  };
  const logger: Logger = {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: () => logger,
  };
  return { logger, entries };
}

const rendered: RenderedEmail = { subject: 'Subject', html: '<p>html</p>', text: 'text' };

function deps(overrides: Partial<HandleEmailEventDeps> = {}): HandleEmailEventDeps {
  const { provider } = fakeProvider();
  return {
    provider,
    render: () => rendered,
    logger: captureLogger().logger,
    idempotency: new MemoryIdempotencyStore(),
    sleep: async () => {},
    baseDelayMs: 10,
    jitterRatio: 0,
    ...overrides,
  };
}

describe('handleEmailEvent', () => {
  test('sends a valid event and uses the event id as the idempotency key', async () => {
    const { provider, calls } = fakeProvider([{ kind: 'ok', id: 're_123' }]);
    const result = await handleEmailEvent(inviteEvent(), deps({ provider }));

    assert.equal(result.status, 'sent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.idempotencyKey, 'evt-0001');
    assert.equal(calls[0]?.to, 'friend@example.com');
    if (result.status === 'sent') assert.equal(result.providerMessageId, 're_123');
  });

  test('retries a transient failure and then succeeds', async () => {
    const { provider, calls } = fakeProvider([
      { kind: 'error', error: new EmailProviderError('Resend HTTP 503', true, 503) },
      { kind: 'ok' },
    ]);
    const sleeps: number[] = [];
    const result = await handleEmailEvent(
      inviteEvent(),
      deps({ provider, sleep: async (ms) => { sleeps.push(ms); } }),
    );

    assert.equal(result.status, 'sent');
    if (result.status === 'sent') assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [10]);
  });

  test('does not retry a non-retryable failure', async () => {
    const { provider, calls } = fakeProvider([
      { kind: 'error', error: new EmailProviderError('Resend HTTP 422', false, 422) },
    ]);
    const result = await handleEmailEvent(inviteEvent(), deps({ provider }));

    assert.equal(result.status, 'dead-letter');
    assert.equal(calls.length, 1);
    if (result.status === 'dead-letter') {
      assert.equal(result.attempts, 1);
      assert.match(result.reason, /422/);
    }
  });

  test('moves to dead-letter after exhausting retries', async () => {
    const { provider, calls } = fakeProvider([
      { kind: 'error', error: new EmailProviderError('network', true) },
      { kind: 'error', error: new EmailProviderError('network', true) },
      { kind: 'error', error: new EmailProviderError('network', true) },
    ]);
    const sleeps: number[] = [];
    const result = await handleEmailEvent(
      inviteEvent(),
      deps({ provider, maxAttempts: 3, sleep: async (ms) => { sleeps.push(ms); } }),
    );

    assert.equal(result.status, 'dead-letter');
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [10, 20]);
    if (result.status === 'dead-letter') assert.match(result.reason, /retries exhausted/);
  });

  test('skips an event already seen in this process', async () => {
    const { provider, calls } = fakeProvider([{ kind: 'ok' }, { kind: 'ok' }]);
    const idempotency = new MemoryIdempotencyStore();
    const shared = deps({ provider, idempotency });

    const first = await handleEmailEvent(inviteEvent(), shared);
    const second = await handleEmailEvent(inviteEvent(), shared);

    assert.equal(first.status, 'sent');
    assert.equal(second.status, 'duplicate');
    assert.equal(calls.length, 1);
  });

  test('routes a malformed event to dead-letter without calling the provider', async () => {
    const { provider, calls } = fakeProvider();
    const result = await handleEmailEvent({ type: 'nope' }, deps({ provider }));

    assert.equal(result.status, 'dead-letter');
    assert.equal(calls.length, 0);
  });

  test('routes a render failure to dead-letter', async () => {
    const { provider, calls } = fakeProvider();
    const result = await handleEmailEvent(
      inviteEvent(),
      deps({
        provider,
        render: () => {
          throw new Error('template bug');
        },
      }),
    );

    assert.equal(result.status, 'dead-letter');
    assert.equal(calls.length, 0);
    if (result.status === 'dead-letter') assert.match(result.reason, /template bug/);
  });

  test('never logs the full recipient address', async () => {
    const { provider } = fakeProvider([{ kind: 'ok' }]);
    const { logger, entries } = captureLogger();
    await handleEmailEvent(inviteEvent(), deps({ provider, logger }));

    const serialized = JSON.stringify(entries);
    assert.ok(!serialized.includes('friend@example.com'));
    assert.ok(serialized.includes('f***@example.com'));
  });
});
