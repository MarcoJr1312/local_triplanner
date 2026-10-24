import { UserPlus, LogOut, Crown, X } from 'lucide-react';
import { api } from '../lib/api';
import type { Member, MemberRole, Presence, Trip } from '../lib/types';
import RoleBadge, { ROLE_LABELS } from './RoleBadge';
import PresenceDots from './PresenceDots';

interface MembersPanelProps {
  trip: Trip;
  presence: Presence[];
  currentUserId: string | null;
  onInvite: () => void;
  onLeft: () => void;
}

const ROLE_ORDER: MemberRole[] = ['owner', 'editor', 'viewer'];

export default function MembersPanel({ trip, presence, currentUserId, onInvite, onLeft }: MembersPanelProps) {
  const myMember = trip.members.find((m) => m.userId === currentUserId);
  const canManage = myMember?.role === 'owner' || myMember?.role === 'editor';
  const isOwner = myMember?.role === 'owner';

  const onlineIds = new Set(presence.map((p) => p.userId));

  const handleRoleChange = async (userId: string, role: MemberRole) => {
    try {
      await api.updateMemberRole(trip.id, userId, role);
    } catch {
      // ignore; store refresh reflects real state
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await api.removeMember(trip.id, userId);
    } catch {
      // ignore
    }
  };

  const handleLeave = async () => {
    try {
      await api.leaveTrip(trip.id);
      onLeft();
    } catch {
      // ignore
    }
  };

  const sorted = [...trip.members].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
          Miembros
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-500">
            {trip.members.length}
          </span>
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={onInvite}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <UserPlus className="h-3.5 w-3.5" /> Invitar
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-2">
        <PresenceDots presence={presence} currentUserId={currentUserId} />
        {onlineIds.size > 0 && (
          <span className="shrink-0 text-xs font-medium text-emerald-600">{onlineIds.size} en línea</span>
        )}
      </div>

      <ul className="space-y-1">
        {sorted.map((m) => {
          const isMe = m.userId === currentUserId;
          const online = onlineIds.has(m.userId);
          const canEditRole = canManage && m.userId !== trip.ownerId && !isMe;
          return (
            <li key={m.userId} className="flex items-center gap-3 rounded-xl px-2 py-2 transition duration-150 hover:bg-slate-50">
              <div className="relative">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-2 ring-white"
                  style={{ backgroundColor: presence.find((p) => p.userId === m.userId)?.color ?? '#94a3b8' }}
                >
                  {m.displayName.slice(0, 1).toUpperCase()}
                </div>
                {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                  {m.displayName}
                  {isMe && <span className="text-xs font-normal text-slate-400">(tú)</span>}
                  {m.role === 'owner' && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                </p>
                <p className="truncate text-xs text-slate-400">{m.email}</p>
                {online && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> En línea
                  </p>
                )}
              </div>

              {canEditRole ? (
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.userId, e.target.value as MemberRole)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none transition duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <RoleBadge role={m.role} />
              )}

              {canManage && !isMe && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  className="rounded-lg p-1 text-slate-300 transition duration-150 hover:bg-rose-50 hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                  aria-label={`Quitar a ${m.displayName}`}
                >
                  <X className="h-4 w-4" />
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
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-500 transition duration-150 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
        >
          <LogOut className="h-3.5 w-3.5" /> Salir del viaje
        </button>
      )}
    </div>
  );
}
