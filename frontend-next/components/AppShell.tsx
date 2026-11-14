'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, CalendarDays, Compass, LogOut, Map, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import ProfileModal from './ProfileModal';
import ThemeToggle from './ThemeToggle';
import Modal from './Modal';

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };

  const title =
    pathname === '/'
      ? t('nav.myTrips')
      : pathname.startsWith('/trip/')
        ? 'Viaje'
        : pathname === '/calendar'
          ? t('premium.nav.calendar')
          : pathname === '/search'
            ? t('premium.nav.search')
            : 'Triplanner';

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="app">
      <aside className="rail">
        <Link href="/" className="rail-logo" aria-label="Triplanner">
          <Compass className="icon" />
        </Link>
        <nav className="rail-nav" aria-label="Navegación principal">
          <Link
            href="/"
            className={`rail-btn${isActive('/') ? ' active' : ''}`}
            aria-label={t('nav.myTrips')}
          >
            <Map className="icon" />
          </Link>
          <Link
            href="/calendar"
            className={`rail-btn${isActive('/calendar') ? ' active' : ''}`}
            aria-label={t('premium.nav.calendar')}
          >
            <CalendarDays className="icon" />
          </Link>
          <Link
            href="/search"
            className={`rail-btn${isActive('/search') ? ' active' : ''}`}
            aria-label={t('premium.nav.search')}
          >
            <Search className="icon" />
          </Link>
          <button
            type="button"
            className="rail-btn"
            onClick={() => setShowProfile(true)}
            aria-label={t('premium.nav.settings')}
          >
            <Settings className="icon" />
          </button>
        </nav>
        <div className="rail-bottom">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowNotifications(true)}
            aria-label={t('premium.nav.notifications')}
          >
            <Bell className="icon-sm" />
          </button>
          <button
            type="button"
            className="rail-avatar"
            onClick={() => setShowProfile(true)}
            aria-label={t('profile.editAria')}
          >
            {user?.displayName?.trim().charAt(0).toUpperCase() || 'D'}
          </button>
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="crumb">
            Triplanner <span>/</span> <strong>{title}</strong>
          </div>
          <div className="topbar-spacer" />
          <Link href="/search" className="cmdk">
            <Search className="icon-sm" />
            <span>{t('premium.topbar.searchPlaceholder')}</span>
            <kbd>⌘K</kbd>
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowLogoutConfirm(true)}
            aria-label={t('auth.logoutAria')}
          >
            <LogOut className="icon-sm" />
          </button>
          <button
            type="button"
            className="rail-avatar"
            style={{ width: 34, height: 34 }}
            onClick={() => setShowProfile(true)}
            aria-label={t('profile.editAria')}
          >
            {user?.displayName?.trim().charAt(0).toUpperCase() || 'D'}
          </button>
        </header>
        <main className="content">{children}</main>
      </div>

      <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} />
      <Modal
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        title={t('notifications.title')}
        size="sm"
      >
        <p className="text-sm text-muted-foreground">{t('notifications.empty')}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowNotifications(false)}
          >
            {t('common.close')}
          </button>
        </div>
      </Modal>
      <Modal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        title={t('auth.logoutTitle')}
        size="sm"
      >
        <p className="text-sm text-muted-foreground">{t('auth.logoutBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowLogoutConfirm(false)}
          >
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleLogout}>
            {t('auth.logoutConfirm')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
