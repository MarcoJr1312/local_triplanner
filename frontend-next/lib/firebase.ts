// Inicializacion del SDK de Firebase (solo Auth) desde variables publicas de
// Next.js. La config del proyecto vive en .env.local (nunca hardcodeada); si
// falta alguna clave se lanza un error explicito al cargar el modulo.

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
if (missing.length > 0) {
  throw new Error(
    `[firebase] Falta configuración pública: ${missing.join(', ')}. ` +
      'Defínelas en frontend-next/.env.local.'
  );
}

// Guard de getApps() para no re-inicializar en recargas de HMR de Next.
export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(firebaseApp);
