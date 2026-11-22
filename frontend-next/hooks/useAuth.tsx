'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { UserProfile } from '@/lib/types';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<boolean>;
  setProfile: (profile: UserProfile) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLocale } = useI18n();

  // Restore the persisted session once. No Firebase listener is needed.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await api.restoreSession();
      if (!alive) return;
      if (!stored) {
        setLoading(false);
        return;
      }
      setUser(stored);
      setLocale(stored.language ?? 'en');
      try {
        const fresh = await api.getMyProfile();
        if (alive && fresh) {
          await api.setSessionProfile(fresh);
          setUser(fresh);
          setLocale(fresh.language ?? 'en');
        }
      } catch {
        // Keep the stored profile; the login screen remains reachable.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setLocale]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const profile = await api.login(username, password);
      setUser(profile);
      setLocale(profile.language ?? 'en');
    },
    [setLocale],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    const fresh = await api.getMyProfile();
    if (!fresh) return false;
    await api.setSessionProfile(fresh);
    setUser(fresh);
    setLocale(fresh.language ?? 'en');
    return true;
  }, [setLocale]);

  const setProfile = useCallback(
    async (profile: UserProfile) => {
      await api.setSessionProfile(profile);
      setUser(profile);
      setLocale(profile.language ?? 'en');
    },
    [setLocale],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      refreshUser,
      setProfile,
    }),
    [user, loading, signIn, signOut, refreshUser, setProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
