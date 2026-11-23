'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Member, TripItem } from '@/lib/types';
import Modal from './Modal';

interface ReminderDialogProps {
  open: boolean;
  tripId: string;
  item: TripItem | null;
  members: Member[];
  currentUserId: string | null;
  onClose: () => void;
  onSaved: (item: TripItem) => void;
}

const LEADS = [15, 30, 60, 120];

export default function ReminderDialog({
  open,
  tripId,
  item,
  members,
  currentUserId,
  onClose,
  onSaved,
}: ReminderDialogProps) {
  const { t } = useI18n();
  const [time, setTime] = useState('10:00');
  const [lead, setLead] = useState(60);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setTime(item.startTime ?? '10:00');
    setLead(item.reminder?.leadMinutes ?? 60);
    setRecipients(
      item.reminder?.recipientIds?.length
        ? item.reminder.recipientIds
        : currentUserId
          ? [currentUserId]
          : [],
    );
    setError(null);
    setSaving(false);
  }, [open, item, currentUserId]);

  if (!item) return null;

  const toggleRecipient = (userId: string) => {
    setRecipients((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId],
    );
  };

  const save = async () => {
    setError(null);
    if (!time) {
      setError(t('reminders.timeRequired'));
      return;
    }
    if (recipients.length === 0) {
      setError(t('reminders.recipientsRequired'));
      return;
    }
    setSaving(true);
    try {
      const updated = await api.setItemReminder(tripId, item.id, {
        enabled: true,
        leadMinutes: lead,
        recipientIds: recipients,
        startTime: time,
      });
      toast.success(t('reminders.enabledToast'));
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setError(null);
    setSaving(true);
    try {
      const updated = await api.setItemReminder(tripId, item.id, { enabled: false });
      toast.success(t('reminders.disabledToast'));
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('reminders.title')} size="md">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-sm text-muted-foreground">{t('reminders.subtitle')}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t('reminders.time')}</span>
            <input
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t('reminders.lead')}</span>
            <select
              value={lead}
              onChange={(event) => setLead(Number(event.target.value))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            >
              {LEADS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t('reminders.leadOption', { minutes })}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            {t('reminders.recipients')}
          </legend>
          <p className="text-xs text-muted-foreground">{t('reminders.recipientsHint')}</p>
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border p-2">
            {members.map((member) => (
              <label
                key={member.userId}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500/40"
                  checked={recipients.includes(member.userId)}
                  onChange={() => toggleRecipient(member.userId)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {member.displayName}
                  {member.userId === currentUserId ? ` ${t('reminders.you')}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">{member.role}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {item.reminder?.enabled ? (
            <button
              type="button"
              onClick={() => void disable()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-input px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
            >
              <BellOff className="h-4 w-4" /> {t('reminders.disable')}
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition hover:bg-muted"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              <Bell className="h-4 w-4" /> {t('reminders.enable')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
