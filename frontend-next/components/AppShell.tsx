'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, CalendarDays, Compass, LogOut, Map, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { api, localizeApiError, subscribeNotifications } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import type { Notification } from '@/lib/types';
import ThemeToggle from './ThemeToggle';
import Modal from './Modal';

const NOTIFICATION_STATUS_KEY: Record<Notification['status'], TranslationKey> = {
  unread: 'notifications.statusUnread',
  read: 'notifications.statusRead',
  accepted: 'notifications.statusAccepted',
  declined: 'notifications.statusDeclined',
};

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const unread = notifications.filter((notification) => notification.status === 'unread').length;

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setNotificationsLoading(true);
    api
      .myNotifications()
      .then((rows) => {
        if (alive) setNotifications(rows);
      })
      .catch(() => {
        if (alive) setNotifications([]);
      })
      .finally(() => {
        if (alive) setNotificationsLoading(false);
      });

    const stop = subscribeNotifications((notification) => {
      setNotifications((previous) => {
        const exists = previous.some((row) => row.id === notification.id);
        return exists
          ? previous.map((row) => (row.id === notification.id ? notification : row))
          : [notification, ...previous];
      });
    }, controller.signal);

    return () => {
      alive = false;
      controller.abort();
      stop();
    };
  }, [user?.userId]);

  const openNotifications = async () => {
    setShowNotifications(true);
    const pending = notifications.filter(
      (notification) => notification.status === 'unread',
    );
    for (const notification of pending) {
      try {
        const updated = await api.markNotificationRead(notification.id);
        setNotifications((previous) =>
          previous.map((row) => (row.id === updated.id ? updated : row)),
        );
      } catch {
        // The inbox still opens; the next load retries.
      }
    }
  };

  const handleAccept = async (notification: Notification) => {
    try {
      const trip = await api.acceptTripLocalInvite(notification.id);
      setNotifications((previous) =>
        previous.map((row) =>
          row.id === notification.id ? { ...row, status: 'accepted' } : row,
        ),
      );
      setShowNotifications(false);
      router.push(`/trip/${trip.id}`);
    } catch (error) {
      toast.error(localizeApiError(error, t));
    }
  };

  const handleDecline = async (notification: Notification) => {
    try {
      const updated = await api.declineTripLocalInvite(notification.id);
      setNotifications((previous) =>
        previous.map((row) => (row.id === notification.id ? updated : row)),
      );
    } catch (error) {
      toast.error(localizeApiError(error, t));
    }
  };

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
            : pathname === '/settings'
              ? t('settings.pageTitle')
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
          <Link
            href="/settings"
            className={`rail-btn${isActive('/settings') ? ' active' : ''}`}
            aria-label={t('premium.nav.settings')}
          >
            <Settings className="icon" />
          </Link>
        </nav>
        <div className="rail-bottom">
          <button
            type="button"
            className="icon-btn"
            onClick={openNotifications}
            aria-label={t('premium.nav.notifications')}
          >
            <span className="relative inline-flex">
              <Bell className="icon-sm" />
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold leading-none text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
          </button>
          <Link
            href="/settings"
            className="rail-avatar"
            aria-label={t('profile.editAria')}
          >
            {user?.displayName?.trim().charAt(0).toUpperCase() || 'D'}
          </Link>
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
          <Link
            href="/settings"
            className="rail-avatar"
            style={{ width: 34, height: 34 }}
            aria-label={t('profile.editAria')}
          >
            {user?.displayName?.trim().charAt(0).toUpperCase() || 'D'}
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>

      <Modal
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        title={t('notifications.title')}
        size="sm"
      >
        {notificationsLoading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('notifications.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className="rounded-xl border border-border bg-muted/30 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {notification.tripName}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {t('notifications.invitedBy', {
                        name:
                          notification.inviter?.displayName ??
                          notification.inviter?.username ??
                          '—',
                      })}
                    </p>
                    <p className="text-[11px] text-muted">
                      {notification.role === 'editor'
                        ? t('invite.roleEditor')
                        : t('invite.roleViewer')}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                    {t(NOTIFICATION_STATUS_KEY[notification.status])}
                  </span>
                </div>

                {(notification.status === 'unread' || notification.status === 'read') && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAccept(notification)}
                    >
                      {t('notifications.accept')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDecline(notification)}
                    >
                      {t('notifications.decline')}
                    </button>
                  </div>
                )}
                {notification.status === 'accepted' && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setShowNotifications(false);
                        router.push(`/trip/${notification.tripId}`);
                      }}
                    >
                      {t('notifications.openTrip')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
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
