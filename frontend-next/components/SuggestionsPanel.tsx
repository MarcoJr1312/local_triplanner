'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Plus, Send, Sparkles } from 'lucide-react';
import { ApiError, api, localizeApiError } from '@/lib/api';
import { formatDateShort, formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { AutoSuggestItem, Suggestion, Trip } from '@/lib/types';
import {
  extractSuggestions,
  getSuggestionChats,
  postSuggestion,
  stripSuggestionsBlock,
  type SuggestionItem,
} from '@/lib/suggestions';
import { toast } from 'sonner';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';
import DayPickerModal from './DayPickerModal';
import InterestsPicker from './InterestsPicker';

interface SuggestionsPanelProps {
  open: boolean;
  trip: Trip;
  day: string;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Categorías que el itinerario/badges conocen; cualquier otra cae a 'activity'.
const KNOWN_CATEGORIES = new Set([
  'sight',
  'food',
  'activity',
  'nightlife',
  'transporte',
  'alojamiento',
]);

function normalizeCategory(category: string): string {
  return KNOWN_CATEGORIES.has(category) ? category : 'activity';
}

export default function SuggestionsPanel({ open, trip, day, onClose }: SuggestionsPanelProps) {
  const { t, locale } = useI18n();
  const tripId = trip.id;
  const canAdd = trip.myRole !== 'viewer';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fallback, setFallback] = useState<Suggestion[] | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  // Sugerencia elegida a la espera de que el usuario elija el día destino.
  const [picking, setPicking] = useState<{ title: string; item: SuggestionItem } | null>(null);
  // Sugerencias automáticas (endpoint determinista del agente).
  const [autoItems, setAutoItems] = useState<AutoSuggestItem[]>([]);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoMoreLoading, setAutoMoreLoading] = useState(false);
  const [autoHasMore, setAutoHasMore] = useState(false);
  const [autoOffset, setAutoOffset] = useState(0);
  const [autoNoInterests, setAutoNoInterests] = useState(false);
  const [showInterests, setShowInterests] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessages([]);
    setFallback(null);
    setAdded({});
    setInput('');
    setThinking(false);
    setLoading(true);
    setAutoItems([]);
    setAutoLoading(false);
    setAutoMoreLoading(false);
    setAutoHasMore(false);
    setAutoOffset(0);
    setAutoNoInterests(false);
    setShowInterests(false);
    getSuggestionChats(tripId, day)
      .then((chats) => {
        if (cancelled) return;
        const flat = chats.flatMap((c) => c.messages);
        setMessages(
          flat.map((m, i) => ({
            id: `${i}-${m.role}`,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          }))
        );
      })
      .catch(() => {
        // Si el historial falla, el chat queda vacío y el usuario puede escribir.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tripId, day]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, fallback, loading, open, autoItems, autoLoading, autoNoInterests]);

  const handleAdd = async (s: Suggestion, idx: number) => {
    const key = `${idx}-${s.title}`;
    try {
      await api.addItem(tripId, {
        day,
        order: -1,
        activityId: s.activityId,
        title: s.title,
        category: s.category,
        cost: s.cost,
        startTime: null,
        notes: null,
        imageUrl: null,
      });
      setAdded((prev) => ({ ...prev, [key]: true }));
    } catch (e) {
      toast.error(localizeApiError(e, t));
    }
  };

  // Al elegir día en el DayPicker: añade la sugerencia al final del día
  // (order: -1, igual que AddItemModal) y la marca como añadida. El itinerario
  // se refresca solo por tiempo real, sin refetch manual.
  const handleConfirmAdd = async (selectedDay: string) => {
    const item = picking?.item;
    setPicking(null);
    if (!item) return;
    try {
      await api.addItem(tripId, {
        day: selectedDay,
        order: -1,
        activityId: item.placeId || null,
        title: item.title,
        category: normalizeCategory(item.category),
        cost: item.cost ?? 0,
        startTime: null,
        notes: null,
        imageUrl: null,
      });
      setAdded((prev) => ({ ...prev, [item.placeId]: true }));
      toast.success(t('suggestions.addedToast', { day: formatDateShort(selectedDay, locale) }));
    } catch (e) {
      toast.error(localizeApiError(e, t));
    }
  };

  // Sugerencias automáticas: primera página (10) y luego +5 sin duplicar
  // placeIds. El backend devuelve el offset usado; el siguiente página arranca
  // justo donde terminó.
  const loadAutoSuggest = async (offset: number, limit: number, append: boolean) => {
    if (append) {
      setAutoMoreLoading(true);
    } else {
      setAutoLoading(true);
      setAutoItems([]);
      setAutoHasMore(false);
    }
    try {
      const result = await api.autoSuggest(tripId, offset, limit);
      setAutoNoInterests(false);
      setAutoItems((prev) => {
        if (!append) return result.items;
        const seen = new Set(prev.map((item) => item.placeId));
        return [...prev, ...result.items.filter((item) => !seen.has(item.placeId))];
      });
      setAutoHasMore(result.hasMore);
      setAutoOffset(result.offset + limit);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_INTERESTS') {
        setAutoItems([]);
        setAutoHasMore(false);
        setAutoNoInterests(true);
      } else {
        toast.error(localizeApiError(err, t));
      }
    } finally {
      if (append) setAutoMoreLoading(false);
      else setAutoLoading(false);
    }
  };

  const handleAutoSuggest = () => {
    void loadAutoSuggest(0, 10, false);
  };

  const handleAutoMore = () => {
    void loadAutoSuggest(autoOffset, 5, true);
  };

  const handleSaveInterests = async (terms: string[]) => {
    await api.setMyInterests(terms);
    setShowInterests(false);
    await loadAutoSuggest(0, 10, false);
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;

    setInput('');
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setFallback(null);
    setThinking(true);

    const payload = nextMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const { answer } = await postSuggestion(tripId, day, payload, locale);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: answer }]);
      try {
        const chats = await getSuggestionChats(tripId, day);
        const flat = chats.flatMap((c) => c.messages);
        setMessages(
          flat.map((m, i) => ({
            id: `${Date.now()}-${i}`,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          }))
        );
      } catch {
        // Mantener la respuesta optimista si la re-lectura falla.
      }
    } catch (err) {
      toast.error(localizeApiError(err, t));
      let suggestions: Suggestion[] | null = null;
      try {
        const res = await api.requestSuggestions(tripId, day);
        suggestions = res.items;
      } catch {
        suggestions = null;
      }
      if (suggestions && suggestions.length > 0) {
        setFallback(suggestions);
        setAdded({});
      } else {
        const code = err instanceof ApiError ? err.code : undefined;
        const bubble =
          code === 'AGENT_TIMEOUT' ? t('suggestions.errorTimeout') : t('suggestions.errorAgent');
        setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: bubble }]);
      }
    } finally {
      setThinking(false);
    }
  };

  const isEmpty =
    !loading &&
    !thinking &&
    messages.length === 0 &&
    !fallback &&
    autoItems.length === 0 &&
    !autoLoading &&
    !autoNoInterests;

  return (
    <Modal open={open} onClose={onClose} title={t('suggestions.title')} size="md">
      <div className="flex h-[60dvh] min-h-[300px] max-h-[560px] flex-col">
        <div className="mb-2 flex items-center justify-end">
          <button
            type="button"
            onClick={handleAutoSuggest}
            disabled={autoLoading || autoMoreLoading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-xs font-semibold text-foreground transition duration-150 hover:bg-muted/40 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {autoLoading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t('interests.autoSuggest')}
          </button>
        </div>
        <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-6 w-6" />
              </span>
              <p className="max-w-[260px] text-sm text-muted-foreground">{t('suggestions.chatEmpty')}</p>
            </div>
          ) : (
            <>
              {messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm text-white">
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                    </div>
                  );
                }
                // El texto natural va sin el bloque de sugerencias; las tarjetas
                // accionables se derivan del mismo bloque (nuevas y del historial).
                const text = stripSuggestionsBlock(m.content);
                const items = extractSuggestions(m.content);
                return (
                  <div key={m.id} className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground shadow-card">
                      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
                      {items.length > 0 && (
                        <div className={`space-y-2 ${text ? 'mt-2' : ''}`}>
                          {items.map((item) => {
                            const isAdded = Boolean(added[item.placeId]);
                            return (
                              <div
                                key={item.placeId}
                                className="rounded-xl border border-border p-3 transition duration-150 hover:border-brand-200"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                                    <div className="mt-1 flex items-center gap-2">
                                      <CategoryBadge category={item.category} size="xs" />
                                      <span className="text-sm font-medium tabular-nums text-foreground">
                                        {item.cost > 0 ? formatMoney(item.cost, 0, locale) : t('common.free')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                {canAdd && (
                                  <button
                                    type="button"
                                    onClick={() => setPicking({ title: item.title, item })}
                                    disabled={isAdded}
                                    className={`mt-3 flex w-full min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
                                      isAdded
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                        : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]'
                                    }`}
                                  >
                                    {isAdded ? (
                                      <span className="flex items-center gap-1.5">
                                        <Check className="h-4 w-4 shrink-0" /> {t('suggestions.alreadyAdded')}
                                      </span>
                                    ) : (
                                      <>
                                        <Plus className="h-4 w-4 shrink-0" /> {t('suggestions.addToDay')}
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {thinking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-card">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t('suggestions.thinking')}
                  </div>
                </div>
              )}

              {fallback && fallback.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-3 text-sm text-foreground shadow-card">
                    <p className="text-xs italic text-muted-foreground">{t('suggestions.fallbackNote')}</p>
                    <div className="mt-2 space-y-2">
                      {fallback.map((s, idx) => {
                        const key = `${idx}-${s.title}`;
                        const isAdded = added[key];
                        return (
                          <div
                            key={key}
                            className="rounded-xl border border-border p-3 transition duration-150 hover:border-brand-200"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">{s.title}</p>
                              <div className="mt-1 flex items-center gap-2">
                                <CategoryBadge category={s.category} size="xs" />
                                <span className="text-sm font-medium tabular-nums text-foreground">
                                  {s.cost > 0 ? formatMoney(s.cost, 0, locale) : t('common.free')}
                                </span>
                              </div>
                            </div>
                          <button
                            type="button"
                            onClick={() => handleAdd(s, idx)}
                            disabled={isAdded}
                            className={`mt-3 flex w-full min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
                              isAdded
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]'
                            }`}
                          >
                            {isAdded ? (
                              <span className="flex items-center gap-1.5">
                                <Check className="h-4 w-4 shrink-0" /> {t('suggestions.alreadyAdded')}
                              </span>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 shrink-0" /> {t('suggestions.add')}
                              </>
                            )}
                          </button>
                          <p className="mt-2 text-xs italic text-muted-foreground">“{s.rationale}”</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {(autoLoading || autoNoInterests || autoItems.length > 0) && (
                <div className="space-y-2">
                  {autoLoading && (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-4 text-sm text-muted-foreground shadow-card">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {t('common.loading')}
                    </div>
                  )}

                  {autoNoInterests && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/25 dark:bg-amber-500/10">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        {t('interests.noInterests')}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowInterests(true)}
                        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
                      >
                        <Sparkles className="h-4 w-4 shrink-0" />
                        {t('interests.openPicker')}
                      </button>
                    </div>
                  )}

                  {autoItems.map((item) => {
                    const isAdded = Boolean(added[item.placeId]);
                    const suggestion: SuggestionItem = {
                      placeId: item.placeId,
                      title: item.title,
                      category: item.category,
                      cost: item.cost ?? 0,
                    };
                    return (
                      <div
                        key={item.placeId}
                        className="rounded-xl border border-border bg-card p-3 shadow-card transition duration-150 hover:border-brand-200"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{item.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <CategoryBadge category={item.category} size="xs" />
                              <span className="text-sm font-medium tabular-nums text-foreground">
                                {item.cost && item.cost > 0
                                  ? formatMoney(item.cost, 0, locale)
                                  : t('common.free')}
                              </span>
                              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                                {t('interests.compatibility', { n: item.score })}
                              </span>
                            </div>
                          </div>
                        </div>
                        {canAdd && (
                          <button
                            type="button"
                            onClick={() => setPicking({ title: item.title, item: suggestion })}
                            disabled={isAdded}
                            className={`mt-3 flex w-full min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
                              isAdded
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]'
                            }`}
                          >
                            {isAdded ? (
                              <span className="flex items-center gap-1.5">
                                <Check className="h-4 w-4 shrink-0" /> {t('suggestions.alreadyAdded')}
                              </span>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 shrink-0" /> {t('suggestions.addToDay')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {autoHasMore && autoItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoMore}
                      disabled={autoMoreLoading}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-input px-4 py-2.5 text-sm font-medium text-foreground transition duration-150 hover:bg-muted/40 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      {autoMoreLoading ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {t('interests.more5')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <form onSubmit={handleSend} className="mt-3 flex items-end gap-2 border-t border-border pt-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            rows={1}
            placeholder={t('suggestions.chatInput')}
            className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition duration-150 placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label={t('suggestions.send')}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      <DayPickerModal
        open={!!picking}
        title={picking?.title ?? ''}
        startDate={trip.startDate}
        endDate={trip.endDate}
        onClose={() => setPicking(null)}
        onConfirm={handleConfirmAdd}
      />

      <Modal
        open={showInterests}
        onClose={() => setShowInterests(false)}
        title={t('interests.title')}
        size="md"
      >
        <InterestsPicker
          initial={[]}
          onSave={handleSaveInterests}
          subtitle={t('interests.subtitle')}
        />
      </Modal>
    </Modal>
  );
}
