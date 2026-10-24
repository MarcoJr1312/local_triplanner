'use client';

// Pantalla publica de union a un viaje por invitacion (email + codigo).
// El link del email llega a /join?trip=<id>&code=<code> con el codigo pre-llenado.
// Flujo con cuenta Firebase, segun el estado de sesion:
//   - Sesion ya iniciada con el email invitado -> auto-join (spinner, sin formulario).
//   - Sesion con otra cuenta -> panel de "cuenta incorrecta" + cambiar de cuenta.
//   - Sin sesion -> formulario SOLO de crear cuenta con el email pre-llenado.
// Si el email no esta verificado se difiere la invitacion (pendingJoin) hasta que
// la cuenta quede verificada; al volver con la sesion verificada el auto-join
// dispara solo. El flujo demo (sin cuenta) se conserva.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Compass, LogIn, AlertCircle, CheckCircle2, MapPin, Loader2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import PasswordInput from '@/components/PasswordInput';
import { Label } from '@/components/ui/label';
import VerificationGate from '@/components/VerificationGate';
import { api, demoAuthEnabled, localizeApiError, ApiError } from '@/lib/api';
import { setPendingJoin } from '@/lib/pendingJoin';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import type { TripPreview } from '@/lib/types';

function emailToName(email: string, fallback: string): string {
  const prefix = email.split('@')[0] ?? '';
  const cleaned = prefix.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const normalizeEmail = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

export default function JoinPage() {
  const router = useRouter();
  const { user, loading, needsVerification, signUp, signInGoogle, signOut, setProfile } = useAuth();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const codeParam = searchParams.get('code') ?? '';
  const tripParam = searchParams.get('trip') ?? '';

  const [code, setCode] = useState(codeParam);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [joining, setJoining] = useState(false);
  const [autoJoining, setAutoJoining] = useState(false);
  const [autoJoinFailed, setAutoJoinFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // Guard anti-loop del auto-join: recuerda por que codigo ya se disparo.
  const autoJoinGuardRef = useRef<string | null>(null);

  const firebaseAuthed = Boolean(user && user.emailVerified !== undefined);
  const authedEmail = user?.email ?? '';
  const invitedEmail = normalizeEmail(preview?.invitedEmail);
  const emailsMatch = invitedEmail !== '' && normalizeEmail(authedEmail) === invitedEmail;
  // Sin invitedEmail (preview incompleto) no se restringe la cuenta.
  const isWrongAccount = firebaseAuthed && preview != null && invitedEmail !== '' && !emailsMatch;
  const canAutoJoin = firebaseAuthed && preview != null && !isWrongAccount;
  const prefilled = Boolean(preview?.invitedEmail);

  // Carga el preview cuando el codigo cambia (validado: 12 chars).
  useEffect(() => {
    let alive = true;
    if (!/^[A-Za-z0-9_-]{12}$/.test(code)) {
      setPreview(null);
      setLoadingPreview(false);
      return;
    }
    setLoadingPreview(true);
    api
      .getTripByCode(code)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setPreview(null);
      })
      .finally(() => {
        if (alive) setLoadingPreview(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  // Prellena el email del formulario con el de la invitacion.
  useEffect(() => {
    if (preview?.invitedEmail) setEmail(preview.invitedEmail);
  }, [preview]);

  const afterJoin = (tripId: string) => {
    setJoined(true);
    setTimeout(() => router.push(`/trip/${tripId}`), 900);
  };

  // AUTO-JOIN: sesion iniciada cuyo email coincide con el invitado. Se ejecuta
  // UNA sola vez por codigo (guard) para no entrar en bucle; si falla, no
  // reintenta solo (el usuario puede cambiar de cuenta o ir a sus viajes).
  useEffect(() => {
    if (!canAutoJoin || joined) return;
    if (autoJoinGuardRef.current === code) return;
    autoJoinGuardRef.current = code;
    setAutoJoining(true);
    setAutoJoinFailed(false);
    api
      .joinTripWithCode(code, authedEmail)
      .then((trip) => {
        setJoined(true);
        setTimeout(() => router.push(`/trip/${trip.id}`), 900);
      })
      .catch((err) => {
        // Si otra vía (signup/pendingJoin) ya completó la unión, el segundo
        // intento recibe INVITE_ALREADY_USED: es éxito, navegar directo.
        const codeErr = err instanceof ApiError ? err.code : undefined;
        if (codeErr === 'INVITE_ALREADY_USED' && preview) {
          setJoined(true);
          setTimeout(() => router.push(`/trip/${preview.id}`), 900);
          return;
        }
        setError(localizeApiError(err, t));
        setAutoJoinFailed(true);
        setAutoJoining(false);
      });
  }, [canAutoJoin, code, joined, authedEmail, t, router]);

  const validate = (): string | null => {
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return t('errors.invalidEmail');
    if (!/^[A-Za-z0-9_-]{12}$/.test(code)) return t('errors.invalidCode');
    return null;
  };

  // Sin sesion: crear cuenta y unirse (email pre-llenado de la invitacion).
  const handleSignUpJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError(t('auth.nameRequired'));
      return;
    }
    setJoining(true);
    try {
      const status = await signUp(email.trim(), password, trimmedName);
      if (status === 'needsVerification') {
        setPendingJoin(code, tripParam || undefined);
        return;
      }
      // Marca el guard: evita que el auto-join duplique esta union explicita.
      autoJoinGuardRef.current = code;
      const profile = api.getCurrentUser();
      const emailToUse = profile?.email ?? email.trim();
      const trip = await api.joinTripWithCode(code, emailToUse);
      afterJoin(trip.id);
    } catch (err) {
      // El auto-join pudo completar la unión primero: es éxito.
      const codeErr = err instanceof ApiError ? err.code : undefined;
      if (codeErr === 'INVITE_ALREADY_USED' && preview) {
        afterJoin(preview.id);
        return;
      }
      setError(localizeApiError(err, t));
      setJoining(false);
    }
  };

  // Google: solo autentica. Si el email coincide, el auto-join une; si no,
  // se muestra el panel de cuenta incorrecta (no se une).
  const handleGoogleJoin = async () => {
    setError(null);
    if (!/^[A-Za-z0-9_-]{12}$/.test(code)) {
      setError(t('errors.invalidCode'));
      return;
    }
    setJoining(true);
    try {
      const status = await signInGoogle();
      if (status === 'needsVerification') {
        setPendingJoin(code, tripParam || undefined);
      }
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setJoining(false);
    }
  };

  // Flujo demo (sin cuenta): comportamiento original.
  const handleDemoJoin = async () => {
    setError(null);
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    const normalized = email.trim();
    setJoining(true);
    try {
      const trip = await api.joinTripWithCode(code, normalized);
      await setProfile({
        userId: 'demo-user',
        email: normalized,
        displayName: emailToName(normalized, t('join.memberFallback')),
      });
      afterJoin(trip.id);
    } catch (err) {
      setError(localizeApiError(err, t));
      setJoining(false);
    }
  };

  // Cambiar de cuenta: cierra la sesion actual y vuelve al formulario (pre-llenado).
  const handleSwitchAccount = async () => {
    setError(null);
    setAutoJoinFailed(false);
    setAutoJoining(false);
    autoJoinGuardRef.current = null;
    try {
      await signOut();
    } catch (err) {
      setError(localizeApiError(err, t));
    }
  };

  if (needsVerification) return <VerificationGate />;

  const showAutoJoin = !joined && !loading && !autoJoinFailed && (canAutoJoin || autoJoining);
  const showWrongAccount = !joined && !loading && isWrongAccount;
  const showAutoJoinError = !joined && !loading && autoJoinFailed;
  const showGuestForm = !joined && !loading && !firebaseAuthed;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-sm">
            <Compass className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight text-foreground">Triplanner</span>
        </div>

        <Card className="rounded-2xl shadow-card">
          <CardHeader className="p-5 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="text-lg font-bold">{t('join.title')}</CardTitle>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            {(loading || loadingPreview) && (
              <p className="text-sm text-muted-foreground">{t('join.searching')}</p>
            )}

            {!loading && !loadingPreview && preview && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-semibold text-foreground">{preview.name}</p>
                {preview.destinationName && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" /> {preview.destinationName}
                  </p>
                )}
                {preview.ownerName && (
                  <p className="mt-1 text-xs text-muted-foreground">{t('join.invitedBy', { name: preview.ownerName })}</p>
                )}
              </div>
            )}

            {!loading && !loadingPreview && !preview && code.length === 12 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('join.notFound')}</span>
              </div>
            )}

            {joined ? (
              <div className="flex flex-col items-center py-4 text-center">
                <CheckCircle2 className="mb-2 h-10 w-10 text-emerald-500" />
                <p className="text-sm font-semibold text-foreground">{t('join.welcome')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('join.redirecting')}</p>
              </div>
            ) : showAutoJoin ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-semibold text-foreground">{t('join.autoJoining')}</p>
              </div>
            ) : showWrongAccount ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                  <UserX className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('join.wrongAccount', { email: preview?.invitedEmail ?? '' })}</span>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="button" variant="outline" onClick={handleSwitchAccount} className="w-full">
                  {t('join.switchAccount')}
                </Button>
              </div>
            ) : showAutoJoinError ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button type="button" variant="outline" onClick={handleSwitchAccount} className="w-full">
                  {t('join.switchAccount')}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => router.push('/')}
                    className="font-medium text-primary hover:text-primary/90"
                  >
                    {t('join.goToTrips')}
                  </button>
                </p>
              </div>
            ) : showGuestForm ? (
              <>
                <form onSubmit={handleSignUpJoin} className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor="join-email" className="mb-1 block">
                      {t('join.emailLabel')}
                    </Label>
                    <Input
                      id="join-email"
                      type="email"
                      value={email}
                      readOnly={prefilled}
                      onChange={prefilled ? undefined : (e) => setEmail(e.target.value)}
                      placeholder={t('join.emailPlaceholder')}
                      className={prefilled ? 'bg-muted' : undefined}
                    />
                    {prefilled ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t('join.emailPrefilled')}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">{t('join.emailHint')}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="join-code" className="mb-1 block">
                      {t('join.codeLabel')}
                    </Label>
                    <Input
                      id="join-code"
                      value={code}
                      autoFocus={Boolean(codeParam)}
                      onChange={(e) => setCode(e.target.value.trim())}
                      placeholder={t('join.codePlaceholder')}
                      className="tracking-widest"
                    />
                  </div>
                  <div>
                    <Label htmlFor="join-name" className="mb-1 block">
                      {t('auth.name')}
                    </Label>
                    <Input
                      id="join-name"
                      type="text"
                      autoComplete="name"
                      autoFocus={!codeParam}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('auth.namePlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="join-password" className="mb-1 block">
                      {t('auth.password')}
                    </Label>
                    <PasswordInput
                      id="join-password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('auth.passwordPlaceholder')}
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" disabled={joining} className="w-full">
                    <LogIn className="h-4 w-4" />
                    {joining ? t('join.joining') : t('join.signUpAndJoin')}
                  </Button>
                </form>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleJoin}
                  disabled={joining}
                  className="mt-3 w-full"
                >
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
                      variant="secondary"
                      onClick={handleDemoJoin}
                      disabled={joining}
                      className="w-full"
                    >
                      {t('join.demoJoin')}
                    </Button>
                    <p className="mt-2 text-center text-xs text-muted-foreground">{t('join.demoHint')}</p>
                  </>
                )}

                <p className="mt-5 text-center text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => router.push('/login')}
                    className="font-medium text-primary hover:text-primary/90"
                  >
                    {t('join.haveAccount')}
                  </button>
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
