'use client';

// Modal de edicion de perfil: nombre + foto (subir/cambiar/quitar).

import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
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

  const displayUser = { displayName: name || '?', avatarUrl: previewUrl, color: user?.color ?? null };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.title')}
      size="sm"
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
                      className="rounded-full border border-border bg-muted/60 px-3 py-1 text-sm text-foreground"
                    >
                      {term}
                    </span>
                  ))}
                </div>
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
