import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock, Globe, List, Plus, Search } from 'lucide-react';
import { api, mode as apiMode, searchLocations, locationDetails } from '../lib/api';
import { CATEGORY_OPTIONS } from '../lib/categories';
import { formatMoney } from '../lib/format';
import { formatHours, hoursDayList, socialLinkList } from '../lib/locationFormat';
import type { Activity, Location } from '../lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';
import SmartImage from './SmartImage';

interface AddItemModalProps {
  open: boolean;
  tripId: string;
  destinationId: string;
  day: string;
  onClose: () => void;
}

type Mode = 'catalog' | 'manual';

function locationToActivity(loc: Location): Activity {
  return {
    id: loc.id,
    name: loc.name,
    category: loc.category,
    cost: loc.cost ?? 0,
    lat: loc.lat,
    lng: loc.lng,
    description: loc.description ?? '',
    tags: loc.tags ?? [],
    durationHours: loc.durationHours ?? null,
    imageUrl: loc.imageUrl ?? null,
    rating: loc.rating ?? null,
  };
}

function LocationResultCard({
  loc,
  adding,
  loadingDetails,
  onAdd,
  onDetails,
}: {
  loc: Location;
  adding: boolean;
  loadingDetails: boolean;
  onAdd: (loc: Location) => void;
  onDetails: (loc: Location) => void;
}) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const hoursLine = formatHours(loc.hours);
  const dayList = hoursDayList(loc.hours);
  const social = socialLinkList(loc.socialLinks);
  const needsDetails = Boolean(loc.placeId) && !loc.hours && !loc.websiteUrl && social.length === 0;
  return (
    <div className="rounded-xl border border-slate-200 p-3 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-800">{loc.name}</p>
            {loc.rating != null && (
              <span className="shrink-0 text-xs font-medium text-amber-600">
                ★ {loc.rating}
                {loc.ratingCount != null && <span className="font-normal text-slate-400"> ({loc.ratingCount})</span>}
              </span>
            )}
            {loc.priceLevel && (
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                {loc.priceLevel}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <CategoryBadge category={loc.category} size="xs" />
            {loc.address && <span className="truncate">{loc.address}</span>}
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
            {loc.phone && <p>Tel: {loc.phone}</p>}
            {dayList && (
              <div className="mt-0.5">
                <button
                  type="button"
                  onClick={() => setHoursOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 -ml-1 text-xs font-medium text-slate-600 transition duration-150 hover:bg-slate-100 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  {dayList.find((d) => d.isToday)?.day ?? dayList[0].day}:{' '}
                  {dayList.find((d) => d.isToday)?.time ?? dayList[0].time}
                  <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${hoursOpen ? 'rotate-180' : ''}`} />
                </button>
                {hoursOpen && (
                  <ul className="mt-1.5 space-y-0.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    {dayList.map((d) => (
                      <li
                        key={d.day}
                        className={`flex items-center justify-between gap-4 ${d.isToday ? 'font-semibold text-brand-700' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          {d.day}
                          {d.isToday && (
                            <span className="rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-700">Hoy</span>
                          )}
                        </span>
                        <span className="tabular-nums">{d.time}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!dayList && hoursLine && (
              <p className="flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" /> {hoursLine}
              </p>
            )}
            {loc.websiteUrl && (
              <a
                href={loc.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
              >
                <Globe className="h-3 w-3" /> Sitio web
              </a>
            )}
            {social.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {social.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {s.title}
                  </a>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {loc.cost != null && loc.cost > 0 && (
            <span className="text-sm font-semibold tabular-nums text-slate-800">{formatMoney(loc.cost, 0)}</span>
          )}
          <button
            type="button"
            onClick={() => onAdd(loc)}
            disabled={adding}
            className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {adding ? '…' : 'Añadir'}
          </button>
          {needsDetails && (
            <button
              type="button"
              onClick={() => onDetails(loc)}
              disabled={loadingDetails}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition duration-150 hover:border-brand-200 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {loadingDetails ? 'Cargando…' : 'Detalles'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AddItemModal({ open, tripId, destinationId, day, onClose }: AddItemModalProps) {
  const isLocal = apiMode === 'local';

  const [mode, setMode] = useState<Mode>('catalog');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);

  // manual form
  const [title, setTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('sight');
  const [cost, setCost] = useState('0');
  const [startTime, setStartTime] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('catalog');
    setQuery('');
    setCategory('');
    setError(null);
    setSearchResults([]);
    setSearchError(null);
    setLoading(true);
    api.listActivities(destinationId).then((list) => {
      setActivities(list);
      setLoading(false);
    });
    // Coordenadas del destino: la busqueda local se limita a su area
    // (pais/ciudad del viaje) y HasData recibe ll=@lat,lng.
    api.listDestinations().then((dests) => {
      const d = dests.find((x) => x.slug === destinationId);
      if (d) setDestCoords({ lat: d.lat, lng: d.lng });
    });
  }, [open, destinationId]);

  const trimmedQuery = query.trim();

  // En modo local, la caja de búsqueda consulta searchLocations (FTS5 + HasData)
  // en vez de filtrar el top 10 local.
  useEffect(() => {
    if (!open || !isLocal) return;
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setSearching(true);
      searchLocations(trimmedQuery, destCoords?.lat, destCoords?.lng)
        .then((r) => {
          if (alive) {
            setSearchResults(r);
            setSearchError(null);
          }
        })
        .catch((e: unknown) => {
          if (alive) setSearchError(e instanceof Error ? e.message : 'No se pudo buscar.');
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trimmedQuery, open, isLocal, destCoords?.lat, destCoords?.lng]);

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      const matchesCategory = !category || a.category === category;
      const q = trimmedQuery.toLowerCase();
      const matchesQuery = !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [activities, trimmedQuery, category]);

  const isSearchingLocal = isLocal && trimmedQuery.length > 0;
  const displayList: Activity[] = isSearchingLocal ? searchResults.map(locationToActivity) : filtered;
  const busy = loading || (isSearchingLocal && searching);

  const addFromCatalog = async (a: Activity) => {
    setAddingId(a.id);
    setError(null);
    try {
      await api.addItem(tripId, {
        day,
        order: -1,
        activityId: a.id,
        title: a.name,
        category: a.category,
        cost: a.cost,
        startTime: null,
        notes: null,
        imageUrl: a.imageUrl,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir.');
    } finally {
      setAddingId(null);
    }
  };

  const loadDetails = async (loc: Location) => {
    if (!loc.placeId) return;
    setDetailsLoading(loc.placeId);
    try {
      const detail = await locationDetails(loc.placeId);
      if (detail) {
        setSearchResults((prev) => prev.map((r) => (r.placeId === loc.placeId ? { ...r, ...detail } : r)));
      }
    } catch {
      // el detalle bajo demanda es opcional; si falla, la tarjeta sigue funcional
    } finally {
      setDetailsLoading(null);
    }
  };

  const addManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedCost = Number(cost);
    if (!title.trim()) {
      setError('Escribe un título.');
      return;
    }
    if (Number.isNaN(parsedCost) || parsedCost < 0) {
      setError('El costo debe ser un número válido.');
      return;
    }
    try {
      await api.addItem(tripId, {
        day,
        order: -1,
        activityId: null,
        title: title.trim(),
        category: manualCategory,
        cost: parsedCost,
        startTime: startTime || null,
        notes: null,
        imageUrl: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Añadir actividad" size="lg">
      <div className="mb-4 flex rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode('catalog')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            mode === 'catalog' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <List className="h-4 w-4" /> Catálogo
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            mode === 'manual' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Plus className="h-4 w-4" /> Manual
        </button>
      </div>

      {mode === 'catalog' ? (
        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isLocal ? 'Buscar lugares (p. ej. pizza)…' : 'Buscar por nombre o etiqueta…'}
                className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Todas las categorías</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {busy ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : isSearchingLocal && searchError ? (
            <p className="py-8 text-center text-sm text-rose-600">{searchError}</p>
          ) : displayList.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              {isSearchingLocal
                ? `No encontramos lugares para “${trimmedQuery}”.`
                : 'No hay actividades que coincidan.'}
            </p>
          ) : (
            <div className="scrollbar-thin max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {isSearchingLocal
                ? searchResults.map((loc) => (
                    <LocationResultCard
                      key={loc.id}
                      loc={loc}
                      adding={addingId === loc.id}
                      loadingDetails={detailsLoading === loc.placeId}
                      onAdd={(l) => addFromCatalog(locationToActivity(l))}
                      onDetails={loadDetails}
                    />
                  ))
                : displayList.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40">
                      <SmartImage src={a.imageUrl} alt={a.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" iconClassName="h-5 w-5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-800">{a.name}</p>
                          {a.rating && <span className="shrink-0 text-xs text-amber-500">★ {a.rating}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <CategoryBadge category={a.category} size="xs" />
                          {a.durationHours && <span>{a.durationHours} h</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums text-slate-800">{a.cost > 0 ? formatMoney(a.cost, 0) : 'Gratis'}</span>
                        <button
                          type="button"
                          onClick={() => addFromCatalog(a)}
                          disabled={addingId === a.id}
                          className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60"
                        >
                          {addingId === a.id ? '…' : 'Añadir'}
                        </button>
                      </div>
                    </div>
                  ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={addManual} className="space-y-4">
          <div>
            <label htmlFor="manual-title" className="mb-1 block text-sm font-medium text-slate-700">
              Título
            </label>
            <input
              id="manual-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Alquilar bicicletas"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="manual-category" className="mb-1 block text-sm font-medium text-slate-700">
                Categoría
              </label>
              <select
                id="manual-category"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="manual-cost" className="mb-1 block text-sm font-medium text-slate-700">
                Costo (USD)
              </label>
              <input
                id="manual-cost"
                type="number"
                min={0}
                step="0.5"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
          <div>
            <label htmlFor="manual-time" className="mb-1 block text-sm font-medium text-slate-700">
              Hora (opcional)
            </label>
            <input
              id="manual-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition duration-150 hover:bg-slate-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Añadir al día
            </button>
          </div>
        </form>
      )}
      {mode === 'catalog' && error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Modal>
  );
}
