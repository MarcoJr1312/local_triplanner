// Verificacion de ID tokens de Firebase Auth sin firebase-admin.
// - Firma RS256 validada contra las claves publicas de Google (JWKS): cero secretos.
// - createRemoteJWKSet cachea las claves y refresca solo ante un kid desconocido.
// - El verifier es inyectable (JWKS y/o fetch) para poder testear con un par de
//   claves local generado con jose, sin tocar la red ni la clave privada de Google.

import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { FIREBASE_PROJECT_ID } from '../env.ts';

// Endpoint publico de JWKS del proyecto seguro de Firebase (Google).
export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface FirebaseClaims {
  uid: string;
  email: string;
  email_verified: boolean;
  name?: string;
  firebase?: { sign_in_provider: string };
}

export type TokenVerifier = (idToken: string) => Promise<FirebaseClaims>;

// Error propio de verificacion; el resolver (M2) lo mapeara a un error GraphQL.
export class AuthTokenError extends Error {
  readonly code = 'AUTH_TOKEN_INVALID';
  constructor(message = 'Token de autenticacion invalido') {
    super(message);
    this.name = 'AuthTokenError';
  }
}

export interface CreateFirebaseTokenVerifierOptions {
  // URL del JWKS; por defecto el endpoint de Google.
  jwksUrl?: string;
  // Resolver de claves ya construido (tests con createLocalJWKSet). Tiene
  // prioridad sobre jwksUrl/fetchImpl cuando se pasa.
  jwks?: JWTVerifyGetKey;
  // fetch inyectable para createRemoteJWKSet (tests con JWKS mock).
  fetchImpl?: typeof fetch;
}

function toFirebaseClaims(payload: JWTPayload): FirebaseClaims {
  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!uid) throw new AuthTokenError('Token sin sub (uid)');
  const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
  const provider = firebase?.sign_in_provider;
  return {
    uid,
    email: typeof payload.email === 'string' ? payload.email : '',
    email_verified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    firebase: typeof provider === 'string' ? { sign_in_provider: provider } : undefined,
  };
}

export function createFirebaseTokenVerifier(
  projectId: string,
  options: CreateFirebaseTokenVerifierOptions = {},
): TokenVerifier {
  const { jwksUrl = FIREBASE_JWKS_URL, jwks: injectedJwks, fetchImpl } = options;

  const jwks =
    injectedJwks ??
    createRemoteJWKSet(
      new URL(jwksUrl),
      fetchImpl ? { [customFetch]: fetchImpl } : undefined,
    );

  return async (idToken: string): Promise<FirebaseClaims> => {
    let payload: JWTPayload;
    try {
      const { payload: verified } = await jwtVerify(idToken, jwks, {
        issuer: 'https://securetoken.google.com/' + projectId,
        audience: projectId,
      });
      payload = verified;
    } catch (err) {
      throw new AuthTokenError(err instanceof Error ? err.message : undefined);
    }
    return toFirebaseClaims(payload);
  };
}

// Singleton segun el patron de modulos actual (env.ts resuelve FIREBASE_PROJECT_ID).
export const verifyFirebaseIdToken = createFirebaseTokenVerifier(FIREBASE_PROJECT_ID);
