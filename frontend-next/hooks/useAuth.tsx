'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { ApiError, DEMO_USER_ID, api, demoAuthEnabled, localizeApiError, setAuthHeaderProvider } from '@/lib/api';
import {
  getIdToken,
  onAuthChange,
  reloadFirebaseUser,
  resetPassword as resetPasswordFirebase,
  sendVerification as sendVerificationFirebase,
  signInEmail,
  signInGoogle as signInGoogleFirebase,
  signOutFirebase,
  signUpEmail,
} from '@/lib/auth-firebase';
import { clearPendingJoin, readPendingJoin } from '@/lib/pendingJoin';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import type { UserProfile } from '@/lib/types';

export type AuthStatus = 'ok' | 'needsVerification';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  needsVerification: boolean;
  verificationEmail: string | null;
  signIn: (email: string, password: string) => Promise<AuthStatus>;
  signInGoogle: () => Promise<AuthStatus>;
  signUp: (email: string, password: string, name: string) => Promise<AuthStatus>;
  resendVerification: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<boolean>;
  // Compatibilidad con el modo demo / flujos existentes.
  login: () => Promise<void>;
  logout: () => Promise<void>;
  signInDemo: () => Promise<void>;
  setProfile: (profile: UserProfile) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const { t, setLocale } = useI18n();

  // Usuario de Firebase actual (para resolver x-user-id y token en el provider).
  const firebaseUserRef = useRef<User | null>(null);
  // Dedupe de authLogin concurrente para el mismo uid (listener + accion).
  const syncRef = useRef<Promise<AuthStatus> | null>(null);
  const syncUidRef = useRef<string | null>(null);
  // Primer evento de onAuthStateChanged decide la sesion inicial (demo/firebase).
  const bootstrappedRef = useRef(false);

  // Entra explicitamente como usuario demo (boton en /login): perfil fresco
  // del backend. Lanza si no hay forma de resolver un perfil demo para que el
  // caller muestre el error.
  const signInDemo = useCallback(async () => {
    const stored = await api.restoreSession();
    let fresh: UserProfile | null = null;
    try {
      fresh = await api.getMyProfile();
    } catch (err) {
      if (!stored) throw err;
    }
    const profile = fresh ?? stored;
    if (!profile) throw new Error('demo-unavailable');
    await api.setSessionProfile(profile);
    setUser(profile);
    setLocale(profile.language ?? 'es');
  }, [setLocale]);

  // Aplica una invitacion guardada (join diferido hasta verificar el email).
  const applyPendingJoin = useCallback(async (profile: UserProfile) => {
    const pending = readPendingJoin();
    if (!pending) return;
    try {
      await api.joinTripWithCode(pending.code, profile.email);
    } catch {
      // La invitacion puede no coincidir con el email; el usuario puede reintentar.
    } finally {
      clearPendingJoin();
    }
  }, []);

  // authLogin contra el backend con el token de Firebase. Devuelve el estado y
  // deja el contexto actualizado. Deduplica llamadas concurrentes por uid.
  const applyFirebaseUser = useCallback(
    (fbUser: User, force = false): Promise<AuthStatus> => {
      if (!force && syncUidRef.current === fbUser.uid && syncRef.current) {
        return syncRef.current;
      }
      syncUidRef.current = fbUser.uid;
      const run = (async (): Promise<AuthStatus> => {
        const idToken = await fbUser.getIdToken(force);
        try {
          const result = await api.authLogin(idToken);
          const profile: UserProfile = {
            ...result.user,
            emailVerified: fbUser.emailVerified,
            authProvider: fbUser.providerData[0]?.providerId ?? null,
          };
          await api.setSessionProfile(profile);
          setUser(profile);
          setNeedsVerification(false);
          setVerificationEmail(null);
          setLocale(profile.language ?? 'es');
          await applyPendingJoin(profile);
          return 'ok';
        } catch (err) {
          if (err instanceof ApiError && err.code === 'AUTH_EMAIL_NOT_VERIFIED') {
            setNeedsVerification(true);
            setVerificationEmail(fbUser.email);
            setUser(null);
            return 'needsVerification';
          }
          throw err;
        }
      })();
      syncRef.current = run;
      void run
        .finally(() => {
          if (syncUidRef.current === fbUser.uid) syncRef.current = null;
        })
        .catch(() => {
          // El error se propaga al caller; aqui solo se evita un unhandled rejection.
        });
      return run;
    },
    [applyPendingJoin, setLocale]
  );

  useEffect(() => {
    let alive = true;
    const unsubscribe = onAuthChange((fbUser) => {
      firebaseUserRef.current = fbUser;
      if (!alive) return;

      const isFirstEvent = !bootstrappedRef.current;
      bootstrappedRef.current = true;

      if (fbUser) {
        if (isFirstEvent) setLoading(true);
        applyFirebaseUser(fbUser)
          .catch(() => {
            // Token invalido u otro fallo: la UI permite reintentar el login.
          })
          .finally(() => {
            if (alive && isFirstEvent) setLoading(false);
          });
        return;
      }

      if (isFirstEvent) {
        setLoading(true);
        // Sin sesion Firebase: ir SIEMPRE a /login. La demo solo entra por el
        // boton explicito (signInDemo).
        Promise.resolve()
          .then(() => setUser(null))
          .finally(() => {
            if (alive) setLoading(false);
          });
        return;
      }

      // Cierre de sesion posterior (signOut/otra pestana): limpiar estado.
      setUser(null);
      setNeedsVerification(false);
      setVerificationEmail(null);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [applyFirebaseUser]);

  // Inyecta el provider de cabeceras para el modo Firebase una sola vez.
  useEffect(() => {
    setAuthHeaderProvider({
      getToken: () => getIdToken(false),
      getUserId: () =>
        firebaseUserRef.current
          ? api.getCurrentUser()?.userId ?? null
          : demoAuthEnabled
            ? DEMO_USER_ID
            : null,
    });
    return () => setAuthHeaderProvider(null);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthStatus> => {
      const fbUser = await signInEmail(email, password);
      return applyFirebaseUser(fbUser);
    },
    [applyFirebaseUser]
  );

  const signInGoogle = useCallback(async (): Promise<AuthStatus> => {
    const fbUser = await signInGoogleFirebase();
    return applyFirebaseUser(fbUser);
  }, [applyFirebaseUser]);

  const signUp = useCallback(
    async (email: string, password: string, name: string): Promise<AuthStatus> => {
      const fbUser = await signUpEmail(email, password, name);
      // Fuerza un token fresco: updateProfile acaba de fijar el displayName y el
      // claim `name` debe viajar ya en este token (perfil y email de verificacion).
      const status = await applyFirebaseUser(fbUser, true);
      if (status === 'needsVerification') {
        // Primer envio de verificacion (best-effort); si falla se AVISA con toast
        // y el gate ofrece reenviar. Nunca fallar el registro por esto.
        try {
          await sendVerificationFirebase();
        } catch (err) {
          toast.error(localizeApiError(err, t));
        }
      }
      return status;
    },
    [applyFirebaseUser, t]
  );

  const resendVerification = useCallback(async () => {
    await sendVerificationFirebase();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await resetPasswordFirebase(email);
  }, []);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    const fbUser = await reloadFirebaseUser();
    if (!fbUser) return false;
    const status = await applyFirebaseUser(fbUser, true);
    return status === 'ok';
  }, [applyFirebaseUser]);

  const signOut = useCallback(async () => {
    syncRef.current = null;
    syncUidRef.current = null;
    await signOutFirebase();
    await api.logout();
    firebaseUserRef.current = null;
    setUser(null);
    setNeedsVerification(false);
    setVerificationEmail(null);
  }, []);

  const login = useCallback(async () => {
    const u = await api.loginDemo();
    setUser(u);
  }, []);

  // Adopta un perfil tras unirse a un viaje por invitacion (modo demo).
  const setProfile = useCallback(async (profile: UserProfile) => {
    await api.setSessionProfile(profile);
    setUser(profile);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      needsVerification,
      verificationEmail,
      signIn,
      signInGoogle,
      signUp,
      resendVerification,
      resetPassword,
      signOut,
      refreshUser,
      login,
      logout: signOut,
      signInDemo,
      setProfile,
    }),
    [
      user,
      loading,
      needsVerification,
      verificationEmail,
      signIn,
      signInGoogle,
      signUp,
      resendVerification,
      resetPassword,
      signOut,
      refreshUser,
      login,
      signInDemo,
      setProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
