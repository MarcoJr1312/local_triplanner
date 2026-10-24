import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, CalendarCheck, MapPin, Plane, Plus, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useQuery } from '../hooks/useQuery';
import { formatDateRange, formatMoney, listDays } from '../lib/format';
import type { Trip } from '../lib/types';
import AppShell from '../components/AppShell';
import RoleBadge from '../components/RoleBadge';
import MiniStat from '../components/MiniStat';
import NewTripModal from '../components/NewTripModal';

export default function TripsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: trips, loading } = useQuery(async () => {
    const summaries = await api.listMyTrips();
    const full = await Promise.all(summaries.map((s) => api.getTrip(s.tripId)));
    return full.filter((t): t is Trip => t !== null);
  }, []);
  const [showNew, setShowNew] = useState(false);

  const stats = useMemo(() => {
    const list = trips ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: list.length,
      active: list.filter((t) => t.endDate >= today).length,
      budget: list.reduce((a, t) => a + t.totalBudget, 0),
    };
  }, [trips]);

  const firstName = user?.displayName.split(' ')[0] ?? '';

  const handleCreated = (tripId: string) => {
    setShowNew(false);
    navigate(`/trip/${tripId}`);
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Hola{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-slate-500">Planifica, comparte y descubre con tu equipo.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          Nuevo viaje
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2.5">
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="h-11 w-36 animate-pulse rounded-xl bg-slate-200/70" />)
        ) : (
          <>
            <MiniStat
              compact
              icon={<Plane className="h-4 w-4" />}
              label="viajes"
              value={String(stats.total)}
              tone="brand"
            />
            <MiniStat
              compact
              icon={<CalendarCheck className="h-4 w-4" />}
              label="activos"
              value={String(stats.active)}
              tone="sky"
            />
            <MiniStat
              compact
              icon={<Wallet className="h-4 w-4" />}
              label="presupuesto"
              value={formatMoney(stats.budget, 0)}
              tone="emerald"
            />
          </>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-200/70" />
          ))}
        </div>
      ) : trips && trips.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} onOpen={() => navigate(`/trip/${t.id}`)} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
            <MapPin className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-600">Todavía no tienes viajes.</p>
          <p className="mt-1 text-sm text-slate-400">Crea tu primer itinerario y empieza a planificar.</p>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="mt-5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Crear el primero
          </button>
        </div>
      )}

      <NewTripModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </AppShell>
  );
}

function TripCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const days = listDays(trip.startDate, trip.endDate).length;
  const pct = trip.totalBudget > 0 ? Math.min(100, (trip.spent / trip.totalBudget) * 100) : 0;
  const over = trip.spent > trip.totalBudget;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        <span className="relative text-4xl font-bold tracking-tight text-white drop-shadow-sm">
          {trip.destinationName}
        </span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900 transition-colors duration-150 group-hover:text-brand-700">
            {trip.name}
          </h3>
          <RoleBadge role={trip.myRole} />
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-400" />
            {trip.destinationName}
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400" />
              {formatDateRange(trip.startDate, trip.endDate)}
            </p>
            <span className="shrink-0 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              {days} {days === 1 ? 'día' : 'días'}
            </span>
          </div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Presupuesto</span>
            <span className="tabular-nums text-slate-600">
              {formatMoney(trip.spent, 0)}
              <span className="text-slate-400"> / {formatMoney(trip.totalBudget, 0)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${over ? 'bg-rose-500' : 'bg-brand-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
