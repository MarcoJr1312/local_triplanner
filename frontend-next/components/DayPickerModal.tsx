'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { listDays, parseDate } from '@/lib/format';
import type { AWSDate } from '@/lib/types';
import Modal from './Modal';

interface DayPickerModalProps {
  open: boolean;
  title: string;
  startDate: AWSDate;
  endDate: AWSDate;
  onClose: () => void;
  onConfirm: (day: string) => void;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// Selector de día del viaje: genera todas las fechas de startDate a endDate y
// deja elegir una sola (botones radio-like). Confirmar queda deshabilitado
// hasta que haya selección.
export default function DayPickerModal({
  open,
  title,
  startDate,
  endDate,
  onClose,
  onConfirm,
}: DayPickerModalProps) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => listDays(startDate, endDate), [startDate, endDate]);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const dateLocale = locale === 'en' ? 'en-US' : 'es';
  const dayLabel = (day: AWSDate) =>
    capitalize(
      parseDate(day).toLocaleDateString(dateLocale, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      })
    );

  return (
    <Modal open={open} onClose={onClose} title={t('suggestions.pickDay')} size="sm">
      <p className="mb-3 truncate text-sm font-medium text-foreground">{title}</p>
      <div className="scrollbar-thin max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
        {days.map((d, i) => {
          const isSelected = selected === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(d)}
              aria-pressed={isSelected}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition duration-150 max-sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
                isSelected
                  ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-border bg-card text-foreground hover:border-brand-200'
              }`}
            >
              <span>{dayLabel(d)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t('days.tab', { n: i + 1 })}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
        >
          {t('common.add')}
        </button>
      </div>
    </Modal>
  );
}
