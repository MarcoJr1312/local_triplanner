'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Plus, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import Avatar from '@/components/Avatar';
import InterestsPicker from '@/components/InterestsPicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MAX_BYTES = 5 * 1024 * 1024;

export default function AccountSettingsCard() {
  const { t, locale, setLocale } = useI18n();
  const { user, setProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.displayName ?? '');
  const [language, setLanguage] = useState<Locale>(locale);
  const [previewUrl, setPreviewUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[] | null>(null);
  const [editingInterests, setEditingInterests] = useState(false);

  useEffect(() => {
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
  }, []);

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
      setPreviewUrl(String(reader.result));
      setPendingDataUrl(String(reader.result));
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
      setPendingDataUrl(null);
      setRemoveAvatar(false);
      toast.success(t('profile.savedToast'));
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

  const displayUser = { displayName: name || '?', avatarUrl: previewUrl, color: user?.color ?? null };

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
          <UserRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t('settings.accountTitle')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('settings.accountHint')}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center gap-3 border-b border-border pb-5">
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

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="settings-name">{t('profile.name')}</label>
          <input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder={t('profile.namePlaceholder')}
            className="input"
          />
        </div>
        <div className="field">
          <label htmlFor="settings-language">{t('profile.language')}</label>
          <Select value={language} onValueChange={(v) => setLanguage(v as Locale)}>
            <SelectTrigger id="settings-language" className="input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es">{t('profile.languageEs')}</SelectItem>
              <SelectItem value="en">{t('profile.languageEn')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted">{t('profile.languageHint')}</p>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {t('interests.section')}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {interests === null ? t('common.loading') : t('interests.count', { n: interests.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditingInterests(true)}
            className="btn btn-ghost btn-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('interests.addMore')}
          </button>
        </div>

        <div className="mt-4">
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
      </div>

      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </section>
  );
}
