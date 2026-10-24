'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n';
import type { Trip, TripItem } from '@/lib/types';
import { categoryMeta } from '@/lib/categories';
import { parseDate } from '@/lib/format';
import {
  dayKey,
  monthLabel,
  monthMatrix,
  sortDayItems,
  weekStartsOn,
  weekdayLabels,
} from '@/lib/calendar';

interface CalendarViewProps {
  trip: Trip;
  activeDay: string | null;
  onSelectDay: (day: string) => void;
  onOpenItem: (item: TripItem) => void;
  locale: Locale;
}

// ¿El mes destino (cursor + delta) solapa con el rango del viaje? Se comparan
// claves 'yyyy-mm-dd' (comparables lexicográficamente) para deshabilitar la
// navegación hacia meses sin ningún día del viaje.
function monthHasTripDay(cursor: Date, delta: number, startKey: string, endKey: string): boolean {
  const target = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  const first = dayKey(new Date(target.getFullYear(), target.getMonth(), 1));
  const last = dayKey(new Date(target.getFullYear(), target.getMonth() + 1, 0));
  return first <= endKey && last >= startKey;
}

export default function CalendarView({
  trip,
  activeDay,
  onSelectDay,
  onOpenItem,
  locale,
}: CalendarViewProps) {
  const { t } = useI18n();
  const canEdit = trip.myRole !== 'viewer';

  const startKey = trip.startDate;
  const endKey = trip.endDate;

  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const start = parseDate(trip.startDate);
    return new Date(start.getFullYear(), start.getMonth(), 1);
  });

  const weekStart = weekStartsOn(locale);
  const matrix = useMemo(
    () => monthMatrix(monthCursor.getFullYear(), monthCursor.getMonth(), weekStart),
    [monthCursor, weekStart]
  );
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const todayKey = dayKey(new Date());

  // Items agrupados por día y ordenados cronológicamente (una sola pasada).
  const itemsByDay = useMemo(() => {
    const map = new Map<string, TripItem[]>();
    for (const item of trip.items) {
      const list = map.get(item.day);
      if (list) list.push(item);
      else map.set(item.day, [item]);
    }
    for (const [key, list] of map) map.set(key, sortDayItems(list));
    return map;
  }, [trip.items]);

  const canGoPrev = monthHasTripDay(monthCursor, -1, startKey, endKey);
  const canGoNext = monthHasTripDay(monthCursor, 1, startKey, endKey);

  const shiftMonth = (delta: number) =>
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  return (
    <section className="min-w-0 rounded-[16px] border border-border bg-card p-3 shadow-card sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoPrev}
          aria-label={t('calendar.prevMonth')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold capitalize tracking-[-0.01em] text-foreground">
          {monthLabel(monthCursor, locale)}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!canGoNext}
          aria-label={t('calendar.nextMonth')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((label, i) => (
          <span
            key={`w-${i}`}
            className="pb-1 text-center text-[10px] font-medium uppercase text-muted-foreground sm:text-xs"
          >
            {label}
          </span>
        ))}

        {matrix.map((week, wi) => (
          <div key={`week-${wi}`} className="contents">
            {week.map((date) => {
              const key = dayKey(date);
              const inRange = key >= startKey && key <= endKey;
              const isActive = inRange && key === activeDay;
              const isToday = inRange && key === todayKey;
              const items = inRange ? itemsByDay.get(key) ?? [] : [];

              return (
                <div
                  key={key}
                  className={`flex min-h-16 min-w-0 flex-col overflow-hidden rounded-lg border p-1 sm:min-h-24 sm:p-1.5 ${
                    inRange ? 'border-border bg-card' : 'border-transparent'
                  } ${isActive ? 'ring-2 ring-brand-500' : ''}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => onSelectDay(key)}
                      disabled={!inRange}
                      aria-pressed={isActive}
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] tabular-nums transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-xs ${
                        inRange
                          ? 'font-medium text-foreground hover:bg-muted'
                          : 'cursor-default text-muted-foreground/40'
                      } ${isActive ? 'text-brand-700 dark:text-brand-300' : ''}`}
                    >
                      {date.getDate()}
                    </button>
                    {isToday && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                  </div>

                  {inRange && items.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {items.slice(0, 3).map((item, idx) => {
                        const meta = categoryMeta(item.category);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => (canEdit ? onOpenItem(item) : onSelectDay(key))}
                            title={item.title}
                            className={`w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left transition duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                              idx === 0 ? 'flex' : 'hidden sm:flex'
                            }`}
                          >
                            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                            {item.startTime && (
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                {item.startTime}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                              {item.title}
                            </span>
                          </button>
                        );
                      })}

                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onSelectDay(key)}
                          className="block w-full rounded px-1 text-left text-[10px] font-medium text-muted-foreground transition duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:hidden"
                        >
                          {t('calendar.more', { n: items.length - 1 })}
                        </button>
                      )}
                      {items.length > 3 && (
                        <button
                          type="button"
                          onClick={() => onSelectDay(key)}
                          className="hidden w-full rounded px-1 text-left text-[10px] font-medium text-muted-foreground transition duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:block"
                        >
                          {t('calendar.more', { n: items.length - 3 })}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
