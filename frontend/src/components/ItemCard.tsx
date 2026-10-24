import { useEffect, useRef, useState } from 'react';
import {
  Bed,
  Clock,
  Landmark,
  MapPin,
  Moon,
  MoreVertical,
  Pencil,
  Plane,
  Ticket,
  Trash2,
  UtensilsCrossed,
  ArrowRight,
} from 'lucide-react';
import type { Member, TripItem } from '../lib/types';
import { formatMoney } from '../lib/format';
import { categoryMeta } from '../lib/categories';
import CategoryBadge from './CategoryBadge';
import SmartImage from './SmartImage';

interface ItemCardProps {
  item: TripItem;
  members: Member[];
  canEdit: boolean;
  currentUserId: string | null;
  days: string[];
  onEdit: () => void;
  onView?: () => void;
  onMove: (day: string) => void;
  onRemove: () => void;
  onCostChange: (cost: number) => void;
}

export default function ItemCard({
  item,
  members,
  canEdit,
  currentUserId,
  days,
  onEdit,
  onView,
  onMove,
  onRemove,
  onCostChange,
}: ItemCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState(String(item.cost));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const adder = members.find((m) => m.userId === item.addedBy);
  const addedLabel = item.addedBy === currentUserId ? 'Tú' : adder?.displayName ?? 'Un miembro';

  const commitCost = () => {
    const parsed = Number(costDraft);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed !== item.cost) {
      onCostChange(parsed);
    } else {
      setCostDraft(String(item.cost));
    }
    setEditingCost(false);
  };

  return (
    <div className="group flex gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-card transition duration-200 hover:border-brand-200 hover:shadow-card-hover">
      {item.imageUrl ? (
        <SmartImage src={item.imageUrl} alt={item.title} className="h-16 w-16 shrink-0 rounded-xl object-cover" iconClassName="h-6 w-6" />
      ) : (
        <CategoryTile category={item.category} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => (onView ? onView() : onEdit())}
              className="truncate text-left text-sm font-semibold text-slate-900 transition duration-150 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:pointer-events-none"
              disabled={!canEdit}
            >
              {item.title}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <CategoryBadge category={item.category} size="xs" />
              {item.startTime && (
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                  <Clock className="h-3 w-3" /> {item.startTime}
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg p-1 text-slate-400 transition duration-150 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                aria-label="Opciones"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-20 w-48 animate-slide-down rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition duration-150 hover:bg-slate-50"
                  >
                    <Pencil className="h-4 w-4 text-slate-400" /> Editar
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Mover a…</p>
                  {days.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      disabled={d === item.day}
                      onClick={() => {
                        setMenuOpen(false);
                        onMove(d);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 transition duration-150 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowRight className="h-3.5 w-3.5 text-slate-300" /> Día {i + 1}
                      {d === item.day && <span className="ml-auto text-[10px] text-brand-500">actual</span>}
                    </button>
                  ))}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 transition duration-150 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="truncate text-xs text-slate-400">Añadido por {addedLabel}</span>
          {editingCost ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitCost();
              }}
              className="flex items-center gap-1"
            >
              <span className="text-sm text-slate-400">$</span>
              <input
                autoFocus
                type="number"
                min={0}
                step="0.5"
                value={costDraft}
                onChange={(e) => setCostDraft(e.target.value)}
                onBlur={commitCost}
                className="w-20 rounded-lg border border-brand-300 px-2 py-0.5 text-sm font-semibold text-slate-900 outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => canEdit && setEditingCost(true)}
              className={`rounded-lg px-1 text-sm font-semibold transition duration-150 ${item.cost > 0 ? 'text-slate-900' : 'text-emerald-600'} ${
                canEdit ? 'hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40' : 'cursor-default'
              }`}
              title={canEdit ? 'Editar costo' : undefined}
            >
              {item.cost > 0 ? formatMoney(item.cost, 0) : 'Gratis'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryTile({ category }: { category: string }) {
  const meta = categoryMeta(category);
  const Icon = CATEGORY_ICONS[category] ?? MapPin;
  return (
    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl ${meta.tile} ${meta.icon}`}>
      <Icon className="h-7 w-7" />
    </div>
  );
}

const CATEGORY_ICONS: Record<string, typeof MapPin> = {
  sight: Landmark,
  food: UtensilsCrossed,
  activity: Ticket,
  nightlife: Moon,
  transporte: Plane,
  alojamiento: Bed,
};
