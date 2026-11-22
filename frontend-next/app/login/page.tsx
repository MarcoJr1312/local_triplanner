'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Compass, MapPin, Sparkles, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError, DEMO_FRIEND_ID, DEMO_PASSWORD, DEMO_USER_ID } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import type { UserProfile } from '@/lib/types';

type Mode = 'login' | 'create';

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [managing, setManaging] = useState(false);
  const [accounts, setAccounts] = useState<UserProfile[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/');
    }
  }, [loading, user, router]);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      setAccounts(await api.listUsers());
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setLoadingAccounts(false);
    }
  }, [t]);

  useEffect(() => {
    if (managing) void loadAccounts();
  }, [managing, loadAccounts]);

  if (loading) return null;
  if (user) return null;

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username, password);
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async (demoUsername: string) => {
    setError(null);
    setSubmitting(true);
    setUsername(demoUsername);
    setPassword(DEMO_PASSWORD);
    try {
      await signIn(demoUsername, DEMO_PASSWORD);
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createUser({ username, password, displayName });
      toast.success(t('auth.accountCreated', { username }));
      await signIn(username, password);
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (account: UserProfile) => {
    if (!window.confirm(t('auth.deleteConfirm', { username: account.username }))) return;
    try {
      await api.deleteUser(account.userId);
      toast.success(t('auth.accountDeleted', { username: account.username }));
      await loadAccounts();
    } catch (err) {
      toast.error(localizeApiError(err, t));
    }
  };

  const isProtected = (account: UserProfile) =>
    account.userId === DEMO_USER_ID ||
    account.userId === DEMO_FRIEND_ID ||
    account.username === 'demo' ||
    account.username === 'demo-friend';

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setDisplayName('');
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="login-brand">
          <span className="rail-logo">
            <Compass className="icon" />
          </span>
          <strong>Triplanner</strong>
        </div>

        <div className="login-copy">
          <h1>
            {t('premium.login.headline')} <em>{t('premium.login.headlineAccent')}</em>
          </h1>
          <p>{t('premium.login.lead')}</p>
          <div className="login-features">
            <div className="login-feature">
              <span className="fi">
                <MapPin className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature1.title')}</strong>
                <span>{t('premium.login.feature1.body')}</span>
              </div>
            </div>
            <div className="login-feature">
              <span className="fi">
                <Users className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature2.title')}</strong>
                <span>{t('premium.login.feature2.body')}</span>
              </div>
            </div>
            <div className="login-feature">
              <span className="fi">
                <Sparkles className="icon-sm" />
              </span>
              <div>
                <strong>{t('premium.login.feature3.title')}</strong>
                <span>{t('premium.login.feature3.body')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-brand login-brand-mobile">
            <span className="rail-logo">
              <Compass className="icon" />
            </span>
            <strong>Triplanner</strong>
          </div>
          <span className="mono">{t('premium.login.eyebrow')}</span>
          <h2>{mode === 'login' ? t('auth.signInTitle') : t('auth.createTitle')}</h2>
          <p>{mode === 'login' ? t('auth.signInSubtitle') : t('auth.createSubtitle')}</p>

          <div className="login-form">
            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="grid gap-3">
                <div className="field">
                  <label htmlFor="login-username">{t('auth.username')}</label>
                  <input
                    id="login-username"
                    className="input"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('auth.usernamePlaceholder')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="login-password">{t('auth.password')}</label>
                  <input
                    id="login-password"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={submitting || !username.trim() || !password}
                >
                  {submitting ? t('auth.signingIn') : t('auth.signIn')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreate} className="grid gap-3">
                <div className="field">
                  <label htmlFor="create-username">{t('auth.username')}</label>
                  <input
                    id="create-username"
                    className="input"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('auth.usernamePlaceholder')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="create-display-name">{t('auth.displayName')}</label>
                  <input
                    id="create-display-name"
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('auth.displayNamePlaceholder')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="create-password">{t('auth.password')}</label>
                  <input
                    id="create-password"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.passwordHint')}
                  />
                </div>
                {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={submitting || !username.trim() || !displayName.trim() || !password}
                >
                  {submitting ? t('auth.creating') : t('auth.createAccount')}
                </button>
              </form>
            )}

            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => switchMode(mode === 'login' ? 'create' : 'login')}
              >
                {mode === 'login' ? t('auth.createAccount') : t('auth.backToSignIn')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setManaging((value) => !value)}
              >
                {t('auth.manageAccounts')}
              </button>
            </div>

            <div className="grid gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => handleDemo('demo')}
                disabled={submitting}
              >
                {t('auth.demoOwner')}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                {t('auth.demoPasswordHint')}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => handleDemo('demo-friend')}
                disabled={submitting}
              >
                {t('auth.demoFriend')}
              </button>
            </div>

            {managing && (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <strong className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('auth.accounts')}
                  </strong>
                  <span className="text-[11px] text-muted">{accounts.length}</span>
                </div>
                {loadingAccounts ? (
                  <p className="text-xs text-muted">{t('common.loading')}</p>
                ) : accounts.length === 0 ? (
                  <p className="text-xs text-muted">{t('auth.noAccounts')}</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {accounts.map((account) => (
                      <li
                        key={account.userId}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50"
                      >
                        <span className="flex min-w-0 flex-col">
                          <strong className="truncate text-[12.5px] text-foreground">
                            {account.displayName}
                          </strong>
                          <span className="truncate text-[11px] text-muted">
                            @{account.username}
                          </span>
                        </span>
                        {isProtected(account) ? (
                          <span className="text-[10.5px] text-muted">
                            {t('auth.protectedAccount')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="icon-btn text-[var(--danger)]"
                            aria-label={t('auth.deleteAccount')}
                            onClick={() => handleDelete(account)}
                          >
                            <Trash2 className="icon-sm" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="login-foot">
            <Check className="icon-sm" />
            {t('premium.login.note')}
          </div>
        </div>
      </div>
    </div>
  );
}
