// Acciones de Admin SDK sobre Firebase Auth (unicamente las que NO se pueden hacer
// con jose/JWKS). Hoy solo: marcar el email como verificado tras confirmar el token
// propio (authConfirmEmail). El init es lazy y memoizado (cert del service account).
// La verificacion de ID tokens sigue en verify.ts (jose), sin firebase-admin.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getServiceAccount } from './service-account.ts';

let adminApp: App | undefined;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  adminApp =
    getApps().length > 0
      ? (getApps()[0] as App)
      : initializeApp({ credential: cert(getServiceAccount() as ServiceAccount) });
  return adminApp;
}

export async function setEmailVerified(uid: string): Promise<void> {
  await getAuth(getAdminApp()).updateUser(uid, { emailVerified: true });
}

// firebase-admin reporta los usuarios inexistentes con codigo auth/user-not-found.
export function isUserNotFoundError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.includes('user-not-found');
}
