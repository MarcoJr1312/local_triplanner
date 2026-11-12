'use client';

import { useRouter } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery } from '@/hooks/useQuery';
import { useI18n } from '@/lib/i18n';
import type { Trip } from '@/lib/types';
import AppShell from '@/components/AppShell';
import RequireAuth from '@/components/RequireAuth';
import CalendarView from '@/components/CalendarView';

function CalendarContent() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { data: trips } = useQuery(async () => {
    const summaries = await api.listMyTrips();
    const full = await Promise.all(summaries.map((s) => api.getTrip(s.tripId)));
    return full.filter((x): x is Trip => x !== null);
  }, []);
  const trip = trips?.[0];

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <span className="mono">{t('premium.nav.calendar')}</span>
          <h1>{t('premium.nav.calendar')}</h1>
          <p>{t('premium.calendar.subtitle')}</p>
        </div>
      </div>

      {trip ? (
        <div className="card" style={{ padding: 18 }}>
          <div className="cal-head" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 20 }}>{trip.name}</h2>
            <span className="mono">{trip.destinationName}</span>
          </div>
          <CalendarView
            trip={trip}
            activeDay={trip.startDate}
            locale={locale}
            onSelectDay={() => router.push(`/trip/${trip.id}`)}
            onOpenItem={() => router.push(`/trip/${trip.id}`)}
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div
            style={{
              margin: '0 auto',
              width: 48,
              height: 48,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 14,
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
            }}
          >
            <CalendarDays className="icon" />
          </div>
          <p style={{ marginTop: 16, fontWeight: 600 }}>{t('home.empty.title')}</p>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>{t('home.empty.subtitle')}</p>
        </div>
      )}
    </AppShell>
  );
}

export default function CalendarPage() {
  return (
    <RequireAuth>
      <CalendarContent />
    </RequireAuth>
  );
}
