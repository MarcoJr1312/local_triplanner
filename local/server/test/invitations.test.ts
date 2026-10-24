// Tests de invitaciones + email Resend con fetch MOCKEADO (cero emails reales).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateInviteCode,
  isInviteCodeValid,
  createInvitation,
  findInvitationByCode,
  acceptInvitation,
  isEmailMatch,
} from '../src/invitations.ts';
import { buildJoinUrl, inviteEmailHtml, inviteEmailText, sendInviteEmail, verificationEmailHtml, verificationEmailText } from '../src/email.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'db', 'schema.sql');
const SCHEMA = fs.readFileSync(SCHEMA_PATH, 'utf8');

function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO users (id, email, display_name, color) VALUES (?,?,?,?)')
    .run('u-owner', 'owner@x.com', 'Ana', '#6C3BFF');
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('demo-user', 'demo@triplanner.local', 'Demo', '#64748b')").run();
  db.prepare(`
    INSERT INTO trips (id, name, destination_name, owner_id, start_date, end_date, total_budget, invite_code, created_at, updated_at)
    VALUES ('trip-1', 'Viaje a Panama', 'Panama City', 'u-owner', '2026-11-01', '2026-11-05', 500, 'ABC12345', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z')
  `).run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'u-owner', 'owner')").run();
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES ('trip-1', 'demo-user', 'viewer')").run();
  return db;
}

// ---- codigo ----

test('generateInviteCode: 12 chars URL-safe y unico', () => {
  const a = generateInviteCode();
  const b = generateInviteCode();
  assert.equal(a.length, 12);
  assert.match(a, /^[A-Za-z0-9_-]{12}$/);
  assert.notEqual(a, b);
  assert.ok(isInviteCodeValid(a));
  assert.ok(!isInviteCodeValid('corto'));
  assert.ok(!isInviteCodeValid('abc!defghijkl'));
  assert.ok(!isInviteCodeValid(null));
});

// ---- invitaciones ----

test('createInvitation: pending ligada al email (lowercase)', () => {
  const db = memoryDb();
  const inv = createInvitation(db, { tripId: 'trip-1', email: 'Maria@X.com', createdBy: 'u-owner' });
  assert.equal(inv.status, 'pending');
  assert.equal(inv.email, 'maria@x.com');
  assert.equal(inv.role, 'viewer');
  assert.equal(inv.trip_id, 'trip-1');
  const found = findInvitationByCode(db, inv.code);
  assert.ok(found);
  assert.equal(found?.id, inv.id);
});

test('acceptInvitation: pending -> accepted con fecha', () => {
  const db = memoryDb();
  const inv = createInvitation(db, { tripId: 'trip-1', email: 'x@y.com', createdBy: 'u-owner' });
  acceptInvitation(db, inv.id);
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id) as { status: string; accepted_at: string | null };
  assert.equal(row.status, 'accepted');
  assert.ok(row.accepted_at);
});

test('isEmailMatch: case-insensitive y con espacios', () => {
  const db = memoryDb();
  const inv = createInvitation(db, { tripId: 'trip-1', email: 'Maria@X.com', createdBy: 'u-owner' });
  assert.ok(isEmailMatch(inv, 'maria@x.com'));
  assert.ok(isEmailMatch(inv, '  Maria@X.com  '));
  assert.ok(!isEmailMatch(inv, 'otro@x.com'));
});

test('findInvitationByCode: codigo inexistente -> null', () => {
  const db = memoryDb();
  assert.equal(findInvitationByCode(db, 'ABCDEFGHIJKL'), null);
});

// ---- email ----

test('buildJoinUrl: usa APP_URL y codifica trip+code', () => {
  const url = new URL(buildJoinUrl('trip-1', 'abcdEFGH1234'));
  assert.equal(url.pathname, '/join');
  assert.equal(url.searchParams.get('trip'), 'trip-1');
  assert.equal(url.searchParams.get('code'), 'abcdEFGH1234');
});

test('inviteEmailHtml: contiene marca, codigo y link (HTML escapado)', () => {
  const html = inviteEmailHtml({ tripName: 'Viaje <a> Panama', ownerName: 'Ana', code: 'ABCD1234EFGH', joinUrl: 'http://x/join?trip=1&code=ABCD1234EFGH' });
  assert.ok(html.includes('#6C3BFF'));
  assert.ok(html.includes('ABCD1234EFGH'));
  assert.ok(html.includes('http://x/join?trip=1&amp;code=ABCD1234EFGH'));
  assert.ok(!html.includes('Viaje <a> Panama'), 'debe escapar HTML del nombre');
  assert.ok(html.includes('Unirme al viaje'));
});

test('inviteEmailText: texto plano con codigo y link', () => {
  const text = inviteEmailText({ tripName: 'Viaje', ownerName: 'Ana', code: 'ABCD1234EFGH', joinUrl: 'http://x/join' });
  assert.ok(text.includes('ABCD1234EFGH'));
  assert.ok(text.includes('http://x/join'));
});

test('verificationEmailHtml: con nombre incluye saludo escapado y mantiene el look', () => {
  const html = verificationEmailHtml('http://x/verify?oobCode=ABC', 'Ana <b>');
  assert.ok(html.includes('#6C3BFF'), 'mantiene el look oscuro compartido');
  assert.ok(html.includes('Hola, Ana &lt;b&gt;:'), 'saludo personalizado escapado');
  assert.ok(!html.includes('Ana <b>'), 'escapa HTML del nombre');
  assert.ok(html.includes('Confirma tu email'));
});

test('verificationEmailHtml: sin nombre no incluye saludo', () => {
  const html = verificationEmailHtml('http://x/verify?oobCode=ABC');
  assert.ok(!html.includes('Hola,'));
  assert.ok(html.includes('Confirma tu email'));
});

test('verificationEmailText: con nombre saluda; sin nombre no', () => {
  const withName = verificationEmailText('http://x/verify', 'Ana');
  assert.ok(withName.startsWith('Hola, Ana:'));
  assert.ok(withName.includes('http://x/verify'));
  const withoutName = verificationEmailText('http://x/verify');
  assert.ok(!withoutName.includes('Hola,'));
  assert.ok(withoutName.includes('http://x/verify'));
});

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('sendInviteEmail: POST correcto a Resend sin exponer la key', async () => {
  const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fake: FakeFetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), auth: headers['Authorization'] ?? null, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return jsonResponse({ id: 'res-123' });
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake;
  // La key se lee del env al importar; se fuerza via variables del proceso
  process.env.RESEND_API_KEY = 're_test_abc123';
  try {
    const res = await sendInviteEmail({ to: 'a@b.com', tripName: 'Viaje', ownerName: 'Ana', code: 'ABCD1234EFGH', joinUrl: 'http://x/join' });
    assert.equal(res.id, 'res-123');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.resend.com/emails');
  assert.equal(calls[0]?.auth, 'Bearer re_test_abc123');
  assert.equal((calls[0]?.body as { to: string[] }).to[0], 'a@b.com');
  assert.ok(String(calls[0]?.body.html).includes('ABCD1234EFGH'));
});

test('sendInviteEmail: HTTP no-OK -> error descriptivo sin la key', async () => {
  const fake: FakeFetch = async () => jsonResponse({ error: 'forbidden' }, 403);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fake;
  process.env.RESEND_API_KEY = 're_test_abc123';
  try {
    await assert.rejects(
      () => sendInviteEmail({ to: 'a@b.com', tripName: 'V', ownerName: 'A', code: 'ABCD1234EFGH', joinUrl: 'http://x/join' }),
      /Resend HTTP 403/
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
});
