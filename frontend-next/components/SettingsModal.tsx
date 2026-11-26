'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, ImagePlus, LogOut, Trash2 } from 'lucide-react';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { normalizeDateRange } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import type { Trip } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TRIP_COVER_PRESETS } from '@/lib/trip-presets';
import Modal from './Modal';
import LeaveTripDialog from './LeaveTripDialog';
import DeleteTripDialog from './DeleteTripDialog';

interface SettingsModalProps {
  open: boolean;
  trip: Trip | null;
  onClose: () => void;
}

const MAX_COVER_BYTES = 5 * 1024 * 1024;

export default function SettingsModal({ open, trip, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [coverPreset, setCoverPreset] = useState<string | null>(null);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [showLeave, setShowLeave] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setCoverPreset(trip.coverPreset ?? null);
    setCoverPhotoUrl(trip.coverPhotoUrl ?? null);
  }, [trip]);

  if (!trip) return null;

  const isOwner = user?.userId === trip.ownerId;

  const handleStartDate = (value: string) => {
    const next = normalizeDateRange(value, endDate);
    setStartDate(next.start);
    setEndDate(next.end);
  };

  const handleEndDate = (value: string) => {
    if (!value) {
      setEndDate('');
      return;
    }
    setEndDate(startDate && value < startDate ? startDate : value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate || startDate > endDate) {
      setError(t('errors.invalidDateRange'));
      return;
    }
    setSaving(true);
    try {
      await api.updateTripSettings(trip.id, {
        name: name.trim() || trip.name,
        startDate,
        endDate,
      });
      toast.success(t('settings.savedToast'));
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPreset = async (presetId: string) => {
    setCoverError(null);
    setCoverSaving(true);
    try {
      await api.updateTripCover(trip.id, { coverPreset: presetId });
      setCoverPreset(presetId);
      setCoverPhotoUrl(null);
      toast.success(t('cover.savedToast'));
    } catch (err) {
      setCoverError(localizeApiError(err, t));
    } finally {
      setCoverSaving(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setCoverError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setCoverError(t('cover.errorFormat'));
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCoverError(t('cover.errorTooLarge'));
      return;
    }
    setCoverSaving(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        await api.updateTripCover(trip.id, { coverPhotoDataUrl: dataUrl });
        setCoverPhotoUrl(dataUrl);
        setCoverPreset(null);
        toast.success(t('cover.savedToast'));
      } catch (err) {
        setCoverError(localizeApiError(err, t));
      } finally {
        setCoverSaving(false);
      }
    };
    reader.onerror = () => {
      setCoverError(t('cover.errorRead'));
      setCoverSaving(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = async () => {
    setCoverError(null);
    setCoverSaving(true);
    try {
      await api.updateTripCover(trip.id, { removePhoto: true });
      setCoverPhotoUrl(null);
      setCoverPreset(null);
      toast.success(t('cover.savedToast'));
    } catch (err) {
      setCoverError(localizeApiError(err, t));
    } finally {
      setCoverSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.title')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="settings-form"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <form id="settings-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="settings-name" className="mb-1 block text-sm font-medium text-foreground">
              {t('trips.name')}
            </label>
            <input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-start" className="mb-1 block text-sm font-medium text-foreground">
                {t('trips.startDate')}
              </label>
              <input
                id="settings-start"
                type="date"
                value={startDate}
                onChange={(e) => handleStartDate(e.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label htmlFor="settings-end" className="mb-1 block text-sm font-medium text-foreground">
                {t('trips.endDate')}
              </label>
              <input
                id="settings-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => handleEndDate(e.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </form>

        {isOwner && (
          <section className="border-t border-border pt-5">
            <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">{t('cover.title')}</h3>
            <div className="grid grid-cols-4 gap-2">
              {TRIP_COVER_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const active = !coverPhotoUrl && coverPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    disabled={coverSaving}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border p-1.5 transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60',
                      active
                        ? 'border-brand-500 ring-2 ring-brand-500/30'
                        : 'border-border hover:border-muted-foreground/30'
                    )}
                  >
                    <span className={cn('relative flex aspect-square w-full items-center justify-center rounded-lg', preset.gradient)}>
                      <Icon className="h-5 w-5 text-white/90" strokeWidth={1.5} />
                      {active && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25">
                          <Check className="h-5 w-5 text-white" strokeWidth={2.5} />
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-center text-[10px] font-medium leading-tight text-muted-foreground">
                      {t(preset.nameKey)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={coverSaving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-xs font-medium text-foreground transition duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60 max-sm:min-h-11"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {coverSaving ? t('cover.uploading') : t('cover.uploadPhoto')}
              </button>
              {coverPhotoUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={coverSaving}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-xs font-medium text-rose-600 transition duration-150 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-60 dark:text-rose-400 dark:hover:bg-rose-500/15 max-sm:min-h-11"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('cover.removePhoto')}
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

            {coverPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverPhotoUrl}
                alt=""
                className="mt-3 aspect-[16/9] w-full rounded-xl border border-border object-cover"
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t('cover.photoHint')}</p>
            {coverError && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{coverError}</p>}
          </section>
        )}

        <section className="border-t border-border pt-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            {t('tripSettings.dangerZone')}
          </h3>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowLeave(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-sm font-medium text-foreground transition duration-150 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 max-sm:min-h-11"
            >
              <LogOut className="h-4 w-4" />
              {t('tripSettings.leaveTrip')}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2 text-sm font-semibold text-rose-600 transition duration-150 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20 max-sm:min-h-11"
              >
                <Trash2 className="h-4 w-4" />
                {t('tripSettings.deleteTrip')}
              </button>
            )}
          </div>
        </section>
      </div>

      <LeaveTripDialog open={showLeave} trip={trip} onClose={() => setShowLeave(false)} />
      <DeleteTripDialog open={showDelete} trip={trip} onClose={() => setShowDelete(false)} />
    </Modal>
  );
}
