// Inicializacion del SDK de Firebase (solo Auth) desde variables publicas de
// Next.js. La config del proyecto vive en .env.local (nunca hardcodeada).
//
// Si falta configuracion, Firebase queda DESHABILITADO y la app sigue en modo
// demo (login local via x-user-id). Esto permite correr el stack sin claves;
// en cuanto se definen las 4 variables publicas, Firebase se activa solo.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED_KEYS: Array<[keyof typeof firebaseConfig, string]> = [
  ['apiKey', 'NEXT_PUBLIC_FIREBASE_API_KEY'],
  ['authDomain', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
  ['appId', 'NEXT_PUBLIC_FIREBASE_APP_ID'],
];

const missing = REQUIRED_KEYS.filter(([key]) => !firebaseConfig[key]).map(([, env]) => env);

export const firebaseEnabled = missing.length === 0;

if (!firebaseEnabled) {
  console.warn(
    `[firebase] deshabilitado: faltan ${missing.join(', ')}. ` +
      'Se usara el modo demo; define las variables en frontend-next/.env.local para activarlo.',
  );
}

// Guard de getApps() para no re-inicializar en recargas de HMR de Next.
export const firebaseApp: FirebaseApp | null = firebaseEnabled
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
