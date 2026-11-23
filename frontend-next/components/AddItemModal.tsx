'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Clock, Globe, Heart, List, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, mode as apiMode, searchLocations, locationDetails, localizeApiError } from '@/lib/api';
import { CATEGORY_OPTIONS } from '@/lib/categories';
import { formatMoney } from '@/lib/format';
import { formatHours, hoursDayList, socialLinkList } from '@/lib/locationFormat';
import { useI18n } from '@/lib/i18n';
import type { Activity, Location } from '@/lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';
import SmartImage from './SmartImage';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  onToggleFavorite,
}: {
  loc: Location;
  adding: boolean;
  loadingDetails: boolean;
  onAdd: (loc: Location) => void;
  onDetails: (loc: Location) => void;
  onToggleFavorite: (loc: Location) => void;
}) {
  const { t, locale } = useI18n();
  const [hoursOpen, setHoursOpen] = useState(false);
  const hoursLine = formatHours(loc.hours);
  const dayList = hoursDayList(loc.hours);
  const social = socialLinkList(loc.socialLinks);
  const needsDetails = Boolean(loc.placeId) && !loc.hours && !loc.websiteUrl && social.length === 0;
  return (
    <div className="rounded-xl border border-border p-3 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{loc.name}</p>
            {loc.rating != null && (
              <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                ★ {loc.rating}
                {loc.ratingCount != null && <span className="font-normal text-muted-foreground"> ({loc.ratingCount})</span>}
              </span>
            )}
            {loc.priceLevel && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/90">
                {loc.priceLevel}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <CategoryBadge category={loc.category} size="xs" />
            {loc.address && <span className="truncate">{loc.address}</span>}
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {loc.phone && <p>{t('common.phone', { phone: loc.phone })}</p>}
            {dayList && (
              <div className="mt-0.5">
                <button
                  type="button"
                  onClick={() => setHoursOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 -ml-1 text-xs font-medium text-foreground/90 transition duration-150 hover:bg-muted hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  {dayList.find((d) => d.isToday)?.day ?? dayList[0].day}:{' '}
                  {dayList.find((d) => d.isToday)?.time ?? dayList[0].time}
                  <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${hoursOpen ? 'rotate-180' : ''}`} />
                </button>
                {hoursOpen && (
                  <ul className="mt-1.5 space-y-0.5 rounded-lg bg-muted/40 p-2 text-xs text-foreground/90">
                    {dayList.map((d) => (
                      <li
                        key={d.day}
                        className={`flex items-center justify-between gap-4 ${d.isToday ? 'font-semibold text-brand-700' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          {d.day}
                          {d.isToday && (
                            <span className="rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{t('time.today')}</span>
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
                <Globe className="h-3 w-3" /> {t('common.website')}
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
          <button
            type="button"
            onClick={() => onToggleFavorite(loc)}
            className="rounded-lg p-1.5 text-muted-foreground/70 transition duration-150 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
            aria-label={loc.isFavorite ? t('items.removeFavorite') : t('items.addFavorite')}
          >
            <Heart className={`h-4 w-4 ${loc.isFavorite ? 'fill-rose-500 text-rose-500' : ''}`} />
          </button>
          {loc.cost != null && loc.cost > 0 && (
            <span className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(loc.cost, 0, locale)}</span>
          )}
          <button
            type="button"
            onClick={() => onAdd(loc)}
            disabled={adding}
            className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
          >
            {adding ? t('common.ellipsis') : t('common.add')}
          </button>
          {needsDetails && (
            <button
              type="button"
              onClick={() => onDetails(loc)}
              disabled={loadingDetails}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition duration-150 hover:border-brand-200 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {loadingDetails ? t('common.loading') : t('common.details')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AddItemModal({ open, tripId, destinationId, day, onClose }: AddItemModalProps) {
  const { t, locale } = useI18n();
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
  const [locationText, setLocationText] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('catalog');
    setQuery('');
    setCategory('');
    setError(null);
    setSearchResults([]);
    setSearchError(null);
    setLocationText('');
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
    const timer = setTimeout(() => {
      setSearching(true);
      searchLocations(trimmedQuery, destCoords?.lat, destCoords?.lng)
        .then((r) => {
          if (alive) {
            setSearchResults(r);
            setSearchError(null);
          }
        })
        .catch((e: unknown) => {
          if (alive) setSearchError(localizeApiError(e, t));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
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

  // Toggle de favorito: optimista (actualiza el estado local) + mutation.
  const toggleFavorite = async (id: string, current: boolean) => {
    const next = !current;
    setSearchResults((prev) => prev.map((l) => (l.id === id ? { ...l, isFavorite: next } : l)));
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, isFavorite: next } : a)));
    try {
      await api.favoriteLocation(id, next);
    } catch (err) {
      // rollback: el proximo refresh del backend corrige el estado
      setSearchResults((prev) => prev.map((l) => (l.id === id ? { ...l, isFavorite: current } : l)));
      setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, isFavorite: current } : a)));
      toast.error(localizeApiError(err, t));
    }
  };

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
      toast.success(t('items.addedToast'));
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
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
      setError(t('errors.titleRequired'));
      return;
    }
    if (Number.isNaN(parsedCost) || parsedCost < 0) {
      setError(t('errors.invalidCost'));
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
        locationText: locationText.trim() || null,
      });
      toast.success(t('items.addedToast'));
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('items.addTitle')} size="lg">
      <div className="mb-4 flex rounded-xl border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => setMode('catalog')}
          aria-pressed={mode === 'catalog'}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            mode === 'catalog'
              ? 'bg-brand-600 font-semibold text-white shadow-md'
              : 'text-foreground/60 hover:bg-card/70 hover:text-foreground'
          }`}
        >
          <List className="h-4 w-4" /> {t('items.catalog')}
          {mode === 'catalog' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          aria-pressed={mode === 'manual'}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
            mode === 'manual'
              ? 'bg-brand-600 font-semibold text-white shadow-md'
              : 'text-foreground/60 hover:bg-card/70 hover:text-foreground'
          }`}
        >
          <Plus className="h-4 w-4" /> {t('items.manual')}
          {mode === 'manual' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
      </div>

      {mode === 'catalog' ? (
        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isLocal ? t('items.searchPlacesPlaceholder') : t('items.searchPlaceholder')}
                className="w-full rounded-xl border border-input py-2 pl-9 pr-3 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <Select value={category || 'all'} onValueChange={(v) => setCategory(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-auto rounded-xl px-3 py-2 text-sm sm:w-auto" aria-label={t('common.category')}>
                <SelectValue placeholder={t('items.allCategories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('items.allCategories')}</SelectItem>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {t(c.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {busy ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                  <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-8 w-16 shrink-0 rounded-lg" />
                </div>
              ))}
            </div>
          ) : isSearchingLocal && searchError ? (
            <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-400">{searchError}</p>
          ) : displayList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Search className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">
                {isSearchingLocal ? t('items.noResults') : t('items.noMatches')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isSearchingLocal
                  ? t('items.noPlacesFor', { q: trimmedQuery })
                  : t('items.tryOther')}
              </p>
            </div>
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
                      onToggleFavorite={(l) => toggleFavorite(l.id, Boolean(l.isFavorite))}
                    />
                  ))
                : displayList.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10">
                      <SmartImage src={a.imageUrl} alt={a.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" iconClassName="h-5 w-5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                          {a.rating && <span className="shrink-0 text-xs text-amber-500 dark:text-amber-400">★ {a.rating}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <CategoryBadge category={a.category} size="xs" />
                          {a.durationHours && <span>{t('items.durationHours', { n: a.durationHours })}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(a.id, Boolean(a.isFavorite))}
                          className="rounded-lg p-1 text-muted-foreground/70 transition duration-150 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                          aria-label={a.isFavorite ? t('items.removeFavorite') : t('items.addFavorite')}
                        >
                          <Heart className={`h-4 w-4 ${a.isFavorite ? 'fill-rose-500 text-rose-500' : ''}`} />
                        </button>
                        <span className="text-sm font-semibold tabular-nums text-foreground">{a.cost > 0 ? formatMoney(a.cost, 0, locale) : t('common.free')}</span>
                        <button
                          type="button"
                          onClick={() => addFromCatalog(a)}
                          disabled={addingId === a.id}
                          className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
                        >
                          {addingId === a.id ? t('common.ellipsis') : t('common.add')}
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
            <label htmlFor="manual-title" className="mb-1 block text-sm font-medium text-foreground">
              {t('items.title')}
            </label>
            <input
              id="manual-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('items.titlePlaceholder')}
              className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-category" className="mb-1 block text-sm font-medium text-foreground">
                {t('common.category')}
              </label>
              <Select value={manualCategory} onValueChange={setManualCategory}>
                <SelectTrigger id="manual-category" className="h-auto w-full rounded-xl px-3 py-2.5 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {t(c.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="manual-cost" className="mb-1 block text-sm font-medium text-foreground">
                {t('items.costUsd')}
              </label>
              <input
                id="manual-cost"
                type="number"
                min={0}
                step="0.5"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <div>
            <label htmlFor="manual-time" className="mb-1 block text-sm font-medium text-foreground">
              {t('items.timeOptional')}
            </label>
            <input
              id="manual-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label htmlFor="manual-location" className="mb-1 block text-sm font-medium text-foreground">
              {t('items.locationLabel')}
            </label>
            <input
              id="manual-location"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder={t('items.locationPlaceholder')}
              maxLength={200}
              className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 max-sm:min-h-11"
            >
              {t('items.addToDay')}
            </button>
          </div>
        </form>
      )}
      {mode === 'catalog' && error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </Modal>
  );
}
