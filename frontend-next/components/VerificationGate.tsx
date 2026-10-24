'use client';

// Pantalla de espera de verificacion de email. Se muestra en lugar del
// contenido cuando el backend rechaza el login con AUTH_EMAIL_NOT_VERIFIED.

import { useEffect, useState } from 'react';
import { LogOut, MailCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';

const RESEND_COOLDOWN_S = 60;

export default function VerificationGate() {
  const { t } = useI18n();
  const { verificationEmail, resendVerification, refreshUser, signOut } = useAuth();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast.success(t('auth.verify.resent'));
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setResending(false);
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      const ok = await refreshUser();
      if (!ok) toast.info(t('auth.verify.notYet'));
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-black via-black to-brand-950 p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MailCheck className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
            {t('auth.verify.title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('auth.verify.subtitle', { email: verificationEmail ?? '' })}
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <Button type="button" onClick={handleCheck} disabled={checking} className="w-full">
            <RefreshCw className={checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {checking ? t('auth.verify.checking') : t('auth.verify.check')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="w-full"
          >
            {cooldown > 0
              ? t('auth.verify.resendIn', { s: cooldown })
              : resending
                ? t('auth.verify.resending')
                : t('auth.verify.resend')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => signOut()}
            className="w-full text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t('auth.verify.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}
