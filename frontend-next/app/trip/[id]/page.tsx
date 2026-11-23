'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock,
  Copy,
  MapPin,
  Pencil,
  Plus,
  Route,
  Settings,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api, localizeApiError, subscribePresence, subscribeTrip } from '@/lib/api';
import { toast } from 'sonner';
import { buildGoogleMapsRouteUrl, MAX_ROUTE_STOPS, type RouteStop } from '@/lib/routes';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@/hooks/useQuery';
import { formatDateRange, formatMoney, formatWeekday, listDays, parseDate } from '@/lib/format';
import { loadSortMode, saveSortMode, sortItemsBy, type SortMode } from '@/lib/sorting';
import { useI18n, type Locale } from '@/lib/i18n';
import type { Presence, TripItem } from '@/lib/types';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import BudgetBar from '@/components/BudgetBar';
import CalendarView from '@/components/CalendarView';
import CategoryBars from '@/components/CategoryBars';
import ItemCard from '@/components/ItemCard';
import LocationDetailModal from '@/components/LocationDetailModal';
import ReminderDialog from '@/components/ReminderDialog';
import MembersPanel from '@/components/MembersPanel';
import AddItemModal from '@/components/AddItemModal';
import SuggestionsPanel from '@/components/SuggestionsPanel';
import DayTemplateOffer from '@/components/DayTemplateOffer';
import DayPlanModal from '@/components/DayPlanModal';
import InviteModal from '@/components/InviteModal';
import RouteModal from '@/components/RouteModal';
import SettingsModal from '@/components/SettingsModal';
import SortSelector from '@/components/SortSelector';
import ItemEditModal from '@/components/ItemEditModal';
import RequireAuth from '@/components/RequireAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { getTripCover } from '@/lib/trip-presets';

const GLASS_BUTTON =
  'inline-flex items-center gap-1.5 rounded-xl bg-[rgb(255_255_255/0.16)] px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-md transition duration-150 max-sm:min-h-11 hover:bg-[rgb(255_255_255/0.24)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatLongDate(value: string, locale: Locale): string {
  return capitalize(
    parseDate(value).toLocaleDateString(locale === 'en' ? 'en-US' : 'es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  );
}

function formatTabDate(value: string, locale: Locale): string {
  const day = parseDate(value).getDate();
  return `${capitalize(formatWeekday(value, locale).slice(0, 3))} ${day}`;
}

function StatCard({
  icon,
  label,
  value,
  extra,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  extra?: string;
}) {
  return (
    <div className="stat card">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {extra && <div className="stat-delta">{extra}</div>}
      </div>
    </div>
  );
}

function TripDetailContent() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();

  const { data: trip, loading } = useQuery(() => api.getTrip(id), [id]);
  const [presence, setPresence] = useState<Presence[]>([]);

  // Refs con el último trip/usuario para resolver el actor dentro del handler
  // de la suscripción sin re-suscribir en cada refetch.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const userIdRef = useRef(user?.userId ?? null);
  userIdRef.current = user?.userId ?? null;
  const leavingRef = useRef(false);

  const [activeDay, setActiveDay] = useState<string | null>(null);
  // Vista del itinerario: lista por día (default) o grilla de calendario.
  const [view, setView] = useState<'itinerary' | 'calendar'>('itinerary');
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');
  // Orden de la lista del día activo (persistido por viaje). Lazy init para no
  // tocar localStorage en cada render.
  const [sortMode, setSortMode] = useState<SortMode>(() => loadSortMode(id));

  const [showAdd, setShowAdd] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Oferta de día plantilla DENTRO del dashboard (feedback Marco): llega
  // desde el Home vía /trip/<id>?template=1 y se muestra una sola vez.
  const [showTemplateOffer, setShowTemplateOffer] = useState(false);
  const [showTemplatePlan, setShowTemplatePlan] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('template')) {
      setShowTemplateOffer(true);
      router.replace(window.location.pathname);
    }
  }, [router]);
  const [editingItem, setEditingItem] = useState<TripItem | null>(null);
  const [detailItem, setDetailItem] = useState<TripItem | null>(null);
  // Overrides optimistas de favorito por item (el backend refresca el valor real).
  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});

  const handleToggleFavorite = async (item: TripItem) => {
    if (!item.activityId) return;
    const next = !(favOverrides[item.id] ?? Boolean(item.isFavorite));
    setFavOverrides((prev) => ({ ...prev, [item.id]: next }));
    try {
      await api.favoriteLocation(item.activityId, next);
    } catch (err) {
      setFavOverrides((prev) => ({ ...prev, [item.id]: !next }));
      toast.error(localizeApiError(err, t));
    }
  };

  // Reminder configuration lives in the trips service; the dialog edits the
  // selected item and the trip subscription refreshes the bell state.
  const [reminderItem, setReminderItem] = useState<TripItem | null>(null);

  // Ruta del dia: items con coordenadas o con ubicacion manual (texto),
  // ordenados por hora; sin hora al final. Items sin ninguna ubicacion quedan
  // fuera. Los items con lugar vinculado siempre usan sus coordenadas.
  const routeStops = useMemo(() => {
    if (!trip || !activeDay) return [] as RouteStop[];
    const dayItems = trip.items.filter((i) => i.day === activeDay);
    const routable = dayItems.filter(
      (i) => (i.lat != null && i.lng != null) || Boolean(i.locationText?.trim()),
    );
    const timed = routable
      .filter((i) => i.startTime)
      .sort((a, b) => (a.startTime! < b.startTime! ? -1 : a.startTime! > b.startTime! ? 1 : 0));
    const untimed = routable.filter((i) => !i.startTime);
    return [...timed, ...untimed].map((i): RouteStop =>
      i.lat != null && i.lng != null
        ? { lat: i.lat, lng: i.lng }
        : { text: i.locationText!.trim() },
    );
  }, [trip, activeDay]);

  const routeOverflow = routeStops.length > MAX_ROUTE_STOPS;

  // Abre Google Maps con el origen dado por el usuario en el popup (o vacio).
  const openRoute = (origin: string | null) => {
    const url = buildGoogleMapsRouteUrl(routeStops.slice(0, MAX_ROUTE_STOPS), origin);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const days = useMemo(() => (trip ? listDays(trip.startDate, trip.endDate) : []), [trip]);
  // Gasto promedio sobre los días que SÍ tienen actividades registradas
  // (feedback Marco): un día vacío no diluye el promedio.
  const daysWithItems = useMemo(() => {
    if (!trip) return 0;
    const active = new Set(trip.items.map((i) => i.day).filter((d): d is string => Boolean(d)));
    return days.filter((d) => active.has(d)).length;
  }, [trip, days]);
  const avgPerDay = useMemo(
    () => (trip && daysWithItems > 0 ? trip.spent / daysWithItems : 0),
    [trip, daysWithItems],
  );

  // Lista del día activo (SOLO vista itinerario): se ordena según `sortMode`.
  // El calendario usa su propio orden cronológico (sortDayItems) y no se toca.
  const dayItems = useMemo(
    () => (trip && activeDay ? trip.items.filter((i) => i.day === activeDay) : []),
    [trip, activeDay]
  );
  const itemsForDay = useMemo(() => sortItemsBy(dayItems, sortMode), [dayItems, sortMode]);

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    saveSortMode(id, mode);
  };

  useEffect(() => {
    if (!trip) return;
    setActiveDay((prev) => (prev && days.includes(prev) ? prev : days[0] ?? null));
  }, [trip, days]);

  // Mantener detailItem sincronizado con el trip refrescado (los adjuntos
  // viven en trip.items: al subir/quitar un boleto, notify() refetcha el trip
  // y el modal debe ver la lista actualizada).
  useEffect(() => {
    if (!trip || !detailItem) return;
    const fresh = trip.items.find((i) => i.id === detailItem.id);
    if (fresh && fresh !== detailItem) setDetailItem(fresh);
  }, [trip, detailItem]);

  // Presencia en vivo: listPresence UNA sola vez al montar (carga inicial) y
  // despues solo la subscription onPresenceChanged (SSE). El backend
  // (backend/server/src/presence.ts) publica la entrada COMPLETA del usuario en
  // cada heartbeat y NO emite ningun evento de salida ni campo de expiracion:
  // por eso el merge simple por userId (upsert) es suficiente y correcto. Los
  // puntos de usuarios inactivos se atenuan por antiguedad de lastSeen, no hay
  // que borrarlos aqui. Cleanup al desmontar.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api
      .listPresence(id)
      .then((list) => {
        if (!alive) return;
        // Merge por userId conservando la entrada mas reciente: si un evento
        // en vivo llego antes de resolver esta carga inicial, no lo pisamos.
        setPresence((prev) => {
          const map = new Map(prev.map((p) => [p.userId, p]));
          for (const p of list) {
            const existing = map.get(p.userId);
            if (!existing || existing.lastSeen <= p.lastSeen) map.set(p.userId, p);
          }
          return [...map.values()];
        });
      })
      .catch(() => undefined);

    const controller = new AbortController();
    const cleanup = subscribePresence(
      id,
      (ev) => {
        setPresence((prev) => {
          const idx = prev.findIndex((p) => p.userId === ev.userId);
          if (idx === -1) return [...prev, ev];
          const next = [...prev];
          next[idx] = ev;
          return next;
        });
      },
      controller.signal
    );

    return () => {
      alive = false;
      cleanup();
      controller.abort();
    };
  }, [id]);

  useEffect(() => {
    if (!user || !trip) return;
    api.touchPresence({ tripId: trip.id, displayName: user.displayName, color: '#0d9488' }).catch(() => undefined);
  }, [user, trip?.id]);

  // Al abrir/cerrar el editor publica que item estas editando (o null) para
  // que el badge "X esta editando" del resto aparezca/desaparezca al instante.
  useEffect(() => {
    if (!user || !trip) return;
    api
      .touchPresence({
        tripId: trip.id,
        displayName: user.displayName,
        color: '#0d9488',
        editingItemId: editingItem?.id ?? null,
      })
      .catch(() => undefined);
  }, [user, trip?.id, editingItem?.id]);

  // Cambios en vivo del viaje (onTripChanged): agrupa la ráfaga ~300ms y, al
  // disparar, re-fetchea (notify) y avisa si el actor es otro. Para bajas
  // (deleteTrip de cualquiera / leaveTrip propio) avisa y vuelve al Home.
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let changed = false;
    let actorId: string | null = null;
    let removal: 'deleted' | 'left' | null = null;

    const flush = () => {
      timer = null;
      const removedNow = removal;
      const changedNow = changed;
      const actorNow = actorId;
      changed = false;
      actorId = null;
      removal = null;

      if (removedNow) {
        if (leavingRef.current) return;
        leavingRef.current = true;
        toast.info(t(removedNow === 'deleted' ? 'trip.realtimeDeleted' : 'trip.realtimeLeft'));
        router.push('/');
        return;
      }

      if (changedNow) {
        api.notify();
        if (actorNow && actorNow !== userIdRef.current) {
          const name = tripRef.current?.members.find((m) => m.userId === actorNow)?.displayName;
          toast.info(name ? t('trip.realtimeChanged', { name }) : t('trip.realtimeByUnknown'));
        }
      }
    };

    const cleanup = subscribeTrip(
      id,
      (ev) => {
        const type = ev.mutationType ?? '';
        const isDelete = type.includes('deleteTrip');
        const isLeave = type.includes('leaveTrip');
        const isMine = ev.actorId === userIdRef.current;

        if (isDelete || (isLeave && isMine)) {
          removal = isDelete ? 'deleted' : 'left';
        } else {
          changed = true;
          if (ev.actorId !== userIdRef.current) actorId = ev.actorId;
        }

        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 300);
      },
      controller.signal
    );

    return () => {
      if (timer) clearTimeout(timer);
      cleanup();
      controller.abort();
    };
  }, [id, router, t]);

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-5">
          <Skeleton className="h-[200px] rounded-[20px]" />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-[16px] border border-border bg-card p-4 shadow-card ${i === 2 ? 'max-sm:col-span-2' : ''}`}
              >
                <Skeleton className="h-9 w-9 rounded-[11px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-[1fr_310px]">
            <div className="space-y-4">
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-24 rounded-full" />
                ))}
              </div>
              <div className="rounded-[16px] border border-border bg-card p-4 shadow-card sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <div className="flex-1" />
                  <div className="flex gap-2">
                    <Skeleton className="h-9 w-28 rounded-xl" />
                    <Skeleton className="h-9 w-28 rounded-xl" />
                  </div>
                </div>
                <div className="space-y-2.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card">
                      <Skeleton className="h-8 w-11 rounded-lg" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                      <Skeleton className="h-5 w-12 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-[16px] border border-border bg-card p-4 shadow-card">
                <Skeleton className="mb-3 h-4 w-28" />
                <Skeleton className="mb-2 h-7 w-1/2" />
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
              <div className="rounded-[16px] border border-border bg-card p-4 shadow-card">
                <Skeleton className="mb-3 h-4 w-24" />
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!trip) {
    return (
      <AppShell>
        <div className="rounded-[16px] border border-border bg-card p-12 text-center shadow-card">
          <p className="text-sm font-medium text-muted-foreground">{t('trip.notFound')}</p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-lg text-sm font-medium text-primary transition duration-150 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {t('trip.backToTrips')}
          </Link>
        </div>
      </AppShell>
    );
  }

  const myRole = trip.myRole;
  const canEdit = myRole !== 'viewer';

  const onlineIds = new Set((presence ?? []).map((p) => p.userId));
  const budgetPct = trip.totalBudget > 0 ? (trip.spent / trip.totalBudget) * 100 : 0;
  const heroMembers = trip.members.slice(0, 3);
  const memberOverflow = trip.members.length - heroMembers.length;

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

  const cover = getTripCover(trip);
  const CoverIcon = cover.icon;

  return (
    <AppShell>
      <Link href="/" className="back-link">
        <ArrowLeft className="h-4 w-4" /> {t('nav.myTrips')}
      </Link>

      <header
        className="trip-cover"
        style={cover.kind === 'default' && cover.gradient ? { background: cover.gradient } : undefined}
      >
        {cover.kind === 'preset' && cover.gradient && (
          <div className={`absolute inset-0 ${cover.gradient}`} />
        )}
        {cover.kind === 'photo' && cover.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <span className="monogram">
          {trip.destinationName.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        <div className="cover-content">
          <div>
            <span className="mono" style={{ color: 'rgba(255,255,255,.65)' }}>
              {trip.destinationName}
            </span>
            <h1>
              {trip.name.toLowerCase().startsWith(trip.destinationName.toLowerCase())
                ? trip.name
                : `${trip.destinationName} — ${trip.name}`}
            </h1>
            <div className="cover-meta">
              <span>
                <CalendarDays /> {formatDateRange(trip.startDate, trip.endDate, locale)}
              </span>
              <span>
                <Clock /> {days.length} {t(days.length === 1 ? 'units.day' : 'units.days')}
              </span>
              <span>
                <Users /> {trip.members.length}{' '}
                {t(trip.members.length === 1 ? 'units.member' : 'units.members')}
              </span>
            </div>
          </div>
          <div className="cover-actions">
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="btn btn-ghost btn-sm"
              >
                <Settings className="h-4 w-4" /> {t('trip.settings')}
              </button>
            )}
            <button type="button" onClick={() => setShowInvite(true)} className="btn btn-ghost btn-sm">
              <UserPlus className="h-4 w-4" /> {t('members.invite')}
            </button>
            <div className="avatar-stack">
              {heroMembers.map((m) => (
                <span key={m.userId} title={m.displayName} className="relative">
                  <Avatar user={m} size="sm" />
                  {onlineIds.has(m.userId) && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
                  )}
                </span>
              ))}
              {memberOverflow > 0 && (
                <span className="ml-2 text-xs font-medium text-white/80">+{memberOverflow}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="trip-stats">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label={t('budget.total')}
          value={formatMoney(trip.totalBudget, 0, locale)}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('budget.spent')}
          value={formatMoney(trip.spent, 0, locale)}
          extra={t('budget.percentOfBudget', { pct: budgetPct.toFixed(1) })}
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5" />}
          label={t('budget.avgPerDay')}
          value={formatMoney(avgPerDay, 0, locale)}
        />
      </div>

      <div className={`trip-layout${view === 'calendar' ? ' calendar' : ''}`}>
        <div>
          <div className="section-head">
            <div className="tabs">
              {(['itinerary', 'calendar'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`tab${view === v ? ' active' : ''}`}
                >
                  {t(v === 'itinerary' ? 'view.itinerary' : 'view.calendar')}
                </button>
              ))}
            </div>
            <span className="mono">{formatDateRange(trip.startDate, trip.endDate, locale)}</span>
          </div>

          {view === 'calendar' ? (
            <CalendarView
              trip={trip}
              activeDay={activeDay}
              locale={locale}
              onSelectDay={(day) => {
                setActiveDay(day);
                setView('itinerary');
              }}
              onOpenItem={(item) => setEditingItem(item)}
            />
          ) : (
            <>
              <div className="day-tabs">
                {days.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setActiveDay(d)}
                    className={`day-tab${d === activeDay ? ' active' : ''}`}
                  >
                    {t('trip.dayTab', { n: i + 1, date: formatTabDate(d, locale) })}
                  </button>
                ))}
              </div>

              <div className="action-row">
                <SortSelector value={sortMode} onChange={handleSortModeChange} />
                <button
                  type="button"
                  onClick={() => setShowRoute(true)}
                  disabled={routeStops.length === 0}
                  title={routeStops.length === 0 ? t('trip.noRouteTitle') : t('trip.openRouteTitle')}
                  className="btn btn-ghost btn-sm"
                >
                  <Route className="h-4 w-4" /> {t('trip.formRoute')}
                </button>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowSuggestions(true)}
                      className="btn btn-soft btn-sm"
                    >
                      <Sparkles className="h-4 w-4" /> {t('trip.askSuggestions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAdd(true)}
                      className="btn btn-primary btn-sm"
                      style={{ marginLeft: 'auto' }}
                    >
                      <Plus className="h-4 w-4" /> {t('items.addTitle')}
                    </button>
                  </>
                )}
              </div>

              {routeOverflow && (
                <p style={{ marginBottom: 12, fontSize: 12, color: 'var(--warning)' }}>
                  {t('trip.routeOverflow', { n: MAX_ROUTE_STOPS, total: routeStops.length })}
                </p>
              )}

              <div className="plan-card card">
                <div className="plan-title">
                  <h3>{t('trip.planOfDay', { n: activeDay ? days.indexOf(activeDay) + 1 : '' })}</h3>
                  {activeDay && <span>{formatLongDate(activeDay, locale)}</span>}
                </div>

                {itemsForDay.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <div
                      style={{
                        margin: '0 auto',
                        width: 46,
                        height: 46,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 13,
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                      }}
                    >
                      <MapPin className="h-5 w-5" />
                    </div>
                    <p style={{ marginTop: 14, fontWeight: 600, fontSize: 13 }}>{t('trip.empty.title')}</p>
                    <p style={{ marginTop: 3, fontSize: 12, color: 'var(--muted)' }}>
                      {t('trip.empty.subtitle')}
                    </p>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setShowAdd(true)}
                        className="btn btn-primary btn-sm"
                        style={{ marginTop: 16 }}
                      >
                        <Plus className="h-4 w-4" /> {t('trip.empty.cta')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="timeline">
                    {itemsForDay.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={{
                          ...item,
                          isFavorite: favOverrides[item.id] ?? item.isFavorite,
                        }}
                        members={trip.members}
                        canEdit={canEdit}
                        currentUserId={user?.userId ?? null}
                        days={days}
                        editingBy={
                          presence.find(
                            (p) => p.editingItemId === item.id && p.userId !== (user?.userId ?? null)
                          )?.displayName ?? null
                        }
                        onEdit={() => setEditingItem(item)}
                        onView={() => setDetailItem(item)}
                        onMove={(day) => handleMove(item.id, day)}
                        onRemove={() => handleRemove(item.id)}
                        onCostChange={(cost) => handleCostChange(item.id, cost)}
                        onToggleFavorite={() => handleToggleFavorite(item)}
                        onOpenReminder={() => setReminderItem(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {view === 'itinerary' && (
          <div className="side-stack">
            <div className="side-card card">
              <div className="side-head">
                <h3>{t('budget.title')}</h3>
                {canEdit &&
                  (editingBudget ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                        className="input"
                        style={{ width: 96, height: 32, fontSize: 12 }}
                      />
                      <button type="button" onClick={saveBudget} className="btn btn-soft btn-sm">
                        {t('common.ok')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setBudgetDraft(String(trip.totalBudget));
                        setEditingBudget(true);
                      }}
                      className="icon-btn"
                      aria-label={t('budget.adjust')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  ))}
              </div>
              <BudgetBar total={trip.totalBudget} spent={trip.spent} />
              {trip.spentByCategory.length > 0 && (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 15 }}>
                  <p className="mono" style={{ marginBottom: 10 }}>
                    {t('budget.byCategory')}
                  </p>
                  <CategoryBars spentByCategory={trip.spentByCategory} totalBudget={trip.totalBudget} />
                </div>
              )}
            </div>

            <MembersPanel
              trip={trip}
              presence={presence ?? []}
              currentUserId={user?.userId ?? null}
              onInvite={() => setShowInvite(true)}
              onLeft={() => router.push('/')}
            />

            <div className="side-card card ai-card">
              <div className="side-head">
                <h3>{t('suggestions.title')}</h3>
              </div>
              <p>{t('trip.suggestionsSubtitle')}</p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowSuggestions(true)}
                  className="btn btn-primary btn-sm"
                >
                  <Sparkles className="h-4 w-4" /> {t('trip.askSuggestions')}
                </button>
              )}
            </div>
          </div>
        )}
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
          <SuggestionsPanel
            open={showSuggestions}
            trip={trip}
            day={activeDay}
            onClose={() => setShowSuggestions(false)}
          />
        </>
      )}
      <InviteModal open={showInvite} tripId={trip.id} tripName={trip.name} onClose={() => setShowInvite(false)} />
      <RouteModal
        open={showRoute}
        stopCount={routeStops.length}
        onClose={() => setShowRoute(false)}
        onSubmit={(origin) => {
          setShowRoute(false);
          openRoute(origin);
        }}
      />
      <SettingsModal open={showSettings} trip={trip} onClose={() => setShowSettings(false)} />
      <DayTemplateOffer
        open={showTemplateOffer}
        onAccept={() => {
          setShowTemplateOffer(false);
          setShowTemplatePlan(true);
        }}
        onDecline={() => setShowTemplateOffer(false)}
        onClose={() => setShowTemplateOffer(false)}
      />
      <DayPlanModal
        open={showTemplatePlan}
        tripId={trip.id}
        tripName={trip.name}
        day={trip.startDate}
        locale={locale}
        onClose={() => setShowTemplatePlan(false)}
        onAdded={() => setShowTemplatePlan(false)}
      />
      <ItemEditModal
        open={!!editingItem}
        item={editingItem}
        tripId={trip.id}
        onClose={() => setEditingItem(null)}
      />
      <LocationDetailModal
        open={!!detailItem}
        item={detailItem}
        tripId={trip.id}
        members={trip.members}
        canEdit={canEdit}
        onClose={() => setDetailItem(null)}
        onEdit={(it) => setEditingItem(it)}
        onOpenReminder={() => detailItem && setReminderItem(detailItem)}
      />
      <ReminderDialog
        open={!!reminderItem}
        tripId={trip.id}
        item={reminderItem}
        members={trip.members}
        currentUserId={user?.userId ?? null}
        onClose={() => setReminderItem(null)}
        onSaved={() => setReminderItem(null)}
      />
    </AppShell>
  );
}

export default function TripDetailPage() {
  return (
    <RequireAuth>
      <TripDetailContent />
    </RequireAuth>
  );
}
