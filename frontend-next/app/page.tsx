'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@/hooks/useQuery';
import { formatDateRange, formatMoney, listDays } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Trip } from '@/lib/types';
import AppShell from '@/components/AppShell';
import RequireAuth from '@/components/RequireAuth';
import NewTripModal from '@/components/NewTripModal';
import Modal from '@/components/Modal';
import InterestsPicker from '@/components/InterestsPicker';
import { Skeleton } from '@/components/ui/skeleton';
import { getTripCover } from '@/lib/trip-presets';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TripCover({ trip, className, children }: { trip: Trip; className: string; children?: ReactNode }) {
  const cover = getTripCover(trip);
  const letter = trip.destinationName.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <div
      className={className}
      data-letter={letter}
      style={
        cover.kind === 'default' && cover.gradient ? { background: cover.gradient } : undefined
      }
    >
      {cover.kind === 'preset' && cover.gradient && (
        <div className={`absolute inset-0 ${cover.gradient}`} />
      )}
      {cover.kind === 'photo' && cover.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {children}
    </div>
  );
}

function MiniTripCard({ trip }: { trip: Trip }) {
  const { t, locale } = useI18n();
  const days = listDays(trip.startDate, trip.endDate).length;
  return (
    <Link href={`/trip/${trip.id}`} className="trip-card card block">
      <TripCover trip={trip} className="tc-cover" />
      <div className="tc-body">
        <span className="mono">{trip.destinationName}</span>
        <h3>{trip.name}</h3>
        <div className="tc-meta">
          {formatDateRange(trip.startDate, trip.endDate, locale)} · {days}{' '}
          {t(days === 1 ? 'units.day' : 'units.days')}
        </div>
        <div className="tc-foot">
          <span className="badge badge-food">
            {formatMoney(trip.spent)} / {formatMoney(trip.totalBudget)}
          </span>
          <span className="btn btn-soft btn-sm">{t('premium.openTrip')}</span>
        </div>
      </div>
    </Link>
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
  const sorted = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const featured = sorted[0] ?? null;
  const rest = sorted.slice(1);
  const totalBudget = list.reduce((sum, t) => sum + t.totalBudget, 0);
  const totalSpent = list.reduce((sum, t) => sum + t.spent, 0);
  const available = Math.max(0, totalBudget - totalSpent);
  const daysAhead = featured ? listDays(featured.startDate, featured.endDate).length : 0;
  const nextItems = featured
    ? [...featured.items]
        .sort((a, b) => {
          const day = a.day.localeCompare(b.day);
          if (day !== 0) return day;
          return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
        })
        .slice(0, 3)
    : [];

  const todayLabel = capitalize(
    new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  );

  // Popup de intereses: solo si el usuario aún no tiene ninguno y no lo ha
  // descartado en esta sesión (sessionStorage por usuario).
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
      .catch(() => undefined);
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

  const handleCreated = (trip: Trip) => {
    setShowNew(false);
    router.push(`/trip/${trip.id}?template=1`);
  };

  const categoryLabel = (category: string) =>
    category === 'food'
      ? t('categories.food')
      : category === 'activity'
        ? t('categories.activity')
        : category === 'nightlife'
          ? t('categories.nightlife')
          : category === 'transporte'
            ? t('categories.transporte')
            : category === 'alojamiento'
              ? t('categories.alojamiento')
              : t('categories.sight');

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <span className="mono">{todayLabel}</span>
          <h1>{firstName ? t('premium.greeting', { name: firstName }) : t('home.greetingGuest')}</h1>
          <p>
            {loading
              ? t('home.loading')
              : list.length > 0
                ? t('premium.dashboard.subtitle', { trips: list.length, days: daysAhead })
                : t('home.subtitleEmpty')}
          </p>
        </div>
        <div className="head-actions">
          <Link href="/search" className="btn btn-ghost">
            <Search className="icon-sm" /> {t('premium.explore')}
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Plus className="icon-sm" /> {t('premium.newTrip')}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat card">
          <span className="stat-icon">
            <MapPin className="icon" />
          </span>
          <div>
            <div className="stat-label">{t('premium.stat.trips')}</div>
            <div className="stat-value">{list.length}</div>
          </div>
        </div>
        <div className="stat card">
          <span className="stat-icon">
            <CalendarDays className="icon" />
          </span>
          <div>
            <div className="stat-label">{t('premium.stat.days')}</div>
            <div className="stat-value">{daysAhead}</div>
            <div className="stat-delta">
              {featured ? formatDateRange(featured.startDate, featured.endDate, locale) : '—'}
            </div>
          </div>
        </div>
        <div className="stat card">
          <span className="stat-icon">
            <Wallet className="icon" />
          </span>
          <div>
            <div className="stat-label">{t('premium.stat.budget')}</div>
            <div className="stat-value">{formatMoney(available)}</div>
            <div className="stat-delta">
              {t('premium.stat.of', { total: formatMoney(totalBudget) })}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="featured card" style={{ padding: 24 }}>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : featured ? (
        <div className="dash-grid">
          <div>
            <Link href={`/trip/${featured.id}`} className="featured card">
              <TripCover trip={featured} className="featured-cover">
                <span className="cover-badge">
                  <CalendarDays className="icon-sm" /> {t('premium.upcoming')}
                </span>
              </TripCover>
              <div className="featured-body">
                <div>
                  <div>
                    <span className="mono">{featured.destinationName}</span>
                    <h2>{featured.name}</h2>
                    <div className="featured-meta">
                      <span>
                        <CalendarDays /> {formatDateRange(featured.startDate, featured.endDate, locale)}
                      </span>
                      <span>
                        <Clock /> {daysAhead} {t('units.days')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="featured-budget">
                  <div className="row">
                    <span>{t('premium.budget')}</span>
                    <strong>
                      {formatMoney(featured.spent)}{' '}
                      <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                        {t('premium.stat.of', { total: formatMoney(featured.totalBudget) })}
                      </span>
                    </strong>
                  </div>
                  <div className="progress">
                    <span
                      style={{
                        width: `${featured.totalBudget > 0 ? Math.min(100, (featured.spent / featured.totalBudget) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="row">
                    <span>
                      {featured.totalBudget > 0
                        ? `${((featured.spent / featured.totalBudget) * 100).toFixed(1)}%`
                        : '0%'}
                    </span>
                    <span>
                      {formatMoney(featured.spent / Math.max(1, daysAhead))} / {t('units.day')}
                    </span>
                  </div>
                </div>
                <div className="featured-foot">
                  <span className="btn btn-primary btn-sm">
                    {t('premium.openTrip')} <ArrowRight className="icon-sm" />
                  </span>
                </div>
              </div>
            </Link>

            <div className="trip-grid">
              {rest.map((trip) => (
                <MiniTripCard key={trip.id} trip={trip} />
              ))}
              <button type="button" className="new-trip card" onClick={() => setShowNew(true)}>
                <span className="plus">
                  <Plus className="icon" />
                </span>
                <strong style={{ fontSize: 13, color: 'var(--text)' }}>{t('premium.createTrip')}</strong>
                <span style={{ fontSize: 11.5 }}>{t('premium.createTripHint')}</span>
              </button>
            </div>
          </div>

          <div className="side-stack">
            <div className="side-card card">
              <div className="side-head">
                <h3>{t('premium.next')}</h3>
                <span className="mono">Día 1</span>
              </div>
              {nextItems.length > 0 ? (
                nextItems.map((item) => (
                  <div key={item.id} className="next-item">
                    <span className="next-time">{item.startTime?.slice(0, 5) ?? '—'}</span>
                    <div className="next-info">
                      <strong>{item.title}</strong>
                      <span>
                        {categoryLabel(item.category)} · {formatMoney(item.cost)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('home.subtitleEmpty')}</p>
              )}
              <Link href={`/trip/${featured.id}`} className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 14 }}>
                {t('premium.viewItinerary')}
              </Link>
            </div>

            <div className="side-card card ai-card">
              <div className="side-head">
                <h3>
                  <Sparkles className="icon-sm" style={{ verticalAlign: -2, marginRight: 5, color: 'var(--primary)' }} />
                  {t('premium.ai.title')}
                </h3>
              </div>
              <p>
                {t('premium.ai.body', {
                  days: daysAhead,
                  budget: formatMoney(available),
                })}
              </p>
              <Link href={`/trip/${featured.id}`} className="btn btn-primary btn-sm">
                {t('premium.ai.cta')}
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ margin: '0 auto', width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 14, background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <MapPin className="icon" />
          </div>
          <p style={{ marginTop: 16, fontWeight: 600 }}>{t('home.empty.title')}</p>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>{t('home.empty.subtitle')}</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => setShowNew(true)}>
            {t('home.empty.cta')}
          </button>
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
