'use client';

import { useEffect, useState } from 'react';
import { Bot, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { LlmSettings } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function LlmSettingsCard() {
  const { t } = useI18n();
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState('none');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLlmSettings()
      .then((settings) => {
        if (cancelled) return;
        setLlm(settings);
        setProvider(settings.provider);
        setModel(settings.model);
        setBaseUrl(settings.baseUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setLlm({ provider: 'none', model: '', baseUrl: '', hasKey: false, demo: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsKey = ['deepseek', 'openai', 'anthropic'].includes(provider);
  const hasSavedKey = Boolean(llm?.hasKey && llm.provider === provider);
  const canSave = !saving && (!needsKey || key.trim().length > 0 || hasSavedKey);

  const handleSave = async () => {
    setError(null);
    if (needsKey && !key.trim() && !hasSavedKey) {
      setError(t('settings.llm.keyRequired'));
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateLlmSettings({
        provider,
        apiKey: key.trim() || null,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
      });
      setLlm(saved);
      setProvider(saved.provider);
      setModel(saved.model);
      setBaseUrl(saved.baseUrl);
      setKey('');
      toast.success(t('settings.llm.saved'));
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card border-l-4 border-l-violet-500/70 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.llm.section')}
            </h2>
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t('settings.serviceBadge.agent')}
            </span>
            <span className="rounded-full border border-brand-500/25 bg-brand-600/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              {t('settings.byok')}
            </span>
            {llm && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  llm.demo
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {llm.demo
                  ? t('settings.llm.demoBadge')
                  : t('settings.llm.activeBadge', { provider: llm.provider })}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('settings.llm.hint')}
          </p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.byokAgentHint')}</p>
        </div>
      </div>

      {llm === null ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="field">
            <label htmlFor="settings-llm-provider">{t('settings.llm.provider')}</label>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value !== provider) {
                  setKey('');
                  setModel('');
                  setBaseUrl('');
                }
                setProvider(value);
                setError(null);
              }}
            >
              <SelectTrigger id="settings-llm-provider" className="input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('settings.llm.providerNone')}</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="ollama">{t('settings.llm.providerOllama')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsKey && (
            <div className="field">
              <label htmlFor="settings-llm-key">{t('settings.llm.key')}</label>
              <input
                id="settings-llm-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  hasSavedKey
                    ? t('settings.llm.keySavedPlaceholder')
                    : t('settings.llm.keyPlaceholder')
                }
                autoComplete="off"
                spellCheck={false}
                className="input"
              />
              <p className="text-xs text-muted">
                {hasSavedKey ? t('settings.llm.keySaved') : t('settings.llm.keyHint')}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="settings-llm-model">{t('settings.llm.model')}</label>
              <input
                id="settings-llm-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('settings.llm.modelPlaceholder')}
                className="input"
              />
            </div>
            <div className="field">
              <label htmlFor="settings-llm-base-url">{t('settings.llm.baseUrl')}</label>
              <input
                id="settings-llm-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('settings.llm.baseUrlPlaceholder')}
                className="input"
              />
            </div>
          </div>

          {provider === 'ollama' && (
            <p className="text-xs text-muted-foreground">{t('settings.llm.ollamaHint')}</p>
          )}
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {llm.demo ? t('settings.llm.demoStatus') : t('settings.llm.activeStatus')}
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
                <Bot className="h-3.5 w-3.5" />
              )}
              {saving ? t('common.saving') : t('settings.llm.save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
