'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Trip } from '@/lib/types';
import Modal from './Modal';

interface DeleteTripDialogProps {
  open: boolean;
  trip: Trip;
  onClose: () => void;
}

export default function DeleteTripDialog({ open, trip, onClose }: DeleteTripDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmWord = t('deleteTrip.confirmWord');
  const matches = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

  const handleDelete = async () => {
    if (!matches) return;
    setError(null);
    setLoading(true);
    try {
      await api.deleteTrip(trip.id);
      toast.success(t('deleteTrip.deletedToast'));
      onClose();
      router.push('/');
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('deleteTrip.title')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60 max-sm:min-h-11"
          >
            {t('deleteTrip.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading || !matches}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-rose-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
          >
            <AlertTriangle className="h-4 w-4" />
            {loading ? t('common.saving') : t('deleteTrip.confirmButton')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
          {t('deleteTrip.warning')}
        </p>
        <div>
          <label htmlFor="delete-trip-confirm" className="mb-1 block text-sm font-medium text-foreground">
            {t('deleteTrip.confirmPlaceholder', { word: confirmWord })}
          </label>
          <input
            id="delete-trip-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={loading}
            autoComplete="off"
            className="w-full rounded-xl border border-input px-3.5 py-2.5 text-base outline-none md:text-sm transition duration-150 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
          />
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
