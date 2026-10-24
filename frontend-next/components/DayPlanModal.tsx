'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useI18n, type Locale } from '@/lib/i18n';
import { normalizeCategory, requestDayPlan, type DayPlanItem } from '@/lib/template';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';

interface DayPlanModalProps {
  open: boolean;
  tripId: string;
  tripName: string;
  day: string;
  locale: Locale;
  onClose: () => void;
  onAdded: () => void;
}

// Muestra el día plantilla que propone el agente y, al confirmar, lo vuelca al
// itinerario como items del día 1 (una addItem por parada, en su orden).
export default function DayPlanModal({
  open,
  tripId,
  tripName,
  day,
  locale,
  onClose,
  onAdded,
}: DayPlanModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [plan, setPlan] = useState<DayPlanItem[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setPlan([]);
    requestDayPlan(tripId, locale)
      .then((data) => {
        if (alive) setPlan(data.plan);
      })
      .catch((err) => {
        if (!alive) return;
        toast.error(localizeApiError(err, t));
        onClose();
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tripId, locale]);

  const total = plan.reduce((sum, item) => sum + (item.cost ?? 0), 0);

  const handleAdd = async () => {
    if (plan.length === 0) return;
    setAdding(true);
    const results = await Promise.allSettled(
      plan.map((item, order) =>
        api.addItem(tripId, {
          title: item.title,
          category: normalizeCategory(item.category),
          cost: item.cost ?? 0,
          day,
          order,
          startTime: item.startTime,
          activityId: item.placeId || null,
          notes: null,
          imageUrl: null,
        })
      )
    );
    setAdding(false);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;

    if (failed === 0) {
      toast.success(t('template.addedToast'));
      onAdded();
      return;
    }
    if (ok > 0) {
      toast.error(t('template.addedPartial', { ok, total: results.length }));
      onAdded();
      return;
    }
    const firstError = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)
      ?.reason;
    toast.error(localizeApiError(firstError, t));
  };

  const busy = loading || adding;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('template.planTitle', { name: tripName })}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {t('template.reject')}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || plan.length === 0}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
          >
            {adding ? t('common.saving') : t('template.addToDay1')}
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : plan.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('template.error')}</p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border">
            {plan.map((item, i) => (
              <li key={`${item.placeId}-${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-12 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                  {item.startTime || '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <div className="mt-1">
                    <CategoryBadge category={normalizeCategory(item.category)} size="xs" />
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-sm font-semibold text-foreground">
                  {!item.cost ? t('common.free') : formatMoney(item.cost, 0, locale)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold text-foreground">{t('template.total')}</span>
            <span className="text-sm font-bold text-foreground">{formatMoney(total, 0, locale)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
