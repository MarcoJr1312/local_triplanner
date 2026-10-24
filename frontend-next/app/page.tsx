'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@/hooks/useQuery';
import { parseDate, toIsoDate } from '@/lib/format';
import { useI18n, type Translate } from '@/lib/i18n';
import type { Trip } from '@/lib/types';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import RequireAuth from '@/components/RequireAuth';
import NewTripModal from '@/components/NewTripModal';
import Modal from '@/components/Modal';
import InterestsPicker from '@/components/InterestsPicker';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import TripCard from '@/components/home/TripCard';

const DAY_MS = 86_400_000;

function greetingSubtitle(t: Translate, trips: Trip[]): string {
  if (trips.length === 0) return t('home.subtitleEmpty');
  const count =
    trips.length === 1 ? t('home.tripsCountOne') : t('home.tripsCountMany', { n: trips.length });

  const today = toIsoDate(new Date());
  const next = trips
    .filter((t) => t.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  if (!next) return `${count} · ${t('home.noUpcoming')}`;

  const daysUntil = Math.round(
    (parseDate(next.startDate).getTime() - parseDate(today).getTime()) / DAY_MS
  );
  const when =
    daysUntil <= 0
      ? t('home.nextToday')
      : daysUntil === 1
        ? t('home.nextTomorrow')
        : t('home.nextInDays', { n: daysUntil });

  return `${count} · ${when}`;
}

function TripCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-card">
      <Skeleton className="h-[140px] rounded-none" />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex items-center gap-1.5 pt-1">
          <Skeleton className="h-[26px] w-[26px] rounded-full" />
          <Skeleton className="h-[26px] w-[26px] rounded-full" />
          <Skeleton className="h-[26px] w-[26px] rounded-full" />
        </div>
      </div>
    </div>
  );
}

function TripsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { data: trips, loading } = useQuery(async () => {
    const summaries = await api.listMyTrips();
    const full = await Promise.all(summaries.map((s) => api.getTrip(s.tripId)));
    return full.filter((t): t is Trip => t !== null);
  }, []);
  const [showNew, setShowNew] = useState(false);
  const [showInterests, setShowInterests] = useState(false);
  const firstName = user?.displayName.split(' ')[0] ?? '';
  const list = trips ?? [];

  // Popup de intereses: solo si el usuario aún no tiene ninguno y no lo ha
  // descartado en esta sesión (sessionStorage por usuario; no reaparece al
  // navegar al Home dentro de la misma pestaña).
  const interestsKey = user ? `triplanner.interestsPrompted.${user.userId}` : null;

  useEffect(() => {
    if (!interestsKey) return;
    if (sessionStorage.getItem(interestsKey) === '1') return;
    let cancelled = false;
    api
      .getMyInterests()
      .then((terms) => {
        if (cancelled) return;
        if (terms.length === 0) setShowInterests(true);
        else sessionStorage.setItem(interestsKey, '1');
      })
      .catch(() => {
        // Si falla la consulta no bloqueamos el Home con el popup.
      });
    return () => {
      cancelled = true;
    };
  }, [interestsKey]);

  const dismissInterests = () => {
    if (interestsKey) sessionStorage.setItem(interestsKey, '1');
    setShowInterests(false);
  };

  const saveInterests = async (terms: string[]) => {
    await api.setMyInterests(terms);
    dismissInterests();
  };

  // La lista se refresca sola (api.createTrip → notify()), así que aquí solo
  // encadenamos los modales del flujo.
  const handleCreated = (trip: Trip) => {
    setShowNew(false);
    // El popup de plantilla vive DENTRO del dashboard del viaje creado
    // (feedback Marco): navegamos al viaje con el flag ?template=1.
    router.push(`/trip/${trip.id}?template=1`);
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[1.45rem] font-bold tracking-[-0.02em] text-foreground">
            {firstName ? t('home.greeting', { name: firstName }) : t('home.greetingGuest')}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? t('home.loading') : greetingSubtitle(t, list)}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setShowNew(true)}
          className="order-last h-auto w-full gap-2 rounded-xl px-4 py-2.5 font-semibold shadow-sm sm:order-none sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          {t('home.newTrip')}
        </Button>
        {user && (
          <span className="relative shrink-0">
            <Avatar user={user} size="md" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {[0, 1, 2].map((i) => (
            <TripCardSkeleton key={i} />
          ))}
        </div>
      ) : list.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {list.map((t) => (
            <TripCard key={t.id} trip={t} onOpen={() => router.push(`/trip/${t.id}`)} />
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-border bg-card p-8 text-center shadow-card sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MapPin className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-foreground">{t('home.empty.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('home.empty.subtitle')}</p>
          <Button
            type="button"
            onClick={() => setShowNew(true)}
            className="mt-5 h-auto w-full rounded-xl px-4 py-2.5 font-semibold shadow-sm sm:w-auto"
          >
            {t('home.empty.cta')}
          </Button>
        </div>
      )}

      <NewTripModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />

      <Modal
        open={showInterests && Boolean(user)}
        onClose={dismissInterests}
        title={t('interests.title')}
        size="md"
        hideClose
        dismissible={false}
      >
        <InterestsPicker
          initial={[]}
          onSave={saveInterests}
          onClose={dismissInterests}
          closeLabel={t('interests.later')}
          subtitle={t('interests.subtitle')}
        />
      </Modal>
    </AppShell>
  );
}

export default function TripsPage() {
  return (
    <RequireAuth>
      <TripsContent />
    </RequireAuth>
  );
}
