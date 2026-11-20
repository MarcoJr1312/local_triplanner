'use client';

// Modal de edicion de perfil: nombre + foto (subir/cambiar/quitar).

import { useEffect, useRef, useState } from 'react';
import { Bot, Camera, ChevronDown, LoaderCircle, Mail, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import type { EmailSettings, LlmSettings } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import Avatar from './Avatar';
import Modal from './Modal';
import InterestsPicker from './InterestsPicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

const MAX_BYTES = 5 * 1024 * 1024;

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { t, locale, setLocale } = useI18n();
  const { user, setProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[] | null>(null);
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [editingInterests, setEditingInterests] = useState(false);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [llmProvider, setLlmProvider] = useState('none');
  const [llmKey, setLlmKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmOpen, setLlmOpen] = useState(true);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [emailSettings, setEmailSettings] = useState<EmailSettings | null>(null);
  const [emailProvider, setEmailProvider] = useState('sink');
  const [emailKey, setEmailKey] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailReplyTo, setEmailReplyTo] = useState('');
  const [emailOpen, setEmailOpen] = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Cargar intereses cada vez que se abre el modal (el picker se monta cuando
  // ya hay datos, así su estado inicial siempre está prellenado).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInterests(null);
    api
      .getMyInterests()
      .then((terms) => {
        if (!cancelled) setInterests(terms);
      })
      .catch(() => {
        if (!cancelled) setInterests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cargar el estado del proveedor LLM. La clave nunca vuelve del servidor.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLlm(null);
    setLlmKey('');
    setLlmError(null);
    api
      .getLlmSettings()
      .then((settings) => {
        if (cancelled) return;
        setLlm(settings);
        setLlmProvider(settings.provider);
        setLlmModel(settings.model);
        setLlmBaseUrl(settings.baseUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setLlm({ provider: 'none', model: '', baseUrl: '', hasKey: false, demo: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cargar la configuración BYOK de email. La clave nunca vuelve del servidor.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEmailSettings(null);
    setEmailKey('');
    setEmailError(null);
    api
      .getEmailSettings()
      .then((settings) => {
        if (cancelled) return;
        setEmailSettings(settings);
        setEmailProvider(settings.provider);
        setEmailFrom(settings.from);
        setEmailReplyTo(settings.replyTo);
      })
      .catch(() => {
        if (!cancelled) {
          setEmailSettings({ provider: 'sink', from: '', replyTo: '', hasKey: false, ready: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Sincronizar estado al abrir.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setName(user?.displayName ?? '');
    setLanguage(locale);
    setPreviewUrl(user?.avatarUrl ?? null);
    setPendingDataUrl(null);
    setRemoveAvatar(false);
    setError(null);
    setInterests(null);
    setEditingInterests(false);
    setLlmProvider('none');
    setLlmKey('');
    setLlmModel('');
    setLlmBaseUrl('');
    setLlmError(null);
    setEmailProvider('sink');
    setEmailKey('');
    setEmailFrom('');
    setEmailReplyTo('');
    setEmailError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError(t('profile.errorFormat'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('profile.errorTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPreviewUrl(dataUrl);
      setPendingDataUrl(dataUrl);
      setRemoveAvatar(false);
      setError(null);
    };
    reader.onerror = () => setError(t('profile.errorRead'));
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    setPreviewUrl(null);
    setPendingDataUrl(null);
    setRemoveAvatar(true);
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('profile.errorNameRequired'));
      return;
    }
    setSaving(true);
    try {
      const profile = await api.updateMyProfile({
        displayName: name.trim(),
        avatarDataUrl: pendingDataUrl,
        avatarRemove: removeAvatar ? true : null,
        language,
      });
      await setProfile(profile);
      setLocale(language);
      toast.success(t('profile.savedToast'));
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInterests = async (terms: string[]) => {
    const saved = await api.setMyInterests(terms);
    setInterests(saved);
    setEditingInterests(false);
  };

  const llmNeedsKey = ['deepseek', 'openai', 'anthropic'].includes(llmProvider);
  const llmHasSavedKey = Boolean(llm?.hasKey && llm.provider === llmProvider);
  const llmCanSave = !llmSaving && (!llmNeedsKey || llmKey.trim().length > 0 || llmHasSavedKey);

  const handleSaveLlm = async () => {
    setLlmError(null);
    if (llmNeedsKey && !llmKey.trim() && !llmHasSavedKey) {
      setLlmError(t('settings.llm.keyRequired'));
      return;
    }
    setLlmSaving(true);
    try {
      const saved = await api.updateLlmSettings({
        provider: llmProvider,
        apiKey: llmKey.trim() || null,
        model: llmModel.trim(),
        baseUrl: llmBaseUrl.trim(),
      });
      setLlm(saved);
      setLlmProvider(saved.provider);
      setLlmModel(saved.model);
      setLlmBaseUrl(saved.baseUrl);
      setLlmKey('');
      toast.success(t('settings.llm.saved'));
    } catch (err) {
      setLlmError(localizeApiError(err, t));
    } finally {
      setLlmSaving(false);
    }
  };

  const emailNeedsKey = emailProvider === 'resend';
  const emailHasSavedKey = Boolean(emailSettings?.hasKey);
  const emailCanSave = !emailSaving && (!emailNeedsKey || emailKey.trim().length > 0 || emailHasSavedKey);

  const handleSaveEmail = async () => {
    setEmailError(null);
    if (emailNeedsKey && !emailKey.trim() && !emailHasSavedKey) {
      setEmailError(t('settings.email.keyRequired'));
      return;
    }
    if (emailNeedsKey && !emailFrom.trim()) {
      setEmailError(t('settings.email.fromRequired'));
      return;
    }
    setEmailSaving(true);
    try {
      const saved = await api.updateEmailSettings({
        provider: emailProvider,
        apiKey: emailKey.trim() || null,
        from: emailFrom.trim(),
        replyTo: emailReplyTo.trim(),
        clearKey: emailProvider === 'sink',
      });
      setEmailSettings(saved);
      setEmailProvider(saved.provider);
      setEmailFrom(saved.from);
      setEmailReplyTo(saved.replyTo);
      setEmailKey('');
      toast.success(t('settings.email.saved'));
    } catch (err) {
      setEmailError(localizeApiError(err, t));
    } finally {
      setEmailSaving(false);
    }
  };

  const displayUser = { displayName: name || '?', avatarUrl: previewUrl, color: user?.color ?? null };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.title')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <div className="flex flex-col items-center gap-3">
          <Avatar user={displayUser} size="lg" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-ghost btn-sm"
            >
              <Camera className="h-3.5 w-3.5" />
              {previewUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
            </button>
            {previewUrl && (
              <button
                type="button"
                onClick={handleRemove}
                className="btn btn-ghost btn-sm text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('profile.removePhoto')}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <p className="text-xs text-muted-foreground">{t('profile.photoHint')}</p>
        </div>

        <div className="field">
          <label htmlFor="profile-name">{t('profile.name')}</label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder={t('profile.namePlaceholder')}
            className="input"
          />
        </div>

        <div className="field">
          <label htmlFor="profile-language">{t('profile.language')}</label>
          <Select value={language} onValueChange={(v) => setLanguage(v as Locale)}>
            <SelectTrigger id="profile-language" className="input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es">{t('profile.languageEs')}</SelectItem>
              <SelectItem value="en">{t('profile.languageEn')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted">{t('profile.languageHint')}</p>
        </div>

        <section className="border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (editingInterests) setEditingInterests(false);
                setInterestsOpen((v) => !v);
              }}
              aria-expanded={interestsOpen}
              aria-controls="profile-interests-body"
              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
            >
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {t('interests.section')}
              </h3>
              {interests !== null && interests.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {t('interests.count', { n: interests.length })}
                </span>
              )}
              <ChevronDown
                className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${interestsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingInterests(true);
                setInterestsOpen(true);
              }}
              aria-label={t('interests.addMore')}
              title={t('interests.addMore')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {interestsOpen && (
            <div id="profile-interests-body" className="mt-3">
              {interests === null ? (
                <div className="flex items-center justify-center py-6">
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : editingInterests ? (
                <InterestsPicker initial={interests} onSave={handleSaveInterests} />
              ) : interests.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('interests.emptyList')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {interests.map((term) => (
                    <span
                      key={term}
                      className="rounded-full border border-brand-500/25 bg-brand-600/10 px-3 py-1 text-sm font-medium text-brand-700 dark:text-brand-300"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setLlmOpen((v) => !v)}
            aria-expanded={llmOpen}
            aria-controls="profile-llm-body"
            className="flex w-full items-center gap-2 py-1 text-left"
          >
            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.llm.section')}
            </h3>
            {llm && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
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
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${llmOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {llmOpen && (
            <div id="profile-llm-body" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{t('settings.llm.hint')}</p>
              {llm === null ? (
                <div className="flex items-center justify-center py-4">
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="llm-provider">{t('settings.llm.provider')}</label>
                    <Select
                      value={llmProvider}
                      onValueChange={(value) => {
                        if (value !== llmProvider) {
                          setLlmKey('');
                          setLlmModel('');
                          setLlmBaseUrl('');
                        }
                        setLlmProvider(value);
                        setLlmError(null);
                      }}
                    >
                      <SelectTrigger id="llm-provider" className="input">
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

                  {llmNeedsKey && (
                    <div className="field">
                      <label htmlFor="llm-key">{t('settings.llm.key')}</label>
                      <input
                        id="llm-key"
                        type="password"
                        value={llmKey}
                        onChange={(e) => setLlmKey(e.target.value)}
                        placeholder={
                          llmHasSavedKey
                            ? t('settings.llm.keySavedPlaceholder')
                            : t('settings.llm.keyPlaceholder')
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className="input"
                      />
                      <p className="text-xs text-muted">
                        {llmHasSavedKey ? t('settings.llm.keySaved') : t('settings.llm.keyHint')}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="field">
                      <label htmlFor="llm-model">{t('settings.llm.model')}</label>
                      <input
                        id="llm-model"
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        placeholder={t('settings.llm.modelPlaceholder')}
                        className="input"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="llm-base-url">{t('settings.llm.baseUrl')}</label>
                      <input
                        id="llm-base-url"
                        value={llmBaseUrl}
                        onChange={(e) => setLlmBaseUrl(e.target.value)}
                        placeholder={t('settings.llm.baseUrlPlaceholder')}
                        className="input"
                      />
                    </div>
                  </div>

                  {llmProvider === 'ollama' && (
                    <p className="text-xs text-muted-foreground">{t('settings.llm.ollamaHint')}</p>
                  )}
                  {llmError && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{llmError}</p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {llm.demo ? t('settings.llm.demoStatus') : t('settings.llm.activeStatus')}
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveLlm}
                      disabled={!llmCanSave}
                      className="btn btn-primary btn-sm"
                    >
                      {llmSaving ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Bot className="h-3.5 w-3.5" />
                      )}
                      {llmSaving ? t('common.saving') : t('settings.llm.save')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setEmailOpen((v) => !v)}
            aria-expanded={emailOpen}
            aria-controls="profile-email-body"
            className="flex w-full items-center gap-2 py-1 text-left"
          >
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {t('settings.email.section')}
            </h3>
            {emailSettings && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  emailSettings.provider === 'sink'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {emailSettings.provider === 'sink'
                  ? t('settings.email.demoBadge')
                  : t('settings.email.activeBadge')}
              </span>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${emailOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {emailOpen && (
            <div id="profile-email-body" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{t('settings.email.hint')}</p>
              {emailSettings && !emailSettings.ready && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t('settings.email.unavailable')}
                </p>
              )}
              {emailSettings === null ? (
                <div className="flex items-center justify-center py-4">
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="email-provider">{t('settings.email.provider')}</label>
                    <Select
                      value={emailProvider}
                      onValueChange={(value) => {
                        if (value !== emailProvider) setEmailKey('');
                        setEmailProvider(value);
                        setEmailError(null);
                      }}
                    >
                      <SelectTrigger id="email-provider" className="input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sink">{t('settings.email.providerSink')}</SelectItem>
                        <SelectItem value="resend">{t('settings.email.providerResend')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {emailNeedsKey && (
                    <>
                      <div className="field">
                        <label htmlFor="email-key">{t('settings.email.key')}</label>
                        <input
                          id="email-key"
                          type="password"
                          value={emailKey}
                          onChange={(e) => setEmailKey(e.target.value)}
                          placeholder={
                            emailHasSavedKey
                              ? t('settings.email.keySavedPlaceholder')
                              : t('settings.email.keyPlaceholder')
                          }
                          autoComplete="off"
                          spellCheck={false}
                          className="input"
                        />
                        <p className="text-xs text-muted">
                          {emailHasSavedKey ? t('settings.email.keySaved') : t('settings.email.keyHint')}
                        </p>
                      </div>

                      <div className="field">
                        <label htmlFor="email-from">{t('settings.email.from')}</label>
                        <input
                          id="email-from"
                          value={emailFrom}
                          onChange={(e) => setEmailFrom(e.target.value)}
                          placeholder={t('settings.email.fromPlaceholder')}
                          className="input"
                        />
                        <p className="text-xs text-muted">{t('settings.email.fromHint')}</p>
                      </div>

                      <div className="field">
                        <label htmlFor="email-reply-to">{t('settings.email.replyTo')}</label>
                        <input
                          id="email-reply-to"
                          value={emailReplyTo}
                          onChange={(e) => setEmailReplyTo(e.target.value)}
                          placeholder={t('settings.email.replyToPlaceholder')}
                          className="input"
                        />
                      </div>
                    </>
                  )}

                  {emailError && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{emailError}</p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {emailSettings.provider === 'sink'
                        ? t('settings.email.demoStatus')
                        : t('settings.email.activeStatus')}
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveEmail}
                      disabled={!emailCanSave}
                      className="btn btn-primary btn-sm"
                    >
                      {emailSaving ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Mail className="h-3.5 w-3.5" />
                      )}
                      {emailSaving ? t('common.saving') : t('settings.email.save')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <p className="text-xs text-muted-foreground">{t('profile.hint')}</p>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
