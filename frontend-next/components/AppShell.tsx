'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Compass, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { mode } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import ThemeToggle from './ThemeToggle';
import Modal from './Modal';

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = async () => {
    // signOut real (Firebase) + limpieza de estado; en modo demo vuelve al login.
    await signOut();
    router.push('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-sm">
              <Compass className="h-5 w-5" />
            </span>
            <span className="truncate text-lg font-bold tracking-tight text-foreground">Triplanner</span>
          </Link>

          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            {mode === 'mock' && (
              <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20 sm:inline-block">
                 {t('app.demoMode')}
              </span>
            )}
            {user && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowProfile(true)}
                  className="flex items-center gap-2 rounded-full p-0.5 transition duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center"
                  aria-label={t('profile.editAria')}
                >
                  <Avatar user={user} size="md" className="max-sm:h-11 max-sm:w-11" />
                  <span className="hidden text-sm font-medium text-foreground sm:inline">{user.displayName}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  className="rounded-lg p-1.5 text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 max-sm:inline-flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:justify-center"
                  aria-label={t('auth.logoutAria')}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-border bg-card py-4">
        <p className="text-center text-xs text-muted-foreground">
          Triplanner ·{' '}
          {mode === 'local' ? t('app.footerLocal') : t('app.footerDemo')}
        </p>
      </footer>
      <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} />
      <Modal open={showLogoutConfirm} onClose={() => setShowLogoutConfirm(false)} title={t('auth.logoutTitle')} size="sm">
        <p className="text-sm text-muted-foreground">{t('auth.logoutBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition duration-150 hover:bg-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-rose-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            {t('auth.logoutConfirm')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
