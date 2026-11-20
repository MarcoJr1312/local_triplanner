'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { EmailSettings } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function EmailSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [provider, setProvider] = useState('sink');
  const [key, setKey] = useState('');
  const [from, setFrom] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getEmailSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setProvider(value.provider);
        setFrom(value.from);
        setReplyTo(value.replyTo);
      })
      .catch(() => {
        if (!cancelled) {
          setSettings({ provider: 'sink', from: '', replyTo: '', hasKey: false, ready: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsKey = provider === 'resend';
  const hasSavedKey = Boolean(settings?.hasKey);
  const canSave = !saving && (!needsKey || key.trim().length > 0 || hasSavedKey);

  const handleSave = async () => {
    setError(null);
    if (needsKey && !key.trim() && !hasSavedKey) {
      setError(t('settings.email.keyRequired'));
      return;
    }
    if (needsKey && !from.trim()) {
      setError(t('settings.email.fromRequired'));
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateEmailSettings({
        provider,
        apiKey: key.trim() || null,
        from: from.trim(),
        replyTo: replyTo.trim(),
        clearKey: provider === 'sink',
      });
      setSettings(saved);
      setProvider(saved.provider);
      setFrom(saved.from);
      setReplyTo(saved.replyTo);
      setKey('');
      toast.success(t('settings.email.saved'));
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card border-l-4 border-l-emerald-500/70 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.email.section')}
            </h2>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              {t('settings.serviceBadge.email')}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('settings.byok')}
            </span>
            {settings && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  settings.provider === 'sink'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {settings.provider === 'sink'
                  ? t('settings.email.demoBadge')
                  : t('settings.email.activeBadge')}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('settings.email.hint')}
          </p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.byokEmailHint')}</p>
          {settings && !settings.ready && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {t('settings.email.unavailable')}
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
            <label htmlFor="settings-email-provider">{t('settings.email.provider')}</label>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value !== provider) setKey('');
                setProvider(value);
                setError(null);
              }}
            >
              <SelectTrigger id="settings-email-provider" className="input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sink">{t('settings.email.providerSink')}</SelectItem>
                <SelectItem value="resend">{t('settings.email.providerResend')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsKey && (
            <>
              <div className="field">
                <label htmlFor="settings-email-key">{t('settings.email.key')}</label>
                <input
                  id="settings-email-key"
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    hasSavedKey
                      ? t('settings.email.keySavedPlaceholder')
                      : t('settings.email.keyPlaceholder')
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="input"
                />
                <p className="text-xs text-muted">
                  {hasSavedKey ? t('settings.email.keySaved') : t('settings.email.keyHint')}
                </p>
              </div>

              <div className="field">
                <label htmlFor="settings-email-from">{t('settings.email.from')}</label>
                <input
                  id="settings-email-from"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder={t('settings.email.fromPlaceholder')}
                  className="input"
                />
                <p className="text-xs text-muted">{t('settings.email.fromHint')}</p>
              </div>

              <div className="field">
                <label htmlFor="settings-email-reply-to">{t('settings.email.replyTo')}</label>
                <input
                  id="settings-email-reply-to"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder={t('settings.email.replyToPlaceholder')}
                  className="input"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {settings.provider === 'sink'
                ? t('settings.email.demoStatus')
                : t('settings.email.activeStatus')}
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
                <Mail className="h-3.5 w-3.5" />
              )}
              {saving ? t('common.saving') : t('settings.email.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
