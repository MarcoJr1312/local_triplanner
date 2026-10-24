// Token PROPIO de verificacion de email (JWT firmado con la private_key del
// service account, jose RS256). Sustituye a los oobCodes de firebase-admin: el
// backend MINTA un token, el email lo lleva como /verify?token=<jwt> y la app lo
// confirma con authConfirmEmail. Cero cuota OOB de Firebase y cero secretos nuevos
// (es la MISMA private_key que ya usa firebase-admin).
//
// - signVerificationToken: firma {uid, email} + iat/exp(24h)/jti + audience fija.
// - verifyVerificationToken: valida firma/audience/exp contra la public key
//   derivada de la misma private_key.
// - jti de un solo uso en memoria (Set): consumeVerificationJti marca/valida; en
//   un unico proceso es suficiente (se reinicia con el server).

import { randomUUID } from 'node:crypto';
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  exportJWK,
  importJWK,
  calculateJwkThumbprint,
} from 'jose';
import type { CryptoKey, JWK } from 'jose';

export const VERIFICATION_AUDIENCE = 'triplanner-verify';
export const VERIFICATION_TTL = '24h';

export type VerificationTokenErrorCode = 'AUTH_TOKEN_INVALID' | 'VERIFICATION_TOKEN_USED';

export class VerificationTokenError extends Error {
  readonly code: VerificationTokenErrorCode;
  constructor(code: VerificationTokenErrorCode, message: string) {
    super(message);
    this.name = 'VerificationTokenError';
    this.code = code;
  }
}

export interface VerificationTokenClaims {
  uid: string;
  email: string;
}

export interface VerifiedVerificationToken extends VerificationTokenClaims {
  jti: string;
}

// Cache de claves por PEM (el service account es constante durante el proceso).
const privateKeyCache = new Map<string, CryptoKey>();
const publicKeyCache = new Map<string, CryptoKey>();
const thumbprintCache = new Map<string, string>();

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  let key = privateKeyCache.get(pem);
  if (!key) {
    key = await importPKCS8(pem, 'RS256', { extractable: true });
    privateKeyCache.set(pem, key);
  }
  return key;
}

function publicJwkFrom(privateJwk: JWK): JWK {
  return { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, alg: privateJwk.alg, use: privateJwk.use };
}

async function publicKeyFor(pem: string): Promise<CryptoKey> {
  let key = publicKeyCache.get(pem);
  if (!key) {
    const jwk = await exportJWK(await importPrivateKey(pem));
    key = (await importJWK(publicJwkFrom(jwk), 'RS256')) as CryptoKey;
    publicKeyCache.set(pem, key);
  }
  return key;
}

async function publicKeyThumbprint(pem: string): Promise<string> {
  let kid = thumbprintCache.get(pem);
  if (!kid) {
    const jwk = await exportJWK(await importPrivateKey(pem));
    kid = await calculateJwkThumbprint(publicJwkFrom(jwk), 'sha256');
    thumbprintCache.set(pem, kid);
  }
  return kid;
}

export async function signVerificationToken(
  claims: VerificationTokenClaims,
  privateKeyPem: string,
): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const kid = await publicKeyThumbprint(privateKeyPem);
  return new SignJWT({ uid: claims.uid, email: claims.email })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime(VERIFICATION_TTL)
    .setJti(randomUUID())
    .setAudience(VERIFICATION_AUDIENCE)
    .sign(key);
}

export async function verifyVerificationToken(
  token: string,
  privateKeyPem: string,
): Promise<VerifiedVerificationToken> {
  const key = await publicKeyFor(privateKeyPem);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      audience: VERIFICATION_AUDIENCE,
      algorithms: ['RS256'],
    }));
  } catch (err) {
    throw new VerificationTokenError(
      'AUTH_TOKEN_INVALID',
      err instanceof Error ? err.message : 'Token de verificación inválido',
    );
  }
  const uid = typeof payload.uid === 'string' ? payload.uid : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const jti = typeof payload.jti === 'string' ? payload.jti : '';
  if (!uid || !email || !jti) {
    throw new VerificationTokenError('AUTH_TOKEN_INVALID', 'Token de verificación sin uid/email/jti');
  }
  return { uid, email, jti };
}

// ---- jti de un solo uso ----

// jti -> uid que lo consumió. El replay del MISMO uid es idempotente (StrictMode
// en dev dispara la confirmación dos veces; la primera ya verificó): devolver
// 'replay' en vez de error. El replay con OTRO uid sigue siendo rechazado.
const usedJtis = new Map<string, string>();

export function resetUsedJtis(): void {
  usedJtis.clear();
}

// Marca un jti como usado por un uid; si ya estaba usado por el MISMO uid,
// devuelve 'replay' (idempotente); si lo usó OTRO uid, lanza VERIFICATION_TOKEN_USED.
export function consumeVerificationJti(jti: string, uid: string): 'fresh' | 'replay' {
  const owner = usedJtis.get(jti);
  if (owner !== undefined) {
    if (owner === uid) return 'replay';
    throw new VerificationTokenError('VERIFICATION_TOKEN_USED', 'El enlace de verificación ya fue usado.');
  }
  usedJtis.set(jti, uid);
  return 'fresh';
}
