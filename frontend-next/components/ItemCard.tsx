'use client';

import { useState } from 'react';
import {
  Bed,
  Bell,
  BellOff,
  Heart,
  Landmark,
  MapPin,
  Moon,
  MoreVertical,
  Paperclip,
  Pencil,
  Plane,
  Ticket,
  Trash2,
  UtensilsCrossed,
  ArrowRight,
} from 'lucide-react';
import type { Member, TripItem } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import CategoryBadge from './CategoryBadge';
import SmartImage from './SmartImage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ItemCardProps {
  item: TripItem;
  members: Member[];
  canEdit: boolean;
  currentUserId: string | null;
  days: string[];
  editingBy?: string | null;
  onEdit: () => void;
  onView?: () => void;
  onMove: (day: string) => void;
  onRemove: () => void;
  onCostChange: (cost: number) => void;
  onToggleFavorite: () => void;
  onToggleReminder?: () => void;
}

export default function ItemCard({
  item,
  members,
  canEdit,
  currentUserId,
  days,
  editingBy,
  onEdit,
  onView,
  onMove,
  onRemove,
  onCostChange,
  onToggleFavorite,
  onToggleReminder,
}: ItemCardProps) {
  const { t, locale } = useI18n();
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState(String(item.cost));

  const adder = members.find((m) => m.userId === item.addedBy);
  const addedLabel = item.addedBy === currentUserId ? t('items.you') : adder?.displayName ?? t('items.someMember');
  const Icon = CATEGORY_ICONS[item.category] ?? MapPin;
  const attachmentCount = item.attachments?.length ?? 0;
  const reminderOn = item.reminderEnabled === 1;
  const reminderDisabled = !item.startTime || !item.day;
  const reminderLabel = reminderDisabled
    ? t('items.reminderNoTime')
    : reminderOn
      ? t('items.reminderAriaOn')
      : t('items.reminderAriaOff');

  const reminderButton = (extraClassName: string) => (
    <button
      type="button"
      onClick={onToggleReminder}
      disabled={reminderDisabled}
      aria-label={reminderLabel}
      title={reminderLabel}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg p-1 transition duration-150 hover:bg-brand-50 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground dark:hover:bg-brand-500/10 ${reminderOn ? 'text-brand-600' : 'text-muted-foreground/60'} ${extraClassName}`}
    >
      {reminderOn ? <Bell className="h-3.5 w-3.5 shrink-0" /> : <BellOff className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );

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
    <div className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card transition duration-200 hover:border-brand-200 hover:shadow-card-hover max-sm:flex-wrap max-sm:gap-2">
      {/* columna fija de hora (o icono de categoría si no tiene hora) — solo desktop */}
      <div className="hidden w-11 shrink-0 flex-col items-center justify-center gap-0.5 sm:flex">
        {item.startTime ? (
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{item.startTime}</span>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0" />
          </span>
        )}
        {canEdit && reminderButton('')}
      </div>

      {item.imageUrl && (
        <SmartImage
          src={item.imageUrl}
          alt={item.title}
          className="h-11 w-11 shrink-0 rounded-xl object-cover max-sm:h-10 max-sm:w-10"
          iconClassName="h-5 w-5"
        />
      )}

      <div className="min-w-0 flex-1">
        {/* hora (o icono) sobre el título, solo en móvil */}
        <div className="flex items-center gap-1 sm:hidden">
          {item.startTime ? (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{item.startTime}</span>
          ) : (
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {canEdit && reminderButton('max-sm:min-h-11 max-sm:min-w-11')}
        </div>
        <div className="flex items-center gap-1.5 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
          <button
            type="button"
            onClick={() => (onView ? onView() : onEdit())}
            className="min-w-0 truncate text-left text-sm font-medium text-foreground transition duration-150 max-sm:line-clamp-2 max-sm:w-full max-sm:whitespace-normal hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none"
            disabled={!canEdit}
          >
            {item.title}
          </button>
          <span className="max-sm:hidden">
            <CategoryBadge category={item.category} size="xs" />
          </span>
          {editingBy && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] italic text-muted-foreground">
              <Pencil className="h-3 w-3 shrink-0" />
              {t('items.editingBy', { name: editingBy })}
            </span>
          )}
        </div>
        {item.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.notes}</p>}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{t('items.addedBy', { name: addedLabel })}</p>
      </div>

      {/* categoría: fila propia debajo, solo en móvil */}
      <div className="hidden max-sm:order-last max-sm:flex max-sm:basis-full">
        <CategoryBadge category={item.category} size="xs" />
      </div>

      {/* costo + acciones */}
      <div className="flex shrink-0 items-center gap-2">
        {editingCost ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitCost();
            }}
            className="flex items-center gap-1"
          >
            <span className="text-sm text-muted-foreground">$</span>
            <input
              autoFocus
              type="number"
              min={0}
              step="0.5"
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              onBlur={commitCost}
              className="w-20 rounded-lg border border-brand-300 bg-background px-2 py-0.5 text-sm font-semibold tabular-nums text-foreground outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setEditingCost(true)}
            className={`rounded-lg px-1 text-sm font-semibold tabular-nums transition duration-150 max-sm:px-0.5 max-sm:text-xs ${
              item.cost > 0 ? 'text-foreground' : 'text-emerald-600 dark:text-emerald-400'
            } ${
              canEdit
                ? 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
                : 'cursor-default'
            }`}
            title={canEdit ? t('items.editCost') : undefined}
          >
            {item.cost > 0 ? formatMoney(item.cost, 0, locale) : t('common.free')}
          </button>
        )}

        <div className="flex items-center gap-0.5">
          {item.activityId && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition duration-150 max-sm:min-h-11 max-sm:min-w-11 hover:bg-brand-50 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-brand-500/10"
              aria-label={item.isFavorite ? t('items.removeFavorite') : t('items.addFavorite')}
            >
              <Heart
                className={`h-4 w-4 shrink-0 ${item.isFavorite ? 'fill-brand-600 text-brand-600' : ''}`}
              />
            </button>
          )}

          {attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
              title={t(attachmentCount === 1 ? 'attachments.countOne' : 'attachments.countMany', { n: attachmentCount })}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" /> {attachmentCount}
            </span>
          )}

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg p-1 text-muted-foreground transition duration-150 max-sm:min-h-11 max-sm:min-w-11 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={t('common.options')}
                >
                  <MoreVertical className="h-4 w-4 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="h-4 w-4 text-muted-foreground" /> {t('common.edit')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('items.moveTo')}
                </DropdownMenuLabel>
                {days.map((d, i) => (
                  <DropdownMenuItem key={d} disabled={d === item.day} onSelect={() => onMove(d)}>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> {t('days.tab', { n: i + 1 })}
                    {d === item.day && <span className="ml-auto text-[10px] text-brand-500">{t('items.current')}</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onRemove}
                  className="text-rose-600 focus:bg-rose-50 focus:text-rose-600 dark:focus:bg-rose-500/15 dark:focus:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" /> {t('common.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
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
