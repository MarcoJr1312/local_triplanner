import { formatMoney } from '../lib/format';

interface BudgetBarProps {
  total: number;
  spent: number;
}

function barColor(pct: number): string {
  if (pct >= 100) return 'bg-rose-500';
  if (pct >= 85) return 'bg-amber-500';
  return 'bg-brand-500';
}

export default function BudgetBar({ total, spent }: BudgetBarProps) {
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const over = spent > total;
  const remaining = total - spent;

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatMoney(spent, 0)}</span>
          <span className="ml-2 text-sm text-slate-500">de {formatMoney(total, 0)}</span>
        </div>
        <div className="text-right text-sm">
          {over ? (
            <span className="font-semibold text-rose-600">+{formatMoney(-remaining, 0)} sobre el límite</span>
          ) : (
            <span className="text-slate-500">
              Quedan <span className="font-semibold text-slate-700">{formatMoney(remaining, 0)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
