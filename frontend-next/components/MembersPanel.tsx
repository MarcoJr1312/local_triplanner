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
    <div className="side-card card">
      <div className="side-head">
        <h3>
          {t('members.title')}
          <span className="mono" style={{ marginLeft: 8 }}>{trip.members.length}</span>
        </h3>
        {canManage && (
          <button
            type="button"
            onClick={onInvite}
            className="btn btn-soft btn-sm"
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0" /> {t('members.invite')}
          </button>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <PresenceDots presence={presence} currentUserId={currentUserId} />
        {onlineIds.size > 0 && (
          <span className="shrink-0 text-[11px] font-medium text-[var(--success)]">
            {t('members.onlineCount', { n: onlineIds.size })}
          </span>
        )}
      </div>

      <ul>
        {sorted.map((m) => {
          const isMe = m.userId === currentUserId;
          const online = onlineIds.has(m.userId);
          const canEditRole = isOwner && m.userId !== trip.ownerId && !isMe;
          return (
            <li key={m.userId} className="member-row">
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
                <p className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground">
                  {m.displayName}
                  {isMe && <span className="text-[10px] font-normal text-muted">{t('members.you')}</span>}
                  {m.role === 'owner' && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                </p>
                <p className="truncate text-[10.5px] text-muted">{m.email}</p>
                {online && (
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-[var(--success)]">
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
                  className="fav"
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
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', marginTop: 12 }}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" /> {t('members.leave')}
        </button>
      )}

      <LeaveTripDialog open={showLeave} trip={trip} onClose={() => setShowLeave(false)} />
    </div>
  );
}
