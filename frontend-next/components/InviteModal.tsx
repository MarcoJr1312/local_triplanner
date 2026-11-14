'use client';

import { useState } from 'react';
import { Send, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api, localizeApiError, DEMO_FRIEND_EMAIL } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import Modal from './Modal';

type InviteRole = 'viewer' | 'editor';

const ROLE_OPTIONS: { value: InviteRole; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { value: 'viewer', labelKey: 'invite.roleViewer', descKey: 'invite.roleViewerDesc' },
  { value: 'editor', labelKey: 'invite.roleEditor', descKey: 'invite.roleEditorDesc' },
];

interface InviteModalProps {
  open: boolean;
  tripId: string;
  tripName: string;
  onClose: () => void;
}

export default function InviteModal({ open, tripId, tripName, onClose }: InviteModalProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState(DEMO_FRIEND_EMAIL);
  const [role, setRole] = useState<InviteRole>('viewer');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const reset = () => {
    setDone(false);
    setError(null);
    setEmail(DEMO_FRIEND_EMAIL);
    setRole('viewer');
    setInviteLink(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError(t('errors.invalidEmail'));
      return;
    }
    setSending(true);
    try {
      const result = await api.sendTripInvite(tripId, normalized, role);
      setInviteLink(result.joinUrl);
      toast.success(t('invite.sentToast'));
      setDone(true);
    } catch (err) {
      setError(localizeApiError(err, t));
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t('invite.copied'));
    } catch {
      setError(t('invite.copyFailed'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('invite.title')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="btn btn-ghost btn-sm"
          >
            {done ? t('common.close') : t('common.cancel')}
          </button>
          {!done && (
            <button
              type="submit"
              form="invite-form"
              disabled={sending}
              className="btn btn-primary btn-sm"
            >
              <Send className="h-4 w-4" />
              {sending ? t('invite.sending') : t('invite.send')}
            </button>
          )}
        </div>
      }
    >
      {done ? (
        <div className="py-4">
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500 dark:text-emerald-400" />
            <p className="text-sm font-medium text-foreground">{t('invite.sentTo', { email })}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('invite.willReceive', { trip: tripName })}
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3">
            <label htmlFor="invite-link" className="mb-1.5 block text-[12.5px] font-semibold text-foreground">
              {t('invite.linkLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="invite-link"
                type="text"
                readOnly
                value={inviteLink ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="input min-w-0 flex-1 text-xs"
              />
              <button type="button" onClick={copyLink} className="btn btn-primary btn-sm shrink-0">
                <Copy className="h-4 w-4" />
                {t('invite.copyLink')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">{t('invite.linkHint')}</p>
          </div>
        </div>
      ) : (
        <form id="invite-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 15 }}>
          <div className="field">
            <label htmlFor="invite-email">{t('auth.email')}</label>
            <input
              id="invite-email"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('invite.emailPlaceholder')}
              className="input"
            />
            <p className="text-xs text-muted">{t('invite.hint')}</p>
            <p className="mt-1 text-[11px] text-muted">{t('invite.defaultEmailHint')}</p>
          </div>
          <fieldset>
            <legend className="mb-1.5 block text-[12.5px] font-semibold text-foreground">
              {t('invite.roleLabel')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`dest-option flex cursor-pointer items-start gap-2.5${role === option.value ? ' active' : ''}`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={option.value}
                    checked={role === option.value}
                    onChange={() => setRole(option.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[12.5px] font-semibold text-foreground">{t(option.labelKey)}</span>
                    <span className="text-[10.5px] text-muted">{t(option.descKey)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
