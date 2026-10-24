// Tests del token propio de verificacion (jose RS256): firma, verificacion,
// caducidad, firma rota y jti de un solo uso. Usa la private key REAL del service
// account (misma que el server) para validar el roundtrip de produccion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, importPKCS8 } from 'jose';
import type { CryptoKey } from 'jose';
import {
  signVerificationToken,
  verifyVerificationToken,
  consumeVerificationJti,
  resetUsedJtis,
  VERIFICATION_AUDIENCE,
  VerificationTokenError,
} from '../src/auth/verify-token.ts';
import { getServiceAccountPrivateKey } from '../src/auth/service-account.ts';

const privateKeyPem = getServiceAccountPrivateKey();

test('sign/verify roundtrip con la private key del service account', async () => {
  resetUsedJtis();
  const token = await signVerificationToken({ uid: 'uid-1', email: 'maria@example.com' }, privateKeyPem);
  const payload = await verifyVerificationToken(token, privateKeyPem);
  assert.equal(payload.uid, 'uid-1');
  assert.equal(payload.email, 'maria@example.com');
  assert.ok(payload.jti, 'el token lleva jti');
});

test('verify rechaza token caducado', async () => {
  resetUsedJtis();
  const key = await importPKCS8(privateKeyPem, 'RS256');
  const expired = await new SignJWT({ uid: 'u', email: 'e@e.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime(0) // exp = epoch → caducado
    .setJti('jti-expired')
    .setAudience(VERIFICATION_AUDIENCE)
    .sign(key);
  await assert.rejects(
    () => verifyVerificationToken(expired, privateKeyPem),
    (e: unknown) => e instanceof VerificationTokenError && e.code === 'AUTH_TOKEN_INVALID',
  );
});

test('verify rechaza firma rota (firmada con otra clave)', async () => {
  resetUsedJtis();
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ uid: 'u', email: 'e@e.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setJti('jti-forged')
    .setAudience(VERIFICATION_AUDIENCE)
    .sign(otherKey as CryptoKey);
  await assert.rejects(
    () => verifyVerificationToken(forged, privateKeyPem),
    (e: unknown) => e instanceof VerificationTokenError && e.code === 'AUTH_TOKEN_INVALID',
  );
});

test('verify rechaza audiencia incorrecta', async () => {
  resetUsedJtis();
  const key = await importPKCS8(privateKeyPem, 'RS256');
  const wrongAud = await new SignJWT({ uid: 'u', email: 'e@e.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setJti('jti-wrongaud')
    .setAudience('otra-audiencia')
    .sign(key);
  await assert.rejects(
    () => verifyVerificationToken(wrongAud, privateKeyPem),
    (e: unknown) => e instanceof VerificationTokenError && e.code === 'AUTH_TOKEN_INVALID',
  );
});

test('jti reutilizado -> VERIFICATION_TOKEN_USED (mismo uid replay, otro uid error)', async () => {
  resetUsedJtis();
  const token = await signVerificationToken({ uid: 'uid-1', email: 'maria@example.com' }, privateKeyPem);
  const payload = await verifyVerificationToken(token, privateKeyPem);
  assert.equal(consumeVerificationJti(payload.jti, 'uid-1'), 'fresh'); // primer uso
  assert.equal(consumeVerificationJti(payload.jti, 'uid-1'), 'replay'); // mismo uid idempotente
  assert.throws(
    () => consumeVerificationJti(payload.jti, 'uid-otro'),
    (e: unknown) => e instanceof VerificationTokenError && e.code === 'VERIFICATION_TOKEN_USED',
  );
});
