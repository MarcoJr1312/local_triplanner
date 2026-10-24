'use client';

import { useState } from 'react';
import { UserPlus, LogOut, Crown, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Member, MemberRole, Presence, Trip } from '@/lib/types';
import RoleBadge, { ROLE_LABEL_KEYS } from './RoleBadge';
import PresenceDots from './PresenceDots';
import Avatar from './Avatar';
import LeaveTripDialog from './LeaveTripDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MembersPanelProps {
  trip: Trip;
  presence: Presence[];
  currentUserId: string | null;
  onInvite: () => void;
  onLeft: () => void;
}

const ROLE_ORDER: MemberRole[] = ['owner', 'editor', 'viewer'];

export default function MembersPanel({ trip, presence, currentUserId, onInvite, onLeft }: MembersPanelProps) {
  const { t } = useI18n();
  const myMember = trip.members.find((m) => m.userId === currentUserId);
  const canManage = myMember?.role === 'owner' || myMember?.role === 'editor';
  const isOwner = myMember?.role === 'owner';

  const onlineIds = new Set((presence ?? []).map((p) => p.userId));

  const [showLeave, setShowLeave] = useState(false);

  const handleRoleChange = async (userId: string, role: MemberRole) => {
    try {
      await api.updateMemberRole(trip.id, userId, role);
    } catch {
      // store refresh reflects real state; avisa al usuario
      toast.error(t('members.errorRole'));
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await api.removeMember(trip.id, userId);
    } catch {
      toast.error(t('members.errorRemove'));
    }
  };

  const handleLeave = () => {
    // Salir SIEMPRE pasa por el diálogo de confirmación (transferencia si es owner).
    setShowLeave(true);
  };

  const sorted = [...trip.members].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
          {t('members.title')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {trip.members.length}
          </span>
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={onInvite}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition duration-150 max-sm:min-h-11 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0" /> {t('members.invite')}
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-2">
        <PresenceDots presence={presence} currentUserId={currentUserId} />
        {onlineIds.size > 0 && (
          <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {t('members.onlineCount', { n: onlineIds.size })}
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {sorted.map((m) => {
          const isMe = m.userId === currentUserId;
          const online = onlineIds.has(m.userId);
          const canEditRole = isOwner && m.userId !== trip.ownerId && !isMe;
          return (
            <li key={m.userId} className="flex items-center gap-3 rounded-xl px-2 py-2 transition duration-150 hover:bg-muted/40">
              <div className="relative">
                <Avatar user={m} size="sm" />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${
                    online ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  }`}
                  title={online ? t('members.online') : t('members.offline')}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                  {m.displayName}
                  {isMe && <span className="text-xs font-normal text-muted-foreground">{t('members.you')}</span>}
                  {m.role === 'owner' && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                {online && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('members.online')}
                  </p>
                )}
              </div>

              {canEditRole ? (
                <Select value={m.role} onValueChange={(v) => handleRoleChange(m.userId, v as MemberRole)}>
                  <SelectTrigger
                    aria-label={t('members.roleAria', { name: m.displayName })}
                    className="h-7 w-auto gap-1 rounded-lg px-2 text-xs max-sm:min-h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_ORDER.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">
                        {t(ROLE_LABEL_KEYS[r])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <RoleBadge role={m.role} />
              )}

              {isOwner && !isMe && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  className="inline-flex items-center justify-center rounded-lg p-1 text-muted-foreground/70 transition duration-150 max-sm:min-h-11 max-sm:min-w-11 hover:bg-rose-50 hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                  aria-label={t('members.removeAria', { name: m.displayName })}
                >
                  <X className="h-4 w-4 shrink-0" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!isOwner && (
        <button
          type="button"
          onClick={handleLeave}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition duration-150 max-sm:min-h-11 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" /> {t('members.leave')}
        </button>
      )}

      <LeaveTripDialog open={showLeave} trip={trip} onClose={() => setShowLeave(false)} />
    </div>
  );
}
