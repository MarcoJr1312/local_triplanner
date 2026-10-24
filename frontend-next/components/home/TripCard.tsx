'use client';

import { formatDateRange, formatMoney, listDays } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { getTripCover } from '@/lib/trip-presets';
import type { MemberRole, Trip } from '@/lib/types';
import MemberAvatars from './MemberAvatars';

const ROLE_LABEL_KEYS: Record<MemberRole, 'roles.owner' | 'roles.editor' | 'roles.viewer'> = {
  owner: 'roles.owner',
  editor: 'roles.editor',
  viewer: 'roles.viewer',
};

interface TripCardProps {
  trip: Trip;
  onOpen: () => void;
}

export default function TripCard({ trip, onOpen }: TripCardProps) {
  const { t, locale } = useI18n();
  const days = listDays(trip.startDate, trip.endDate).length;
  const pct = trip.totalBudget > 0 ? Math.min(100, (trip.spent / trip.totalBudget) * 100) : 0;
  const over = trip.spent > trip.totalBudget;
  const memberCount = trip.members.length;
  const monogram = trip.destinationName.trim().slice(0, 1).toUpperCase() || '?';
  const cover = getTripCover(trip);
  const CoverIcon = cover.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative top-0 overflow-hidden rounded-[18px] border border-border bg-card text-left shadow-card transition-all duration-200 hover:-top-[3px] hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div
        className="relative h-[140px] overflow-hidden"
        style={cover.kind === 'default' && cover.gradient ? { background: cover.gradient } : undefined}
      >
        {cover.kind === 'preset' && cover.gradient && (
          <div className={`absolute inset-0 ${cover.gradient}`} />
        )}

        {cover.kind === 'photo' && cover.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}

        {cover.kind === 'default' && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[5.5rem] font-bold leading-none text-white/25">
            {monogram}
          </span>
        )}

        {cover.kind === 'preset' && CoverIcon && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/30">
            <CoverIcon className="h-14 w-14" strokeWidth={1.5} />
          </span>
        )}

        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent 40%, rgb(10 8 20 / 0.55))' }}
        />
        <span className="absolute bottom-2.5 right-3 rounded-full bg-black/35 px-2.5 py-1 text-[0.74rem] font-medium text-white backdrop-blur-sm">
          {days === 1 ? t('days.one') : t('days.many', { n: days })}
        </span>
        <span className="absolute bottom-2.5 left-3.5 text-[1.02rem] font-bold tracking-[-0.01em] text-white">
          {trip.destinationName}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-2.5">
          <h3 className="truncate text-[0.98rem] font-semibold tracking-[-0.01em] text-foreground">
            {trip.name}
          </h3>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[0.68rem] font-semibold text-primary">
            {t(ROLE_LABEL_KEYS[trip.myRole])}
          </span>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateRange(trip.startDate, trip.endDate, locale)} ·{' '}
          {memberCount === 1 ? t('members.countOne') : t('members.countMany', { n: memberCount })}
        </p>

        <div className="mt-3.5">
          <div className="flex items-center justify-between text-[0.74rem] text-muted-foreground">
            <span>{t('budget.title')}</span>
            <span className="font-medium tabular-nums text-foreground">
              {formatMoney(trip.spent, 0, locale)} / {formatMoney(trip.totalBudget, 0, locale)}
            </span>
          </div>
          <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                over
                  ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                  : 'bg-gradient-to-r from-brand-600 to-brand-400'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-3.5">
          <MemberAvatars members={trip.members} />
        </div>
      </div>
    </button>
  );
}
