import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmailEvent, redactEmail } from '../src/events.ts';

function invite(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe('parseEmailEvent', () => {
  test('accepts a valid invite envelope', () => {
    const result = parseEmailEvent(invite());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.type, 'email.invite.v1');
    assert.equal(result.event.payload.to, 'friend@example.com');
  });

  test('rejects an unknown type', () => {
    const result = parseEmailEvent(invite({ type: 'email.spam.v9' }));
    assert.deepEqual(result, { ok: false, reason: 'unsupported event type: email.spam.v9' });
  });

  test('rejects a future schema version', () => {
    const result = parseEmailEvent(invite({ version: 2 }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /version/);
  });

  test('rejects an invalid recipient', () => {
    const event = invite();
    (event.payload as Record<string, unknown>).to = 'not-an-email';
    const result = parseEmailEvent(event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /payload\.to/);
  });

  test('rejects a non-http join URL', () => {
    const event = invite();
    (event.payload as Record<string, unknown>).joinUrl = 'javascript:alert(1)';
    const result = parseEmailEvent(event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /payload\.joinUrl/);
  });

  test('rejects an invalid invite role', () => {
    const event = invite();
    (event.payload as Record<string, unknown>).role = 'admin';
    const result = parseEmailEvent(event);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /payload\.role/);
  });

  test('validates reminder day and time', () => {
    const event = invite({
      type: 'email.reminder.v1',
      payload: {
        to: 'friend@example.com',
        tripName: 'Toronto 2026',
        itemTitle: 'CN Tower',
        day: '2026-11-20',
        startTime: '09:30',
        language: 'en',
      },
    });
    assert.equal(parseEmailEvent(event).ok, true);

    (event.payload as Record<string, unknown>).startTime = '25:00';
    assert.equal(parseEmailEvent(event).ok, false);
  });

  test('normalizes unknown languages to Spanish', () => {
    const event = invite();
    (event.payload as Record<string, unknown>).language = 'fr';
    const result = parseEmailEvent(event);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.event.payload.language, 'es');
  });

  test('rejects a non-object event', () => {
    assert.equal(parseEmailEvent('nope').ok, false);
    assert.equal(parseEmailEvent(null).ok, false);
  });
});

describe('redactEmail', () => {
  test('keeps the domain and hides the local part', () => {
    assert.equal(redactEmail('marco@example.com'), 'm***@example.com');
    assert.equal(redactEmail('a@example.com'), '***@example.com');
  });

  test('handles malformed input', () => {
    assert.equal(redactEmail('nope'), '***');
    assert.equal(redactEmail('@example.com'), '***');
  });
});
