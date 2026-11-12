'use client';

// Pagina de verificacion de email. El link del email (generado por el backend)
// apunta directo aqui: /verify?token=<jwt>. Confirmamos el token llamando a
// authConfirmEmail (el backend lo verifica y marca emailVerified en Firebase),
// refrescamos el usuario y entramos al dashboard. Si el token caduco/no es valido,
// mostramos el error con accesos a login / reenviar email.

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiError, api, localizeApiError } from '@/lib/api';
import { hasActiveFirebaseSession } from '@/lib/auth-firebase';
import { useAuth } from '@/hooks/useAuth';
import { useI18n, type Translate } from '@/lib/i18n';

type VerifyState =
  | { status: 'applying' }
  | { status: 'success' }
  | { status: 'error'; message: string };

function errorMessageFor(err: unknown, t: Translate): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === 'VERIFICATION_TOKEN_USED') return t('auth.verify.expired');
  if (code === 'AUTH_TOKEN_INVALID') return t('auth.verify.invalid');
  return t('auth.verify.failed');
}

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { refreshUser, resendVerification } = useAuth();
  const [state, setState] = useState<VerifyState>({ status: 'applying' });
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  const didRunRef = useRef(false);

  useEffect(() => {
    // One-shot real: el ref NO se resetea en cleanup (StrictMode en dev
    // desmonta y remonta el efecto; el componente y los refs persisten).
    if (didRunRef.current) return;
    didRunRef.current = true;

    const oobCode = searchParams.get('oobCode');
    const token = searchParams.get('token') ?? oobCode;
    if (!token) {
      router.replace('/login');
      return;
    }

    // Sin gating de "alive": el backend es idempotente para el mismo token/uid
    // (replay tolerante), y el componente sigue montado tras el ciclo doble.
    (async () => {
      try {
        await api.authConfirmEmail(token);
      } catch (err) {
        setCanResend(hasActiveFirebaseSession());
        setState({ status: 'error', message: errorMessageFor(err, t) });
        return;
      }
      toast.success(t('auth.verify.success'));
      setState({ status: 'success' });
      try {
        await refreshUser();
      } catch {
        // el destino (dashboard/login) resuelve la sesion
      }
      router.replace('/');
    })();
  }, [router, searchParams, t, refreshUser]);

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast.success(t('auth.verify.resent'));
    } catch (err) {
      toast.error(localizeApiError(err, t));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-[20px] border border-border bg-card p-6 shadow-card-hover sm:p-8">
        <div className="flex flex-col items-center text-center">
          {state.status === 'applying' && (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <RefreshCw className="h-7 w-7 animate-spin" />
              </span>
              <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                {t('auth.verify.applying')}
              </h1>
            </>
          )}

          {state.status === 'success' && (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                {t('auth.verify.success')}
              </h1>
            </>
          )}

          {state.status === 'error' && (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
                {t('auth.verify.title')}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
            </>
          )}
        </div>

        {state.status === 'error' && (
          <div className="mt-6 space-y-3">
            <Button type="button" onClick={() => router.replace('/login')} className="w-full">
              {t('auth.verify.goLogin')}
            </Button>
            {canResend && (
              <Button
                type="button"
                variant="outline"
                onClick={handleResend}
                disabled={resending}
                className="w-full"
              >
                <Send className="h-4 w-4" />
                {resending ? t('auth.verify.resending') : t('auth.verify.resend')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VerifyFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<VerifyFallback />}>
      <VerifyContent />
    </Suspense>
  );
}

