'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { TripItem } from '@/lib/types';
import Modal from './Modal';

interface ItemEditModalProps {
  open: boolean;
  item: TripItem | null;
  tripId: string;
  onClose: () => void;
}

export default function ItemEditModal({ open, item, tripId, onClose }: ItemEditModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('0');
  const [startTime, setStartTime] = useState('');
  const [locationText, setLocationText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setCost(String(item.cost));
    setStartTime(item.startTime ?? '');
    setLocationText(item.locationText ?? '');
    setNotes(item.notes ?? '');
  }, [item]);

  if (!item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedCost = Number(cost);
    if (Number.isNaN(parsedCost) || parsedCost < 0) {
      setError(t('errors.invalidCost'));
      return;
    }
    setSaving(true);
    try {
      await api.updateItem(tripId, item.id, {
        title: title.trim() || item.title,
        startTime: startTime.trim() || null,
        notes: notes.trim() || null,
        locationText: locationText.trim() || null,
      });
      if (parsedCost !== item.cost) {
        await api.setItemCost(tripId, item.id, parsedCost);
      }
      toast.success(t('items.updatedToast'));
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('items.editTitle')}
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
            form="item-edit-form"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      }
    >
      <form id="item-edit-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-title" className="mb-1 block text-sm font-medium text-foreground">
            {t('items.title')}
          </label>
          <input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-cost" className="mb-1 block text-sm font-medium text-foreground">
              {t('items.costUsd')}
            </label>
            <input
              id="edit-cost"
              type="number"
              min={0}
              step="0.5"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label htmlFor="edit-time" className="mb-1 block text-sm font-medium text-foreground">
              {t('items.timeOptional')}
            </label>
            <input
              id="edit-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-11 w-full appearance-none rounded-xl border border-input bg-background px-3.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        <div>
          <label htmlFor="edit-location" className="mb-1 block text-sm font-medium text-foreground">
            {t('items.locationLabel')}
          </label>
          <input
            id="edit-location"
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder={t('items.locationPlaceholder')}
            maxLength={200}
            className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <label htmlFor="edit-notes" className="mb-1 block text-sm font-medium text-foreground">
            {t('items.notes')}
          </label>
          <textarea
            id="edit-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            placeholder={t('items.notesPlaceholder')}
          />
        </div>

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </form>
    </Modal>
  );
}
