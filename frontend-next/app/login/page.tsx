'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import VerificationGate from '@/components/VerificationGate';
import { demoAuthEnabled, localizeApiError } from '@/lib/api';
import { firebaseEnabled } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';

type AuthTab = 'signin' | 'signup';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 17, height: 17 }}>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

export default function LoginPage() {
  const { user, loading, needsVerification, signIn, signUp, signInGoogle, resetPassword, signInDemo } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoSubmitting, setDemoSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/');
    }
  }, [loading, user, router]);

  if (loading) return null;
  if (needsVerification) return <VerificationGate />;
  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (tab === 'signup' && trimmedName.length < 2) {
      toast.error(t('auth.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (tab === 'signin') await signIn(email.trim(), password);
      else await signUp(email.trim(), password, trimmedName);
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    try {
      await signInGoogle();
    } catch (err) {
      toast.error(localizeApiError(err, t));
    }
  };

  const handleDemo = async () => {
    setDemoSubmitting(true);
    try {
      await signInDemo();
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setDemoSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t('errors.invalidEmail'));
      return;
    }
    try {
      await resetPassword(email.trim());
      toast.success(t('auth.resetSent'));
    } catch (err) {
      toast.error(localizeApiError(err, t));
    }
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
          <h2>{t('premium.login.title')}</h2>
          <p>{t('premium.login.subtitle')}</p>

          {firebaseEnabled && (
            <>
              <div className="tabs" style={{ marginBottom: 18 }}>
                <button
                  type="button"
                  className={`tab${tab === 'signin' ? ' active' : ''}`}
                  onClick={() => setTab('signin')}
                >
                  {t('auth.tabSignIn')}
                </button>
                <button
                  type="button"
                  className={`tab${tab === 'signup' ? ' active' : ''}`}
                  onClick={() => setTab('signup')}
                >
                  {t('auth.tabSignUp')}
                </button>
              </div>

              <form className="login-form" onSubmit={handleSubmit}>
                {tab === 'signup' && (
                  <div className="field">
                    <label htmlFor="name">{t('auth.name')}</label>
                    <input
                      id="name"
                      className="input"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('auth.namePlaceholder')}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="email">{t('premium.login.email')}</label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">{t('premium.login.password')}</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                  />
                </div>
                {tab === 'signin' && (
                  <div style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={handleReset}
                      style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}
                    >
                      {t('auth.forgotPassword')}
                    </button>
                  </div>
                )}
                <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
                  {submitting
                    ? tab === 'signin'
                      ? t('auth.signingIn')
                      : t('auth.signingUp')
                    : tab === 'signin'
                      ? t('premium.login.submit')
                      : t('auth.signUp')}
                </button>
              </form>

              <div className="divider" />
              <button type="button" className="btn btn-ghost btn-block" onClick={handleGoogle}>
                <GoogleIcon />
                {t('auth.continueWithGoogle')}
              </button>
            </>
          )}

          {demoAuthEnabled && (
            <>
              {firebaseEnabled && <div className="divider" />}
              <button
                type="button"
                className={`btn btn-block ${firebaseEnabled ? 'btn-ghost' : 'btn-primary'}`}
                onClick={handleDemo}
                disabled={demoSubmitting}
              >
                {demoSubmitting ? t('auth.signingIn') : t('premium.login.demo')}
              </button>
              <div className="login-foot">
                <Check className="icon-sm" />
                {t('premium.login.note')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
