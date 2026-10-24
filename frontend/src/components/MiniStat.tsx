import type { ReactNode } from 'react';

export type MiniStatTone = 'brand' | 'sky' | 'emerald' | 'amber' | 'rose' | 'slate';

const TONE_ICON: Record<MiniStatTone, string> = {
  brand: 'bg-brand-50 text-brand-600',
  sky: 'bg-sky-50 text-sky-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
};

interface MiniStatProps {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: MiniStatTone;
  compact?: boolean;
}

export default function MiniStat({ icon, label, value, tone = 'brand', compact = false }: MiniStatProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-card">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>{icon}</span>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-sm font-bold tabular-nums tracking-tight text-slate-900">{value}</span>
          <span className="truncate text-xs text-slate-500">{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_ICON[tone]}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
          <p className="truncate text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
