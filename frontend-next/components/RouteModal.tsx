'use client';

import { useEffect, useState } from 'react';
import { Loader2, LocateFixed, Navigation, Route } from 'lucide-react';
import { toast } from 'sonner';
import { GEOLOCATION_ERROR_KEYS, getCurrentLocation, getLastGeolocationError } from '@/lib/geolocation';
import { useI18n } from '@/lib/i18n';
import Modal from './Modal';

interface RouteModalProps {
  open: boolean;
  stopCount: number;
  onClose: () => void;
  onSubmit: (origin: string | null) => void;
}

// Popup que pide el punto de partida antes de abrir Google Maps.
// Si el usuario lo deja vacio, la ruta abre con el origen libre.
export default function RouteModal({ open, stopCount, onClose, onSubmit }: RouteModalProps) {
  const { t } = useI18n();
  const [origin, setOrigin] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [gpsActive, setGpsActive] = useState(false);

  useEffect(() => {
    if (open) {
      setOrigin('');
      setRequesting(false);
      setGpsActive(false);
    }
  }, [open]);

  const submit = () => {
    const trimmed = origin.trim();
    onSubmit(trimmed ? trimmed : null);
  };

  const useMyLocation = async () => {
    if (requesting) return;
    setRequesting(true);
    const coords = await getCurrentLocation();
    setRequesting(false);
    if (coords) {
      setOrigin(`${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`);
      setGpsActive(true);
    } else {
      const code = getLastGeolocationError() ?? 'generic';
      toast.error(t(GEOLOCATION_ERROR_KEYS[code]));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('route.title')}
      size="sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-emerald-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 max-sm:min-h-11"
          >
            <Navigation className="h-4 w-4" /> {t('route.open')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-foreground/90">
          {stopCount === 1 ? t('route.summaryOne') : t('route.summaryMany', { n: stopCount })}
        </p>
        <div>
          <label htmlFor="route-origin" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Route className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {t('route.origin')}
            {gpsActive && (
              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                GPS
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              id="route-origin"
              type="text"
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value);
                setGpsActive(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={t('route.originPlaceholder')}
              autoFocus
              className="min-w-0 flex-1 rounded-xl border border-input px-3 py-2 text-base text-foreground placeholder:text-muted-foreground outline-none md:text-sm transition duration-150 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <button
              type="button"
              onClick={useMyLocation}
              disabled={requesting}
              aria-busy={requesting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted/40 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              {requesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LocateFixed className="h-4 w-4" />
              )}
              {requesting ? t('geolocation.loading') : t('route.useMyLocation')}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('route.originHint')}
          </p>
        </div>
      </div>
    </Modal>
  );
}
