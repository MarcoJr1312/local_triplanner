// Tests de authLogin / authSendVerification (M2): verificador Firebase mockeado
// con un par RS256 local + JWKS inyectado, y envios Resend stubbeados (cero red).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT } from 'jose';
import type { CryptoKey, JWK } from 'jose';

import { createFirebaseTokenVerifier } from '../src/auth/verify.ts';
import type { FirebaseClaims } from '../src/auth/verify.ts';
import { upsertUserByEmail } from '../src/auth/users.ts';
import { resolvers, type Ctx, type PubSub } from '../src/resolvers.ts';
import { resetVerificationRateLimit } from '../src/auth/rate-limit.ts';
import { signVerificationToken, resetUsedJtis } from '../src/auth/verify-token.ts';
import { getServiceAccountPrivateKey } from '../src/auth/service-account.ts';
import { FIREBASE_SERVICE_ACCOUNT_PATH } from '../src/env.ts';
import { migrateFirebaseAuth } from '../src/db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

const PROJECT_ID = 'triplanner-a0e06';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KID = 'test-key-1';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

function jwksFetch(keys: JWK[]): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function verifier() {
  return createFirebaseTokenVerifier(PROJECT_ID, {
    jwksUrl: 'https://example.test/jwks',
    fetchImpl: jwksFetch([publicJwk]),
  });
}

interface SignOptions {
  uid?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  provider?: string;
}

async function signToken(opts: SignOptions = {}): Promise<string> {
  const {
    uid = 'firebase-uid-123',
    email = 'maria@example.com',
    emailVerified = true,
    name = 'Maria',
    provider = 'password',
  } = opts;
  return new SignJWT({
    email,
    email_verified: emailVerified,
    name,
    firebase: { sign_in_provider: provider },
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(uid)
    .setIssuer(ISSUER)
    .setAudience(PROJECT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey as CryptoKey);
}

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function ctxFor(db: DatabaseSync, overrides: Partial<Ctx> = {}): Ctx {
  const pubsub: PubSub = {
    publish() {
      /* noop */
    },
    subscribe() {
      return (async function* () {
        /* sin eventos */
      })();
    },
  };
  return { db, currentUserId: 'u1', hasdata: null, pubsub, ...overrides };
}

async function errorCodeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { extensions?: { code?: string } }).extensions?.code;
  }
}

// ---- migracion ----

test('migrateFirebaseAuth: idempotente sobre tabla legacy + indice unico parcial', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, color TEXT, avatar_url TEXT, language TEXT NOT NULL DEFAULT \'es\')'
  );
  db.prepare("INSERT INTO users (id, email, display_name) VALUES ('u9', 'z@z.com', 'Zoe')").run();
  migrateFirebaseAuth(db);
  migrateFirebaseAuth(db); // segunda pasada no debe fallar
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  for (const c of ['firebase_uid', 'email_verified', 'welcome_sent_at']) {
    assert.ok(cols.some((k) => k.name === c), `columna ${c} creada`);
  }
  const row = db.prepare("SELECT email_verified, firebase_uid, welcome_sent_at FROM users WHERE id = 'u9'").get() as {
    email_verified: number;
    firebase_uid: string | null;
    welcome_sent_at: string | null;
  };
  assert.equal(row.email_verified, 0);
  assert.equal(row.firebase_uid, null);
  assert.equal(row.welcome_sent_at, null);
  // Indice unico parcial: dos NULL conviven, dos iguales no.
  db.prepare("INSERT INTO users (id, email, display_name, firebase_uid) VALUES ('a', 'a@a.com', 'A', NULL)").run();
  db.prepare("INSERT INTO users (id, email, display_name, firebase_uid) VALUES ('b', 'b@b.com', 'B', 'dup')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO users (id, email, display_name, firebase_uid) VALUES ('c', 'c@c.com', 'C', 'dup')").run()
  );
});

// ---- upsertUserByEmail ----

test('upsertUserByEmail: crea usuario nuevo (created=true) normalizando email', () => {
  const db = memoryDb();
  const claims: FirebaseClaims = { uid: 'uid-1', email: '  Maria@Example.com ', email_verified: true, name: 'Maria' };
  const { user, created } = upsertUserByEmail(db, claims);
  assert.equal(created, true);
  assert.equal(user.email, 'maria@example.com');
  assert.equal(user.display_name, 'Maria');
  assert.equal(user.firebase_uid, 'uid-1');
  assert.equal(user.email_verified, 1);
  assert.equal(user.language, 'es');
  assert.equal(user.welcome_sent_at, null);
});

test('upsertUserByEmail: sin name usa el prefijo del email', () => {
  const db = memoryDb();
  const { user } = upsertUserByEmail(db, { uid: 'uid-2', email: 'pedro@x.com', email_verified: false });
  assert.equal(user.display_name, 'pedro');
});

test('upsertUserByEmail: vincula usuario existente por email (misma fila, uid se rellena)', () => {
  const db = memoryDb();
  db.prepare("INSERT INTO users (id, email, display_name, color) VALUES ('legacy', 'maria@example.com', 'Vieja', '#000')").run();
  const { user, created } = upsertUserByEmail(db, {
    uid: 'uid-9',
    email: 'MARIA@example.com',
    email_verified: true,
    name: 'Maria',
  });
  assert.equal(created, false);
  assert.equal(user.id, 'legacy');
  assert.equal(user.display_name, 'Vieja', 'no pisa el nombre existente');
  assert.equal(user.firebase_uid, 'uid-9');
  assert.equal(user.email_verified, 1);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  assert.equal(count, 1, 'no crea una segunda fila');
});

test('upsertUserByEmail: no re-vincula un firebase_uid ya asignado', () => {
  const db = memoryDb();
  db.prepare("INSERT INTO users (id, email, display_name, firebase_uid) VALUES ('u', 'a@b.com', 'A', 'uid-original')").run();
  const { user } = upsertUserByEmail(db, { uid: 'uid-nuevo', email: 'a@b.com', email_verified: true });
  assert.equal(user.firebase_uid, 'uid-original');
});

// ---- authLogin ----

test('authLogin: usuario nuevo verificado -> welcomeSent y bienvenida enviada', async () => {
  const db = memoryDb();
  const sent: { to: string; name: string }[] = [];
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    sendWelcome: async (to, name) => {
      sent.push({ to, name });
    },
  });
  const res = (await resolvers.Mutation.authLogin!(null, { idToken: await signToken() }, ctx)) as {
    user: { userId: string; email: string; displayName: string };
    welcomeSent: boolean;
  };
  assert.equal(res.welcomeSent, true);
  assert.equal(res.user.email, 'maria@example.com');
  assert.equal(res.user.displayName, 'Maria');
  assert.deepEqual(sent, [{ to: 'maria@example.com', name: 'Maria' }]);
  const row = db.prepare("SELECT * FROM users WHERE email = 'maria@example.com'").get() as {
    firebase_uid: string;
    email_verified: number;
    welcome_sent_at: string | null;
  };
  assert.equal(row.firebase_uid, 'firebase-uid-123');
  assert.equal(row.email_verified, 1);
  assert.ok(row.welcome_sent_at, 'se marca welcome_sent_at al enviar');
});

test('authLogin: email no verificado + provider password -> AUTH_EMAIL_NOT_VERIFIED', async () => {
  const db = memoryDb();
  const ctx = ctxFor(db, { verifyToken: verifier(), sendWelcome: async () => {} });
  const token = await signToken({ emailVerified: false });
  const code = await errorCodeOf(() => resolvers.Mutation.authLogin!(null, { idToken: token }, ctx));
  assert.equal(code, 'AUTH_EMAIL_NOT_VERIFIED');
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  assert.equal(count, 0, 'no crea usuario si el email no esta verificado');
});

test('authLogin: provider google.com sin verificar -> PASA (no aplica bloqueo)', async () => {
  const db = memoryDb();
  const ctx = ctxFor(db, { verifyToken: verifier(), sendWelcome: async () => {} });
  const token = await signToken({ emailVerified: false, provider: 'google.com' });
  const res = (await resolvers.Mutation.authLogin!(null, { idToken: token }, ctx)) as {
    user: { userId: string };
    welcomeSent: boolean;
  };
  assert.ok(res.user.userId);
  assert.equal(res.welcomeSent, false, 'sin email verificado no se envia bienvenida');
});

test('authLogin: la bienvenida se envia UNA sola vez (segundo login welcomeSent=false)', async () => {
  const db = memoryDb();
  let calls = 0;
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    sendWelcome: async () => {
      calls += 1;
    },
  });
  const first = (await resolvers.Mutation.authLogin!(null, { idToken: await signToken() }, ctx)) as {
    welcomeSent: boolean;
  };
  const second = (await resolvers.Mutation.authLogin!(null, { idToken: await signToken() }, ctx)) as {
    welcomeSent: boolean;
  };
  assert.equal(first.welcomeSent, true);
  assert.equal(second.welcomeSent, false);
  assert.equal(calls, 1, 'Resend solo se llama una vez');
});

test('authLogin: fallo al enviar la bienvenida no rompe el login', async () => {
  const db = memoryDb();
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    sendWelcome: async () => {
      throw new Error('Resend HTTP 500');
    },
  });
  const res = (await resolvers.Mutation.authLogin!(null, { idToken: await signToken() }, ctx)) as {
    welcomeSent: boolean;
  };
  assert.equal(res.welcomeSent, false);
  const row = db.prepare("SELECT welcome_sent_at FROM users WHERE email = 'maria@example.com'").get() as {
    welcome_sent_at: string | null;
  };
  assert.equal(row.welcome_sent_at, null, 'no se marca si el envio falla');
});

test('authLogin: token invalido -> AUTH_TOKEN_INVALID', async () => {
  const db = memoryDb();
  const ctx = ctxFor(db, { verifyToken: verifier() });
  const code = await errorCodeOf(() => resolvers.Mutation.authLogin!(null, { idToken: 'no-es-jwt' }, ctx));
  assert.equal(code, 'AUTH_TOKEN_INVALID');
});

// ---- authSendVerification ----

function oobStub(link = 'http://localhost:3000/verify?oobCode=ABC') {
  return async () => ({ email: 'maria@example.com', oobCode: 'ABC', link });
}

test('authSendVerification: rate limit 60s por uid', async () => {
  resetVerificationRateLimit();
  const db = memoryDb();
  const sent: string[] = [];
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    generateVerification: oobStub(),
    sendVerification: async (to) => {
      sent.push(to);
    },
  });
  const token = await signToken();
  const first = await resolvers.Mutation.authSendVerification!(null, { idToken: token }, ctx);
  assert.equal(first, true);
  const code = await errorCodeOf(() =>
    resolvers.Mutation.authSendVerification!(null, { idToken: token }, ctx)
  );
  assert.equal(code, 'VERIFICATION_RATE_LIMITED');
  assert.equal(sent.length, 1, 'el segundo intento no envia');
});

test('authSendVerification: pasa el nombre del claim al email', async () => {
  resetVerificationRateLimit();
  const db = memoryDb();
  const sent: { to: string; link: string; name?: string }[] = [];
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    generateVerification: oobStub(),
    sendVerification: async (to, link, name) => {
      sent.push({ to, link, name });
    },
  });
  await resolvers.Mutation.authSendVerification!(null, { idToken: await signToken({ name: 'María' }) }, ctx);
  assert.deepEqual(sent, [
    { to: 'maria@example.com', link: 'http://localhost:3000/verify?oobCode=ABC', name: 'María' },
  ]);
});

test('authSendVerification: genera el link final /verify?oobCode= y lo envia con el name', async () => {
  resetVerificationRateLimit();
  const db = memoryDb();
  const sent: { to: string; link: string; name?: string }[] = [];
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    generateVerification: oobStub('http://localhost:3000/verify?oobCode=XYZ789'),
    sendVerification: async (to, link, name) => {
      sent.push({ to, link, name });
    },
  });
  await resolvers.Mutation.authSendVerification!(null, { idToken: await signToken({ name: 'María' }) }, ctx);
  assert.deepEqual(sent, [
    { to: 'maria@example.com', link: 'http://localhost:3000/verify?oobCode=XYZ789', name: 'María' },
  ]);
});

test('authSendVerification: sin name en el claim envia name undefined', async () => {
  resetVerificationRateLimit();
  const db = memoryDb();
  const sent: { name?: string }[] = [];
  const ctx = ctxFor(db, {
    verifyToken: verifier(),
    generateVerification: oobStub(),
    sendVerification: async (_to, _link, name) => {
      sent.push({ name });
    },
  });
  await resolvers.Mutation.authSendVerification!(null, { idToken: await signToken({ name: '' }) }, ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.name, undefined);
});

// ---- authConfirmEmail ----

// Los flujos de confirmacion usan la private key REAL del service account desde
// el resolver. Sin ese archivo (modo local-only) no se pueden ejercitar: skip.
const hasServiceAccount = fs.existsSync(FIREBASE_SERVICE_ACCOUNT_PATH);
const confirmTest = hasServiceAccount ? test : test.skip;

// Firma un token PROPIO de verificacion con la private key real del service
// account (la misma que usa el resolver para verificar). Sin service account
// (modo local-only) se genera una clave efimera para el roundtrip.
let serviceAccountKey: string;
try {
  serviceAccountKey = getServiceAccountPrivateKey();
} catch {
  const { privateKey: ephemeral } = await generateKeyPair('RS256', { extractable: true });
  serviceAccountKey = await exportPKCS8(ephemeral);
  console.warn('[auth.test] service account ausente: usando clave efimera.');
}
async function signVerification(uid = 'firebase-uid-123', email = 'maria@example.com'): Promise<string> {
  return signVerificationToken({ uid, email }, serviceAccountKey);
}

confirmTest('authConfirmEmail: verifica en admin, sincroniza usuario y envia bienvenida una vez', async () => {
  resetUsedJtis();
  const db = memoryDb();
  const sent: { to: string; name: string }[] = [];
  const ctx = ctxFor(db, {
    confirmVerification: async () => {},
    sendWelcome: async (to, name) => {
      sent.push({ to, name });
    },
  });
  const res = (await resolvers.Mutation.authConfirmEmail!(null, { token: await signVerification() }, ctx)) as {
    user: { email: string; displayName: string };
    welcomeSent: boolean;
  };
  assert.equal(res.welcomeSent, true);
  assert.equal(res.user.email, 'maria@example.com');
  assert.deepEqual(sent, [{ to: 'maria@example.com', name: 'maria' }]);
  const row = db.prepare(
    "SELECT firebase_uid, email_verified, welcome_sent_at FROM users WHERE email = 'maria@example.com'"
  ).get() as { firebase_uid: string; email_verified: number; welcome_sent_at: string | null };
  assert.equal(row.firebase_uid, 'firebase-uid-123');
  assert.equal(row.email_verified, 1);
  assert.ok(row.welcome_sent_at, 'se marca welcome_sent_at al enviar');
});

confirmTest('authConfirmEmail: segunda confirmacion (token distinto) no reenvia la bienvenida', async () => {
  resetUsedJtis();
  const db = memoryDb();
  let calls = 0;
  const ctx = ctxFor(db, {
    confirmVerification: async () => {},
    sendWelcome: async () => {
      calls += 1;
    },
  });
  const first = (await resolvers.Mutation.authConfirmEmail!(null, { token: await signVerification() }, ctx)) as {
    welcomeSent: boolean;
  };
  const second = (await resolvers.Mutation.authConfirmEmail!(null, { token: await signVerification() }, ctx)) as {
    welcomeSent: boolean;
  };
  assert.equal(first.welcomeSent, true);
  assert.equal(second.welcomeSent, false);
  assert.equal(calls, 1, 'la bienvenida solo se envia una vez');
});

confirmTest('authConfirmEmail: token invalido -> AUTH_TOKEN_INVALID', async () => {
  resetUsedJtis();
  const db = memoryDb();
  const ctx = ctxFor(db, { confirmVerification: async () => {} });
  const code = await errorCodeOf(() =>
    resolvers.Mutation.authConfirmEmail!(null, { token: 'no-es-jwt' }, ctx)
  );
  assert.equal(code, 'AUTH_TOKEN_INVALID');
});

confirmTest('authConfirmEmail: replay del mismo token (mismo uid) es idempotente', async () => {
  resetUsedJtis();
  const db = memoryDb();
  const ctx = ctxFor(db, { confirmVerification: async () => {}, sendWelcome: async () => {} });
  const token = await signVerification();
  const first = await resolvers.Mutation.authConfirmEmail!(null, { token }, ctx) as { user: { userId: string } };
  const second = await resolvers.Mutation.authConfirmEmail!(null, { token }, ctx) as { user: { userId: string } };
  assert.equal(first.user.userId, second.user.userId);
});

confirmTest('authConfirmEmail: user not found en admin -> AUTH_TOKEN_INVALID', async () => {
  resetUsedJtis();
  const db = memoryDb();
  const ctx = ctxFor(db, {
    confirmVerification: async () => {
      const err = new Error('There is no user record corresponding to the provided identifier.');
      (err as Error & { code?: string }).code = 'auth/user-not-found';
      throw err;
    },
  });
  const code = await errorCodeOf(async () =>
    resolvers.Mutation.authConfirmEmail!(null, { token: await signVerification() }, ctx)
  );
  assert.equal(code, 'AUTH_TOKEN_INVALID');
});

confirmTest('authConfirmEmail: fallo generico de admin -> VERIFICATION_CONFIRM_FAILED', async () => {
  resetUsedJtis();
  const db = memoryDb();
  const ctx = ctxFor(db, {
    confirmVerification: async () => {
      throw new Error('red/500');
    },
  });
  const code = await errorCodeOf(async () =>
    resolvers.Mutation.authConfirmEmail!(null, { token: await signVerification() }, ctx)
  );
  assert.equal(code, 'VERIFICATION_CONFIRM_FAILED');
});
