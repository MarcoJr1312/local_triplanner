'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import type { Trip } from '@/lib/types';
import Modal from './Modal';
import Avatar from './Avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LeaveTripDialogProps {
  open: boolean;
  trip: Trip;
  onClose: () => void;
}

export default function LeaveTripDialog({ open, trip, onClose }: LeaveTripDialogProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOwnerId, setNewOwnerId] = useState<string | null>(null);

  const isOwner = user?.userId === trip.ownerId;
  const otherMembers = trip.members.filter((m) => m.userId !== user?.userId);

  const handleLeave = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.leaveTrip(trip.id, isOwner ? (newOwnerId ?? undefined) : undefined);
      toast.success(t('leaveTrip.leftToast'));
      onClose();
      router.push('/');
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const canConfirm = isOwner ? Boolean(newOwnerId) : true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('leaveTrip.title')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60 max-sm:min-h-11"
          >
            {t('leaveTrip.cancel')}
          </button>
          {canConfirm && (
            <button
              type="button"
              onClick={handleLeave}
              disabled={loading || !canConfirm}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-rose-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:opacity-60 max-sm:min-h-11"
            >
              <LogOut className="h-4 w-4" />
              {loading ? t('common.saving') : t('leaveTrip.confirmButton')}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {isOwner ? (
          <>
            <p className="text-sm text-muted-foreground">{t('leaveTrip.ownerMustTransfer')}</p>
            {otherMembers.length === 0 ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
                {t('leaveTrip.noOtherMembers')}
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="leave-new-owner" className="mb-1 block text-sm font-medium text-foreground">
                    {t('leaveTrip.pickNewOwner')}
                  </label>
                  <Select value={newOwnerId ?? ''} onValueChange={setNewOwnerId}>
                    <SelectTrigger id="leave-new-owner" className="w-full">
                      <SelectValue placeholder={t('leaveTrip.pickNewOwner')} />
                    </SelectTrigger>
                    <SelectContent>
                      {otherMembers.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          <span className="inline-flex items-center gap-2">
                            <Avatar user={m} size="sm" />
                            {m.displayName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">{t('leaveTrip.transferExplain')}</p>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('leaveTrip.confirmText')}</p>
        )}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
