'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Car, Check, ChevronDown, Clock, Copy, Globe, MapPin, Pencil } from 'lucide-react';
import { locationById } from '@/lib/api';
import { formatHours, hoursDayList, socialLinkList } from '@/lib/locationFormat';
import { buildUberLink } from '@/lib/uberLink';
import { useI18n } from '@/lib/i18n';
import type { Location, Member, TripItem } from '@/lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';
import ItemAttachmentsSection from './ItemAttachmentsSection';
import { Skeleton } from '@/components/ui/skeleton';

interface LocationDetailModalProps {
  open: boolean;
  item: TripItem | null;
  tripId: string;
  members: Member[];
  canEdit?: boolean;
  onClose: () => void;
  onEdit: (item: TripItem) => void;
  onOpenReminder?: () => void;
}

export default function LocationDetailModal({ open, item, tripId, members, canEdit = false, onClose, onEdit, onOpenReminder }: LocationDetailModalProps) {
  const { t } = useI18n();
  const [loc, setLoc] = useState<Location | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoc(null);
    setHoursOpen(false);
    setCopied(false);
    if (open && item?.activityId) {
      setLoading(true);
      locationById(item.activityId)
        .then((l) => setLoc(l))
        .catch(() => setLoc(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [open, item?.id, item?.activityId]);

  const dayList = hoursDayList(loc?.hours);
  const hoursLine = formatHours(loc?.hours);
  const social = socialLinkList(loc?.socialLinks);
  const today = dayList?.find((d) => d.isToday);
  const uberTitle = item?.title ?? '';
  const uberLocationId = item?.activityId ?? undefined;
  const showUber = Boolean(uberTitle.trim() || uberLocationId);
  const uberOptions = {
    title: uberTitle,
    address: loc?.address ?? item?.locationText ?? undefined,
    locationId: uberLocationId,
    dropoff:
      loc?.lat != null && loc?.lng != null
        ? { latitude: loc.lat, longitude: loc.lng }
        : undefined,
  };
  const uberAutoHref = buildUberLink(uberOptions);
  const reminderOn = Boolean(item?.reminder?.enabled);
  const reminderLabel = reminderOn
    ? t('items.reminderAriaOn')
    : t('items.reminderAriaOff');

  const copyAddress = async () => {
    const text = [loc?.name ?? item?.title ?? '', loc?.address ?? ''].filter(Boolean).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={loc?.name ?? item?.title ?? t('location.detailTitle')} size="md">
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={loc?.category ?? item?.category ?? 'activity'} size="sm" />
              {loc?.rawType && <span className="text-xs text-muted-foreground">{loc.rawType}</span>}
              {loc?.rating != null && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  ★ {loc.rating}
                  {loc?.ratingCount != null && <span className="font-normal text-muted-foreground"> ({loc.ratingCount})</span>}
                </span>
              )}
              {loc?.priceLevel && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/90">{loc.priceLevel}</span>
              )}
              {loc?.source === 'hasdata' && (
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{t('location.sourceGoogleMaps')}</span>
              )}
            </div>

            {loc?.address ? (
              <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 text-sm text-foreground">{loc.address}</p>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-foreground/90 transition duration-150 hover:border-brand-200 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
            ) : (
              item?.activityId && !loc && (
                <p className="text-sm text-muted-foreground">{t('location.noInfo')}</p>
              )
            )}

            {loc?.phone && <p className="text-sm text-foreground/90">{t('common.phone', { phone: loc.phone })}</p>}

            {dayList && (
              <div>
                <button
                  type="button"
                  onClick={() => setHoursOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 -ml-1.5 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Clock className="h-4 w-4" />
                  {today ? `${today.day}: ${today.time}` : `${dayList[0].day}: ${dayList[0].time}`}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${hoursOpen ? 'rotate-180' : ''}`} />
                </button>
                {hoursOpen && (
                  <ul className="mt-2 space-y-1 rounded-xl bg-muted/40 p-3 text-sm text-foreground/90">
                    {dayList.map((d) => (
                      <li key={d.day} className={`flex items-center justify-between gap-4 ${d.isToday ? 'font-semibold text-brand-700' : ''}`}>
                        <span className="flex items-center gap-1.5">
                          {d.day}
                          {d.isToday && <span className="rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{t('time.today')}</span>}
                        </span>
                        <span className="tabular-nums">{d.time}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!dayList && hoursLine && (
              <p className="flex items-center gap-1.5 text-sm text-foreground/90">
                <Clock className="h-4 w-4" /> {hoursLine}
              </p>
            )}

            {(loc?.websiteUrl || social.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {loc?.websiteUrl && (
                  <a
                    href={loc.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"
                  >
                    <Globe className="h-3.5 w-3.5" /> {t('common.website')}
                  </a>
                )}
                {social.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            )}

            {loc?.description && <p className="text-sm text-muted-foreground">{loc.description}</p>}

            {item && <ItemAttachmentsSection item={item} tripId={tripId} members={members} />}
          </>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {item && canEdit && onOpenReminder && (
            <button
              type="button"
              onClick={onOpenReminder}
              aria-label={reminderLabel}
              title={reminderLabel}
              className={`inline-flex items-center justify-center rounded-xl border border-input p-2 transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent max-sm:min-h-11 max-sm:min-w-11 ${reminderOn ? 'text-brand-600' : 'text-muted-foreground'}`}
            >
              {reminderOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>
          )}
          {item && showUber && (
            <a
              href={uberAutoHref}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3.5 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <Car className="h-4 w-4" /> {t('items.uberRide')}
            </a>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {item && (
            <button
              type="button"
              onClick={() => {
                onEdit(item);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3.5 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <Pencil className="h-4 w-4" /> {t('common.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 max-sm:min-h-11"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      </Modal>
    </>
  );
}
