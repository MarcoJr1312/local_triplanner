import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useQuery } from '../hooks/useQuery';
import { formatDateRange, formatMoney, formatWeekday, listDays } from '../lib/format';
import type { Presence, TripItem } from '../lib/types';
import AppShell from '../components/AppShell';
import BudgetBar from '../components/BudgetBar';
import CategoryBars from '../components/CategoryBars';
import ItemCard from '../components/ItemCard';
import LocationDetailModal from '../components/LocationDetailModal';
import MiniStat from '../components/MiniStat';
import MembersPanel from '../components/MembersPanel';
import AddItemModal from '../components/AddItemModal';
import SuggestionsPanel from '../components/SuggestionsPanel';
import InviteModal from '../components/InviteModal';
import SettingsModal from '../components/SettingsModal';
import ItemEditModal from '../components/ItemEditModal';

export default function TripDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: trip, loading } = useQuery(() => api.getTrip(id), [id]);
  const { data: presence = [] } = useQuery(() => api.listPresence(id), [id]);

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingItem, setEditingItem] = useState<TripItem | null>(null);
  const [detailItem, setDetailItem] = useState<TripItem | null>(null);

  const days = useMemo(() => (trip ? listDays(trip.startDate, trip.endDate) : []), [trip]);
  const avgPerDay = useMemo(() => (trip && days.length > 0 ? trip.spent / days.length : 0), [trip, days]);

  useEffect(() => {
    if (!trip) return;
    setActiveDay((prev) => (prev && days.includes(prev) ? prev : days[0] ?? null));
  }, [trip, days]);

  useEffect(() => {
    if (!user || !trip) return;
    api.touchPresence({ tripId: trip.id, displayName: user.displayName, color: '#0d9488' }).catch(() => undefined);
  }, [user, trip?.id]);

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </AppShell>
    );
  }

  if (!trip) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-card">
          <p className="text-sm font-medium text-slate-600">Viaje no encontrado.</p>
          <Link
            to="/"
            className="mt-3 inline-block rounded-lg text-sm font-medium text-brand-600 transition duration-150 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Volver a mis viajes
          </Link>
        </div>
      </AppShell>
    );
  }

  const myRole = trip.myRole;
  const canEdit = myRole !== 'viewer';
  const itemsForDay = trip.items
    .filter((i) => i.day === activeDay)
    .sort((a, b) => a.order - b.order);

  const handleMove = async (itemId: string, day: string) => {
    const order = trip.items.filter((i) => i.day === day).length;
    await api.moveItem(trip.id, itemId, day, order);
  };

  const handleRemove = async (itemId: string) => {
    await api.removeItem(trip.id, itemId);
  };

  const handleCostChange = async (itemId: string, cost: number) => {
    await api.setItemCost(trip.id, itemId, cost);
  };

  const saveBudget = async () => {
    const parsed = Number(budgetDraft);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      await api.setBudget(trip.id, parsed);
    }
    setEditingBudget(false);
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(trip.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore
    }
  };

  return (
    <AppShell>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-slate-500 transition duration-150 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <ArrowLeft className="h-4 w-4" /> Mis viajes
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{trip.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-slate-400" /> {trip.destinationName}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-slate-400" /> {formatDateRange(trip.startDate, trip.endDate)}
              </span>
              <button
                type="button"
                onClick={copyInvite}
                className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition duration-150 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                title="Copiar código de invitación"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                Código: <span className="font-mono font-semibold">{trip.inviteCode}</span>
              </button>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-card transition duration-150 hover:border-slate-300 hover:text-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <Settings className="h-4 w-4" /> Ajustes
            </button>
          )}
        </div>
      </header>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat
          icon={<Calendar className="h-5 w-5" />}
          label="Días planificados"
          value={String(days.length)}
          tone="sky"
        />
        <MiniStat
          icon={<Layers className="h-5 w-5" />}
          label="Actividades"
          value={String(trip.items.length)}
          tone="emerald"
        />
        <MiniStat
          icon={<TrendingUp className="h-5 w-5" />}
          label="Gasto promedio / día"
          value={formatMoney(avgPerDay, 0)}
          tone="brand"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {/* Días */}
          <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setActiveDay(d)}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                  d === activeDay
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-700'
                }`}
              >
                <span className="block text-xs font-medium capitalize">{formatWeekday(d).slice(0, 3)}</span>
                <span className="block text-sm font-semibold">Día {i + 1}</span>
              </button>
            ))}
          </div>

          {/* Actividades del día */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Plan del día {activeDay ? days.indexOf(activeDay) + 1 : ''}
              </h2>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSuggestions(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition duration-150 hover:bg-violet-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                  >
                    <Sparkles className="h-4 w-4" /> Pedir sugerencias
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    <Plus className="h-4 w-4" /> Añadir actividad
                  </button>
                </div>
              )}
            </div>

            {itemsForDay.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-card">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <MapPin className="h-6 w-6" />
                </div>
                <p className="mt-4 text-sm font-medium text-slate-600">No hay planes para este día todavía.</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    <Plus className="h-4 w-4" /> Añadir primera actividad
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {itemsForDay.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    members={trip.members}
                    canEdit={canEdit}
                    currentUserId={user?.userId ?? null}
                    days={days}
                    onEdit={() => setEditingItem(item)}
                    onView={() => (item.activityId ? setDetailItem(item) : setEditingItem(item))}
                    onMove={(day) => handleMove(item.id, day)}
                    onRemove={() => handleRemove(item.id)}
                    onCostChange={(cost) => handleCostChange(item.id, cost)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Columna lateral */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
                <Wallet className="h-4 w-4 text-slate-400" /> Presupuesto
              </h2>
              {canEdit &&
                (editingBudget ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={budgetDraft}
                      onChange={(e) => setBudgetDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveBudget();
                      }}
                      autoFocus
                      className="w-24 rounded-lg border border-brand-300 px-2 py-1 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    <button
                      type="button"
                      onClick={saveBudget}
                      className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setBudgetDraft(String(trip.totalBudget));
                      setEditingBudget(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                ))}
            </div>
            <BudgetBar total={trip.totalBudget} spent={trip.spent} />
            {trip.spentByCategory.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Por categoría</p>
                <CategoryBars spentByCategory={trip.spentByCategory} />
              </div>
            )}
          </div>

          <MembersPanel
            trip={trip}
            presence={presence as Presence[]}
            currentUserId={user?.userId ?? null}
            onInvite={() => setShowInvite(true)}
            onLeft={() => navigate('/')}
          />
        </div>
      </div>

      {activeDay && (
        <>
          <AddItemModal
            open={showAdd}
            tripId={trip.id}
            destinationId={trip.destinationId}
            day={activeDay}
            onClose={() => setShowAdd(false)}
          />
          <SuggestionsPanel open={showSuggestions} tripId={trip.id} day={activeDay} onClose={() => setShowSuggestions(false)} />
        </>
      )}
      <InviteModal open={showInvite} tripId={trip.id} onClose={() => setShowInvite(false)} />
      <SettingsModal open={showSettings} trip={trip} onClose={() => setShowSettings(false)} />
      <ItemEditModal open={!!editingItem} item={editingItem} tripId={trip.id} onClose={() => setEditingItem(null)} />
      <LocationDetailModal
        open={!!detailItem}
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={(it) => setEditingItem(it)}
      />
    </AppShell>
  );
}
