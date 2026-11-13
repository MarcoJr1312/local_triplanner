// Wrappers tipados sobre el SDK de Firebase Auth. Cada llamada que puede
// fallar lanza un ApiError con un `code` estable (FIREBASE_* / AUTH_*) para que
// `localizeApiError(err, t)` lo traduzca igual que los errores del backend.

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import { ApiError, api } from './api';
import { auth } from './firebase';

// Firebase es opcional en local: sin configuracion publica, la app usa el modo
// demo y estas funciones fallan con un codigo estable en vez de romper el bundle.
function requireAuth(): Auth {
  if (!auth) {
    throw new ApiError('Firebase Auth no configurado; usa el modo demo.', {
      code: 'FIREBASE_NOT_CONFIGURED',
    });
  }
  return auth;
}

// Mapa de codigos de firebase/auth → codigos estables de Triplanner.
const FIREBASE_CODE_MAP: Record<string, string> = {
  'auth/email-already-in-use': 'FIREBASE_EMAIL_EXISTS',
  'auth/weak-password': 'FIREBASE_WEAK_PASSWORD',
  'auth/invalid-credential': 'FIREBASE_INVALID_CREDENTIAL',
  'auth/invalid-login-credentials': 'FIREBASE_INVALID_CREDENTIAL',
  'auth/wrong-password': 'FIREBASE_INVALID_CREDENTIAL',
  'auth/user-not-found': 'FIREBASE_INVALID_CREDENTIAL',
  'auth/user-disabled': 'AUTH_USER_DISABLED',
  'auth/invalid-email': 'FIREBASE_INVALID_EMAIL',
  'auth/missing-password': 'FIREBASE_MISSING_PASSWORD',
  'auth/too-many-requests': 'FIREBASE_TOO_MANY_REQUESTS',
  'auth/popup-closed-by-user': 'FIREBASE_POPUP_CLOSED',
  'auth/cancelled-popup-request': 'FIREBASE_POPUP_CLOSED',
  'auth/popup-blocked': 'FIREBASE_POPUP_BLOCKED',
  'auth/network-request-failed': 'FIREBASE_NETWORK',
  'auth/operation-not-allowed': 'FIREBASE_OPERATION_NOT_ALLOWED',
  'auth/expired-action-code': 'AUTH_EXPIRED_ACTION_CODE',
  'auth/invalid-action-code': 'AUTH_INVALID_ACTION_CODE',
};

function firebaseErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

// Traduce un error de firebase/auth a un ApiError con `code` estable.
export function mapFirebaseError(err: unknown): ApiError {
  const code = firebaseErrorCode(err);
  const message = err instanceof Error ? err.message : 'Error de Firebase Auth.';
  return new ApiError(message, { code: (code && FIREBASE_CODE_MAP[code]) || 'FIREBASE_UNKNOWN' });
}

export async function signInEmail(email: string, password: string): Promise<User> {
  try {
    const credential = await signInWithCredential(requireAuth(), EmailAuthProvider.credential(email, password));
    return credential.user;
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function signInGoogle(): Promise<User> {
  try {
    const credential = await signInWithPopup(requireAuth(), new GoogleAuthProvider());
    return credential.user;
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function signUpEmail(email: string, password: string, name?: string): Promise<User> {
  // Nota: createUserWithEmailAndPassword NO envia email de verificacion; eso lo
  // dispara el backend con authSendVerification (via sendVerification()).
  try {
    const credential = await createUserWithEmailAndPassword(requireAuth(), email, password);
    // El nombre viaja en el claim `name` del token; sin esto el perfil y los
    // emails usan el prefijo del email. updateProfile actualiza el user local.
    const displayName = name?.trim();
    if (displayName) {
      await updateProfile(credential.user, { displayName });
      // El claim `name` solo viaja en tokens mintados DESPUÉS del updateProfile;
      // forzar refresh para que el primer request al backend ya lleve el nombre
      // (si no, el backend crea la fila con el prefijo del email).
      await credential.user.getIdToken(true);
    }
    return credential.user;
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

// Hay sesion de Firebase activa (independiente del gate de email verificado).
export function hasActiveFirebaseSession(): boolean {
  return auth?.currentUser != null;
}

export async function sendVerification(): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user) {
    throw new ApiError('No hay una sesión de Firebase activa.', { code: 'AUTH_TOKEN_INVALID' });
  }
  const idToken = await user.getIdToken();
  return api.authSendVerification(idToken);
}

export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(requireAuth(), email);
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function signOutFirebase(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void): Unsubscribe {
  if (!auth) {
    // Sin Firebase configurado no hay listener: el primer evento es "sin sesion".
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

// Recarga el usuario actual (por ejemplo tras pulsar el link de verificacion)
// y lo devuelve ya actualizado. `null` si no hay sesion.
export async function reloadFirebaseUser(): Promise<User | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  await user.reload();
  return auth?.currentUser ?? null;
}

// Token fresco (forceRefresh=true obliga a refrescar; el token dura 1h).
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
