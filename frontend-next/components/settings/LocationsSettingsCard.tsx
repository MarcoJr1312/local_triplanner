'use client';

import { useEffect, useState } from 'react';
import { Database, LoaderCircle, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { LocationsSettings } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FALLBACK: LocationsSettings = {
  provider: 'preloaded',
  hasKey: false,
  ready: false,
  cachedPlaces: 0,
};

export default function LocationsSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LocationsSettings | null>(null);
  const [provider, setProvider] = useState('preloaded');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLocationsSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setProvider(value.provider);
      })
      .catch(() => {
        if (!cancelled) setSettings(FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsKey = provider === 'hasdata';
  const hasSavedKey = Boolean(settings?.hasKey);
  const canSave = !saving && (!needsKey || key.trim().length > 0 || hasSavedKey);

  const handleSave = async () => {
    setError(null);
    if (needsKey && !key.trim() && !hasSavedKey) {
      setError(t('settings.locations.keyRequired'));
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateLocationsSettings({
        provider,
        apiKey: key.trim() || null,
        clearKey: provider === 'preloaded',
      });
      setSettings(saved);
      setProvider(saved.provider);
      setKey('');
      toast.success(t('settings.locations.saved'));
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card border-l-4 border-l-sky-500/70 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.locations.section')}
            </h2>
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
              {t('settings.serviceBadge.locations')}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('settings.byok')}
            </span>
            {settings && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  settings.provider === 'preloaded'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                }`}
              >
                {settings.provider === 'preloaded'
                  ? t('settings.locations.demoBadge')
                  : t('settings.locations.activeBadge')}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('settings.locations.hint')}
          </p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.byokLocationsHint')}</p>
          {settings && !settings.ready && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {t('settings.locations.unavailable')}
            </p>
          )}
        </div>
      </div>

      {settings === null ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="field">
            <label htmlFor="settings-locations-provider">{t('settings.locations.provider')}</label>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value !== provider) setKey('');
                setProvider(value);
                setError(null);
              }}
            >
              <SelectTrigger id="settings-locations-provider" className="input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preloaded">
                  {t('settings.locations.providerPreloaded')}
                </SelectItem>
                <SelectItem value="hasdata">
                  {t('settings.locations.providerHasdata')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsKey && (
            <div className="field">
              <label htmlFor="settings-locations-key">{t('settings.locations.key')}</label>
              <input
                id="settings-locations-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  hasSavedKey
                    ? t('settings.locations.keySavedPlaceholder')
                    : t('settings.locations.keyPlaceholder')
                }
                autoComplete="off"
                spellCheck={false}
                className="input"
              />
              <p className="text-xs text-muted">
                {hasSavedKey ? t('settings.locations.keySaved') : t('settings.locations.keyHint')}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            {t('settings.locations.cached', { count: settings.cachedPlaces })}
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {settings.provider === 'preloaded'
                ? t('settings.locations.demoStatus')
                : t('settings.locations.activeStatus')}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="btn btn-primary btn-sm"
            >
              {saving ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPin className="h-3.5 w-3.5" />
              )}
              {saving ? t('common.saving') : t('settings.locations.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
