import { useEffect, useState } from 'react';
import { Check, ChevronDown, Clock, Copy, Globe, MapPin, Pencil } from 'lucide-react';
import { locationById } from '../lib/api';
import { formatHours, hoursDayList, socialLinkList } from '../lib/locationFormat';
import type { Location, TripItem } from '../lib/types';
import Modal from './Modal';
import CategoryBadge from './CategoryBadge';

interface LocationDetailModalProps {
  open: boolean;
  item: TripItem | null;
  onClose: () => void;
  onEdit: (item: TripItem) => void;
}

export default function LocationDetailModal({ open, item, onClose, onEdit }: LocationDetailModalProps) {
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
    <Modal open={open} onClose={onClose} title={loc?.name ?? item?.title ?? 'Detalle'} size="md">
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={loc?.category ?? item?.category ?? 'activity'} size="sm" />
              {loc?.rawType && <span className="text-xs text-slate-400">{loc.rawType}</span>}
              {loc?.rating != null && (
                <span className="text-xs font-medium text-amber-600">
                  ★ {loc.rating}
                  {loc?.ratingCount != null && <span className="font-normal text-slate-400"> ({loc.ratingCount})</span>}
                </span>
              )}
              {loc?.priceLevel && (
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{loc.priceLevel}</span>
              )}
              {loc?.source === 'hasdata' && (
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Google Maps</span>
              )}
            </div>

            {loc?.address ? (
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p className="min-w-0 flex-1 text-sm text-slate-700">{loc.address}</p>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition duration-150 hover:border-brand-200 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            ) : (
              item?.activityId && !loc && (
                <p className="text-sm text-slate-400">Sin información adicional para este lugar.</p>
              )
            )}

            {loc?.phone && <p className="text-sm text-slate-600">Tel: {loc.phone}</p>}

            {dayList && (
              <div>
                <button
                  type="button"
                  onClick={() => setHoursOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 -ml-1.5 text-sm font-medium text-slate-600 transition duration-150 hover:bg-slate-100 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Clock className="h-4 w-4" />
                  {today ? `${today.day}: ${today.time}` : `${dayList[0].day}: ${dayList[0].time}`}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${hoursOpen ? 'rotate-180' : ''}`} />
                </button>
                {hoursOpen && (
                  <ul className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                    {dayList.map((d) => (
                      <li key={d.day} className={`flex items-center justify-between gap-4 ${d.isToday ? 'font-semibold text-brand-700' : ''}`}>
                        <span className="flex items-center gap-1.5">
                          {d.day}
                          {d.isToday && <span className="rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-700">Hoy</span>}
                        </span>
                        <span className="tabular-nums">{d.time}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!dayList && hoursLine && (
              <p className="flex items-center gap-1.5 text-sm text-slate-600">
                <Clock className="h-4 w-4" /> {hoursLine}
              </p>
            )}

            {(loc?.websiteUrl || social.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                {loc?.websiteUrl && (
                  <a
                    href={loc.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <Globe className="h-3.5 w-3.5" /> Sitio web
                  </a>
                )}
                {social.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            )}

            {loc?.description && <p className="text-sm text-slate-500">{loc.description}</p>}
          </>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
        {item && (
          <button
            type="button"
            onClick={() => {
              onEdit(item);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 transition duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <Pencil className="h-4 w-4" /> Editar
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
