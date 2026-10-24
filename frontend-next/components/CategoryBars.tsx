'use client';

import { categoryMeta } from '@/lib/categories';
import { formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { CategorySpend } from '@/lib/types';

interface CategoryBarsProps {
  spentByCategory: CategorySpend[];
  totalBudget: number;
}

export default function CategoryBars({ spentByCategory, totalBudget }: CategoryBarsProps) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-3">
      {spentByCategory.map((c) => {
        const meta = categoryMeta(c.category);
        const pct = totalBudget > 0 ? (c.amount / totalBudget) * 100 : 0;
        const width = Math.min(100, pct);
        return (
          <div key={c.category}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                <span className="truncate">{meta.labelKey ? t(meta.labelKey) : meta.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">
                {formatMoney(c.amount, 0, locale)} · {t('budget.percentOfTotal', { pct: Math.round(pct) })}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-500 ${meta.bar}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
