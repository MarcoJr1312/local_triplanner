'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PasswordInput from '@/components/PasswordInput';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import VerificationGate from '@/components/VerificationGate';
import { demoAuthEnabled, localizeApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';

type AuthTab = 'signin' | 'signup';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-black via-black to-brand-950 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl md:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-black via-black to-brand-950 p-10 text-white md:flex">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl" />

          <div className="relative flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight">Triplanner</span>
          </div>

          <div className="relative space-y-6">
            <h2 className="text-2xl font-bold leading-snug tracking-tight">{t('login.heroTitle')}</h2>
            <ul className="space-y-4 text-sm text-brand-50">
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <MapPin className="h-4 w-4" />
                </span>
                <span className="pt-1.5">{t('login.feature1')}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Users className="h-4 w-4" />
                </span>
                <span className="pt-1.5">{t('login.feature2')}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="pt-1.5">{t('login.feature3')}</span>
              </li>
            </ul>
          </div>

          <p className="relative text-xs text-brand-100">{t('login.demoNote')}</p>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-6 flex items-center gap-2 md:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight text-foreground">Triplanner</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('auth.welcome')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.subtitle')}</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as AuthTab)} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t('auth.tabSignIn')}</TabsTrigger>
              <TabsTrigger value="signup">{t('auth.tabSignUp')}</TabsTrigger>
            </TabsList>
          </Tabs>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            {tab === 'signup' && (
              <div>
                <Label htmlFor="name" className="mb-1 block">
                  {t('auth.name')}
                </Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('auth.namePlaceholder')}
                />
              </div>
            )}

            <div>
              <Label htmlFor="email" className="mb-1 block">
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="password" className="mb-1 block">
                {t('auth.password')}
              </Label>
              <PasswordInput
                id="password"
                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
              />
            </div>

            {tab === 'signin' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs font-medium text-primary hover:text-primary/90"
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? tab === 'signin'
                  ? t('auth.signingIn')
                  : t('auth.signingUp')
                : tab === 'signin'
                  ? t('auth.signIn')
                  : t('auth.signUp')}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase text-muted-foreground">{t('auth.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" onClick={handleGoogle} className="w-full">
            <GoogleIcon />
            {t('auth.continueWithGoogle')}
          </Button>

          {demoAuthEnabled && (
            <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase text-muted-foreground">{t('auth.or')}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleDemo}
                disabled={demoSubmitting}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                {demoSubmitting ? t('auth.signingIn') : t('auth.demoLogin')}
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">{t('auth.demoHint')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
