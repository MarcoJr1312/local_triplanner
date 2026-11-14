'use client';

// Public invitation landing page for the local demo.
// No email/Firebase: the second seeded identity (`demo-friend`) accepts the
// invitation. The owner can switch to it from the wrong-account panel.

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Compass, LogIn, AlertCircle, CheckCircle2, MapPin, Loader2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, localizeApiError, ApiError, DEMO_FRIEND_ID } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import type { TripPreview } from '@/lib/types';

const CODE_RE = /^[A-Za-z0-9_-]{12}$/;

export default function JoinPage() {
  const router = useRouter();
  const { user, loading, signInDemo, signOut } = useAuth();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const codeParam = searchParams.get('code') ?? '';

  const [code, setCode] = useState(codeParam);
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const isFriend = user?.userId === DEMO_FRIEND_ID;
  const invitedEmail = preview?.invitedEmail ?? '';
  const emailToUse = invitedEmail || user?.email || 'friend@triplanner.local';

  useEffect(() => {
    let alive = true;
    if (!CODE_RE.test(code)) {
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

  const afterJoin = (tripId: string) => {
    setJoined(true);
    setTimeout(() => router.push(`/trip/${tripId}`), 900);
  };

  const handleJoin = async () => {
    setError(null);
    if (!CODE_RE.test(code)) {
      setError(t('errors.invalidCode'));
      return;
    }
    setJoining(true);
    try {
      if (!isFriend) await signInDemo(DEMO_FRIEND_ID);
      const trip = await api.joinTripWithCode(code, emailToUse);
      afterJoin(trip.id);
    } catch (err) {
      const codeErr = err instanceof ApiError ? err.code : undefined;
      if (codeErr === 'INVITE_ALREADY_USED' && preview) {
        afterJoin(preview.id);
        return;
      }
      setError(localizeApiError(err, t));
      setJoining(false);
    }
  };

  const handleSwitch = async () => {
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError(localizeApiError(err, t));
    }
  };

  if (loading || loadingPreview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const wrongAccount = Boolean(preview && user && !isFriend);

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
            {preview && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-semibold text-foreground">{preview.name}</p>
                {preview.destinationName && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" /> {preview.destinationName}
                  </p>
                )}
                {preview.ownerName && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('join.invitedBy', { name: preview.ownerName })}
                  </p>
                )}
              </div>
            )}

            {!preview && code.length === 12 && (
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
            ) : (
              <div className="mt-4 space-y-4">
                {wrongAccount && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                    <UserX className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('join.wrongAccount', { email: invitedEmail })}</span>
                  </div>
                )}

                {!preview && (
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
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="button" onClick={handleJoin} disabled={joining} className="w-full">
                  <LogIn className="h-4 w-4" />
                  {joining
                    ? t('join.joining')
                    : wrongAccount
                      ? t('join.switchToFriend')
                      : t('join.demoFriendJoin')}
                </Button>
                <p className="text-center text-xs text-muted-foreground">{t('join.demoFriendHint')}</p>

                {wrongAccount && (
                  <Button type="button" variant="outline" onClick={handleSwitch} className="w-full">
                    {t('join.switchAccount')}
                  </Button>
                )}

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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
