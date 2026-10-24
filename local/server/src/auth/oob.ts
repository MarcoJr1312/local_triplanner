// Email de verificacion via token PROPIO (jose RS256) firmado con la private_key
// del service account — la MISMA que usa firebase-admin, cero secretos nuevos.
// - generateVerificationLink verifica el idToken (jose) y mina un JWT propio
//   (signVerificationToken) que el email lleva como /verify?token=<jwt>.
// - La app lo confirma con authConfirmEmail (resolvers), que marca emailVerified
//   en Firebase via Admin SDK y sincroniza el usuario local.
// - El email lo envia Resend (sendVerificationEmail), no Firebase. Cero cuota OOB.

import { AuthTokenError, verifyFirebaseIdToken } from './verify.ts';
import { signVerificationToken } from './verify-token.ts';
import { getServiceAccountPrivateKey } from './service-account.ts';
import { APP_URL } from '../env.ts';

export interface OobLinkResult {
  email: string;
  oobCode: string;
  link: string;
}

export type OobErrorCode =
  | 'EMAIL_ALREADY_VERIFIED'
  | 'AUTH_TOKEN_INVALID'
  | 'VERIFICATION_SEND_FAILED';

export class OobError extends Error {
  readonly code: OobErrorCode;
  constructor(code: OobErrorCode, message: string) {
    super(message);
    this.name = 'OobError';
    this.code = code;
  }
}

// Verifica el idToken (claims.email/uid), firma un token propio de verificacion y
// devuelve el link directo a la app (/verify?token=<jwt>) listo para Resend.
export async function generateVerificationLink(idToken: string): Promise<OobLinkResult> {
  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken);
  } catch (e) {
    if (e instanceof AuthTokenError) throw new OobError('AUTH_TOKEN_INVALID', e.message);
    throw new OobError('AUTH_TOKEN_INVALID', e instanceof Error ? e.message : 'Token invalido');
  }
  if (!claims.email || !claims.uid) {
    throw new OobError('AUTH_TOKEN_INVALID', 'Token sin email/uid');
  }

  const token = await signVerificationToken(
    { uid: claims.uid, email: claims.email },
    getServiceAccountPrivateKey(),
  );
  return {
    email: claims.email,
    oobCode: token,
    link: `${APP_URL.replace(/\/+$/, '')}/verify?token=${encodeURIComponent(token)}`,
  };
}
