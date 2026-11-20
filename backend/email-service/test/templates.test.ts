import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../src/templates/index.ts';

const base = {
  to: 'friend@example.com',
  tripName: 'Toronto 2026',
  ownerName: 'Marco',
  code: 'abcDEF123_-x',
  joinUrl: 'https://triplanner.example.com/join?trip=t1&code=abcDEF123_-x',
};

function invite(overrides: Record<string, unknown> = {}) {
  return renderEmail(
    {
      id: 'evt-1',
      type: 'email.invite.v1',
      version: 1,
      occurredAt: '2026-11-19T10:00:00.000Z',
      source: 'test',
      payload: { ...base, role: 'viewer', language: 'es', ...overrides },
    },
    { appUrl: 'https://triplanner.example.com' },
  );
}

describe('invite template', () => {
  test('renders Spanish copy and the join URL by default', () => {
    const email = invite();
    assert.equal(email.subject, 'Marco te invita a "Toronto 2026" · demo');
    assert.ok(email.html.includes('Te invitaron a Toronto 2026'));
    assert.ok(email.html.includes('Invitación demo'));
    assert.ok(email.html.includes('Unirme al viaje'));
    assert.ok(email.html.includes('https://triplanner.example.com/join'));
    assert.ok(email.text.includes('Tu código de invitación: abcDEF123_-x'));
  });

  test('renders English copy when the recipient language is en', () => {
    const email = invite({ language: 'en', role: 'editor' });
    assert.equal(email.subject, 'Marco invited you to "Toronto 2026" · demo');
    assert.ok(email.html.includes('You were invited to Toronto 2026'));
    assert.ok(email.html.includes('Demo invitation'));
    assert.ok(email.html.includes('Join the trip'));
    assert.ok(email.html.includes('Role: Editor'));
  });

  test('escapes user-controlled copy', () => {
    const email = invite({ tripName: '<script>alert(1)</script>', ownerName: 'A & B' });
    assert.ok(!email.html.includes('<script>'));
    assert.ok(email.html.includes('&lt;script&gt;'));
    assert.ok(email.html.includes('A &amp; B'));
  });
});

describe('reminder template', () => {
  test('renders the activity, day and time in both languages', () => {
    const es = renderEmail(
      {
        id: 'evt-2',
        type: 'email.reminder.v1',
        version: 1,
        occurredAt: '2026-11-19T10:00:00.000Z',
        source: 'test',
        payload: {
          to: 'friend@example.com',
          tripName: 'Toronto 2026',
          itemTitle: 'CN Tower',
          day: '2026-11-20',
          startTime: '09:30',
          language: 'es',
        },
      },
      { appUrl: 'https://triplanner.example.com' },
    );
    assert.equal(es.subject, 'Recordatorio: CN Tower');
    assert.ok(es.text.includes('2026-11-20 a las 09:30'));

    const en = renderEmail(
      {
        id: 'evt-3',
        type: 'email.reminder.v1',
        version: 1,
        occurredAt: '2026-11-19T10:00:00.000Z',
        source: 'test',
        payload: {
          to: 'friend@example.com',
          tripName: 'Toronto 2026',
          itemTitle: 'CN Tower',
          day: '2026-11-20',
          startTime: '09:30',
          language: 'en',
        },
      },
      { appUrl: 'https://triplanner.example.com' },
    );
    assert.equal(en.subject, 'Reminder: CN Tower');
    assert.ok(en.text.includes('starts on 2026-11-20 at 09:30'));
  });
});

describe('verification and welcome templates', () => {
  test('verification greets the user and includes the link', () => {
    const email = renderEmail(
      {
        id: 'evt-4',
        type: 'email.verification.v1',
        version: 1,
        occurredAt: '2026-11-19T10:00:00.000Z',
        source: 'test',
        payload: {
          to: 'friend@example.com',
          link: 'https://triplanner.example.com/verify?token=abc',
          name: 'Ana',
          language: 'es',
        },
      },
      { appUrl: 'https://triplanner.example.com' },
    );
    assert.equal(email.subject, 'Confirma tu email en Triplanner');
    assert.ok(email.html.includes('Hola, Ana:'));
    assert.ok(email.text.includes('https://triplanner.example.com/verify?token=abc'));
  });

  test('welcome uses the configured app URL', () => {
    const email = renderEmail(
      {
        id: 'evt-5',
        type: 'email.welcome.v1',
        version: 1,
        occurredAt: '2026-11-19T10:00:00.000Z',
        source: 'test',
        payload: { to: 'friend@example.com', name: 'Ana', language: 'en' },
      },
      { appUrl: 'https://triplanner.example.com' },
    );
    assert.equal(email.subject, 'Welcome to Triplanner');
    assert.ok(email.html.includes('href="https://triplanner.example.com"'));
  });
});
