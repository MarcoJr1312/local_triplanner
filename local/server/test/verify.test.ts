// Tests del verificador de ID tokens de Firebase con un par de claves RS256
// generado localmente con jose y un JWKS mock (cero red, cero clave de Google).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { CryptoKey, JWK } from 'jose';
import {
  createFirebaseTokenVerifier,
  verifyFirebaseIdToken,
  AuthTokenError,
  FIREBASE_JWKS_URL,
} from '../src/auth/verify.ts';

const PROJECT_ID = 'triplanner-a0e06';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const KID = 'test-key-1';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

// JWKS mock: createRemoteJWKSet lo consume via customFetch inyectado.
function jwksFetch(keys: JWK[]): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

interface SignOptions {
  key?: CryptoKey;
  kid?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: number | string;
}

async function signToken(opts: SignOptions = {}): Promise<string> {
  const {
    key = privateKey,
    kid = KID,
    issuer = ISSUER,
    audience = PROJECT_ID,
    expiresAt = '1h',
  } = opts;
  return new SignJWT({
    email: 'maria@example.com',
    email_verified: true,
    name: 'Maria',
    firebase: { sign_in_provider: 'password' },
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject('firebase-uid-123')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

function verifier() {
  return createFirebaseTokenVerifier(PROJECT_ID, {
    jwksUrl: 'https://example.test/jwks',
    fetchImpl: jwksFetch([publicJwk]),
  });
}

test('token valido -> claims mapeadas (uid/email/provider)', async () => {
  const claims = await verifier()(await signToken());
  assert.deepEqual(claims, {
    uid: 'firebase-uid-123',
    email: 'maria@example.com',
    email_verified: true,
    name: 'Maria',
    firebase: { sign_in_provider: 'password' },
  });
});

test('token con issuer incorrecto -> AuthTokenError', async () => {
  const token = await signToken({ issuer: 'https://evil.example.com' });
  await assert.rejects(() => verifier()(token), (err) => {
    assert.ok(err instanceof AuthTokenError);
    assert.equal(err.code, 'AUTH_TOKEN_INVALID');
    return true;
  });
});

test('token expirado -> AuthTokenError', async () => {
  const token = await signToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(() => verifier()(token), AuthTokenError);
});

test('token con firma invalida -> AuthTokenError', async () => {
  const other = await generateKeyPair('RS256');
  const token = await signToken({ key: other.privateKey });
  await assert.rejects(() => verifier()(token), AuthTokenError);
});

test('token con audience incorrecta -> AuthTokenError', async () => {
  const token = await signToken({ audience: 'otro-proyecto' });
  await assert.rejects(() => verifier()(token), AuthTokenError);
});

test('singleton verifyFirebaseIdToken usa el JWKS de Google por defecto', () => {
  assert.equal(typeof verifyFirebaseIdToken, 'function');
  assert.ok(FIREBASE_JWKS_URL.includes('securetoken@system.gserviceaccount.com'));
});

test('token basura -> AuthTokenError', async () => {
  await assert.rejects(() => verifier()('no-es-un-jwt'), AuthTokenError);
});
