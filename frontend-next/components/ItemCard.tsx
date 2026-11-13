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
  const addedLabel =
    item.addedBy === currentUserId ? t('items.you') : adder?.displayName ?? t('items.someMember');
  const Icon = CATEGORY_ICONS[item.category] ?? MapPin;
  const attachmentCount = item.attachments?.length ?? 0;
  const reminderOn = item.reminderEnabled === 1;
  const reminderDisabled = !item.startTime || !item.day;
  const reminderLabel = reminderDisabled
    ? t('items.reminderNoTime')
    : reminderOn
      ? t('items.reminderAriaOn')
      : t('items.reminderAriaOff');
  const categoryColor =
    item.category === 'food'
      ? 'food'
      : item.category === 'activity'
        ? 'activity'
        : item.category === 'nightlife'
          ? 'night'
          : '';

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
    <div className="tl-item">
      <div className="tl-time">
        {item.startTime ? item.startTime.slice(0, 5) : '—'}
      </div>
      <div className="tl-rail">
        <span className="tl-line" />
        <span className="tl-dot" />
      </div>
      <div className="tl-card group">
        {item.imageUrl ? (
          <SmartImage
            src={item.imageUrl}
            alt={item.title}
            className="h-10 w-10 shrink-0 rounded-[10px] object-cover"
            iconClassName="h-4 w-4"
          />
        ) : (
          <span className={`act-icon ${categoryColor}`}>
            <Icon className="icon" />
          </span>
        )}

        <div className="act-main">
          <strong>
            <button
              type="button"
              onClick={() => (onView ? onView() : onEdit())}
              className="min-w-0 shrink truncate text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              disabled={!canEdit}
            >
              {item.title}
            </button>
            <span className="inline-flex w-max shrink-0">
              <CategoryBadge category={item.category} size="xs" />
            </span>
            {editingBy && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] italic text-muted">
                <Pencil className="h-3 w-3 shrink-0" />
                {t('items.editingBy', { name: editingBy })}
              </span>
            )}
          </strong>
          <span>
            {item.notes ?? t('items.addedBy', { name: addedLabel })}
          </span>
        </div>

        <div className="act-side">
          {editingCost ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitCost();
              }}
              className="flex items-center gap-1"
            >
              <span className="text-xs text-muted">$</span>
              <input
                autoFocus
                type="number"
                min={0}
                step="0.5"
                value={costDraft}
                onChange={(e) => setCostDraft(e.target.value)}
                onBlur={commitCost}
                className="input"
                style={{ width: 74, height: 28, fontSize: 12, padding: '0 8px' }}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => canEdit && setEditingCost(true)}
              className={`rounded-md px-1 text-[12.5px] font-semibold tabular-nums transition ${
                item.cost > 0 ? 'text-foreground' : 'text-success'
              } ${canEdit ? 'hover:bg-[var(--surface-2)]' : 'cursor-default'}`}
              title={canEdit ? t('items.editCost') : undefined}
            >
              {item.cost > 0 ? formatMoney(item.cost, 0, locale) : t('common.free')}
            </button>
          )}

          {item.activityId && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`fav${item.isFavorite ? ' active' : ''}`}
              aria-label={item.isFavorite ? t('items.removeFavorite') : t('items.addFavorite')}
            >
              <Heart className="icon-sm" />
            </button>
          )}

          {attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-muted"
              title={t(
                attachmentCount === 1 ? 'attachments.countOne' : 'attachments.countMany',
                { n: attachmentCount }
              )}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" /> {attachmentCount}
            </span>
          )}

          {canEdit && onToggleReminder && (
            <button
              type="button"
              onClick={onToggleReminder}
              disabled={reminderDisabled}
              aria-label={reminderLabel}
              title={reminderLabel}
              className={`fav hide-sm${reminderOn ? ' text-primary' : ''}`}
            >
              {reminderOn ? <Bell className="icon-sm" /> : <BellOff className="icon-sm" />}
            </button>
          )}

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="fav" aria-label={t('common.options')}>
                  <MoreVertical className="icon-sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="h-4 w-4 text-muted" /> {t('common.edit')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  {t('items.moveTo')}
                </DropdownMenuLabel>
                {days.map((d, i) => (
                  <DropdownMenuItem key={d} disabled={d === item.day} onSelect={() => onMove(d)}>
                    <ArrowRight className="h-3.5 w-3.5 text-muted" /> {t('days.tab', { n: i + 1 })}
                    {d === item.day && <span className="ml-auto text-[10px] text-primary">{t('items.current')}</span>}
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
