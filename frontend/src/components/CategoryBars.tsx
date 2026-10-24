import { categoryMeta } from '../lib/categories';
import { formatMoney } from '../lib/format';
import type { CategorySpend } from '../lib/types';

interface CategoryBarsProps {
  spentByCategory: CategorySpend[];
}

export default function CategoryBars({ spentByCategory }: CategoryBarsProps) {
  const spentTotal = spentByCategory.reduce((a, c) => a + c.amount, 0);

  return (
    <div className="space-y-2.5">
      {spentByCategory.map((c) => {
        const meta = categoryMeta(c.category);
        const pct = spentTotal > 0 ? (c.amount / spentTotal) * 100 : 0;
        return (
          <div key={c.category} className="flex items-center gap-2.5 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
            <span className="w-24 shrink-0 truncate text-slate-600">{meta.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${meta.bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-medium tabular-nums text-slate-700">{formatMoney(c.amount, 0)}</span>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">{Math.round(pct)}%</span>
          </div>
        );
      })}
    </div>
  );
}
