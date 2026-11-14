'use client';

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  MapPin,
  Star,
} from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { formatHours, hoursDayList, socialLinkList } from '@/lib/locationFormat';
import { useI18n } from '@/lib/i18n';
import type { Location } from '@/lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';

interface SearchLocationModalProps {
  location: Location | null;
  onClose: () => void;
}

export default function SearchLocationModal({ location, onClose }: SearchLocationModalProps) {
  const { t } = useI18n();
  const [hoursOpen, setHoursOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!location) return null;

  const dayList = hoursDayList(location.hours);
  const hoursLine = formatHours(location.hours);
  const social = socialLinkList(location.socialLinks);
  const today = dayList?.find((day) => day.isToday);
  const priceLevel =
    location.priceLevel != null && String(location.priceLevel).trim() !== ''
      ? String(location.priceLevel)
      : null;
  const mapsUrl =
    location.lat != null && location.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
      : location.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
        : null;

  const copyAddress = async () => {
    const text = [location.name, location.address ?? ''].filter(Boolean).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open onClose={onClose} title={location.name} size="md">
      <div className="space-y-4">
        {location.imageUrl && (
          <img
            src={location.imageUrl}
            alt={location.name}
            loading="lazy"
            className="h-44 w-full rounded-xl object-cover"
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={location.category} size="sm" />
          {location.rawType && (
            <span className="text-xs text-muted-foreground">{location.rawType}</span>
          )}
          {location.rating != null && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Star className="h-3.5 w-3.5 fill-current" />
              {location.rating.toFixed(1)}
              {location.ratingCount != null && (
                <span className="font-normal text-muted-foreground">({location.ratingCount})</span>
              )}
            </span>
          )}
          {priceLevel && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/90">
              {priceLevel}
            </span>
          )}
          {location.source === 'hasdata' && (
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {t('location.sourceGoogleMaps')}
            </span>
          )}
        </div>

        {location.address && (
          <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm text-foreground">{location.address}</p>
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-foreground/90 transition duration-150 hover:border-brand-200 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        )}

        {location.phone && (
          <p className="text-sm text-foreground/90">{t('common.phone', { phone: location.phone })}</p>
        )}

        {dayList && (
          <div>
            <button
              type="button"
              onClick={() => setHoursOpen((value) => !value)}
              className="-ml-1.5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <Clock className="h-4 w-4" />
              {today ? `${today.day}: ${today.time}` : `${dayList[0].day}: ${dayList[0].time}`}
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-150 ${hoursOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {hoursOpen && (
              <ul className="mt-2 space-y-1 rounded-xl bg-muted/40 p-3 text-sm text-foreground/90">
                {dayList.map((day) => (
                  <li
                    key={day.day}
                    className={`flex items-center justify-between gap-4 ${day.isToday ? 'font-semibold text-brand-700 dark:text-brand-300' : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {day.day}
                      {day.isToday && (
                        <span className="rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                          {t('time.today')}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{day.time}</span>
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

        <div className="grid grid-cols-2 gap-3 text-sm">
          {location.cost != null && (
            <div className="rounded-xl border border-border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('location.cost')}
              </p>
              <p className="mt-1 font-semibold text-foreground">{formatMoney(location.cost)}</p>
            </div>
          )}
          {location.durationHours != null && (
            <div className="rounded-xl border border-border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('location.duration')}
              </p>
              <p className="mt-1 font-semibold text-foreground">{location.durationHours}h</p>
            </div>
          )}
        </div>

        {location.description && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('location.about')}
            </h4>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{location.description}</p>
          </div>
        )}

        {location.tags && location.tags.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('location.tags')}
            </h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {location.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-brand-500/20 bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {(location.websiteUrl || social.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {location.websiteUrl && (
              <a
                href={location.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"
              >
                <Globe className="h-3.5 w-3.5" /> {t('common.website')}
              </a>
            )}
            {social.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"
              >
                {link.title}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3.5 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <ExternalLink className="h-4 w-4" /> {t('location.openMaps')}
          </a>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
