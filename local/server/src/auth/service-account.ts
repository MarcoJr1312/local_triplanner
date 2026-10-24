// Lectura compartida del service account JSON (firebase-service-account.json).
// - La private_key se usa tanto para firmar el token propio de verificacion
//   (verify-token.ts, jose RS256) como por el Admin SDK (admin.ts, cert()).
// - Se memoiza para todo el proceso; el path lo resuelve env.ts (nunca se imprime).

import { readFileSync } from 'node:fs';
import { FIREBASE_SERVICE_ACCOUNT_PATH } from '../env.ts';

export interface FirebaseServiceAccount {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  [key: string]: unknown;
}

let cached: FirebaseServiceAccount | undefined;

export function getServiceAccount(): FirebaseServiceAccount {
  if (cached) return cached;
  try {
    cached = JSON.parse(
      readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'),
    ) as FirebaseServiceAccount;
  } catch (e) {
    throw new Error(
      `No se pudo leer el service account de Firebase (FIREBASE_SERVICE_ACCOUNT_PATH=${FIREBASE_SERVICE_ACCOUNT_PATH}): ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  return cached;
}

export function getServiceAccountPrivateKey(): string {
  const key = getServiceAccount().private_key;
  if (!key) {
    throw new Error('El service account de Firebase no incluye private_key');
  }
  return key;
}
