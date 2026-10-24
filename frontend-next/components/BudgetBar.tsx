'use client';

import { formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface BudgetBarProps {
  total: number;
  spent: number;
}

export default function BudgetBar({ total, spent }: BudgetBarProps) {
  const { t, locale } = useI18n();
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const over = spent > total;
  const remaining = total - spent;

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{formatMoney(spent, 0, locale)}</span>
          <span className="ml-2 text-sm text-muted-foreground">{t('budget.ofTotal', { amount: formatMoney(total, 0, locale) })}</span>
        </div>
        <div className="text-right text-sm">
          {over ? (
            <span className="font-semibold text-rose-600 dark:text-rose-400">{t('budget.overLimit', { amount: formatMoney(-remaining, 0, locale) })}</span>
          ) : (
            <span className="text-muted-foreground">
              {t('budget.remainingLabel')} <span className="font-semibold text-foreground">{formatMoney(remaining, 0, locale)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            over
              ? 'bg-gradient-to-r from-rose-500 to-rose-400'
              : 'bg-gradient-to-r from-brand-600 to-brand-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
