import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { Suggestion } from '../lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';

interface SuggestionsPanelProps {
  open: boolean;
  tripId: string;
  day: string;
  onClose: () => void;
}

export default function SuggestionsPanel({ open, tripId, day, onClose }: SuggestionsPanelProps) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setItems([]);
    setAdded({});
    setError(null);
    api
      .requestSuggestions(tripId, day)
      .then((res) => setItems(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron generar sugerencias.'))
      .finally(() => setLoading(false));
  }, [open, tripId, day]);

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
    } catch {
      setError('No se pudo añadir la sugerencia.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Sugerencias de IA" size="md">
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-50 to-brand-50 p-3 text-sm text-slate-600 ring-1 ring-inset ring-brand-100/60">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        Ideas generadas para este día según tu destino.
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-rose-600">{error}</p>
      ) : (
        <div className="space-y-3">
          {items.map((s, idx) => {
            const key = `${idx}-${s.title}`;
            const isAdded = added[key];
            return (
              <div key={key} className="rounded-xl border border-slate-200 p-3.5 shadow-card transition duration-150 hover:border-brand-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <CategoryBadge category={s.category} size="xs" />
                      <span className="text-sm font-medium tabular-nums text-slate-700">{s.cost > 0 ? formatMoney(s.cost, 0) : 'Gratis'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdd(s, idx)}
                    disabled={isAdded}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                      isAdded
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]'
                    }`}
                  >
                    {isAdded ? (
                      <span className="flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> Añadido
                      </span>
                    ) : (
                      'Añadir al día'
                    )}
                  </button>
                </div>
                <p className="mt-2 text-xs italic text-slate-500">“{s.rationale}”</p>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
