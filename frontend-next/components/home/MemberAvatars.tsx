'use client';

import type { Member } from '@/lib/types';

const AVATAR_COLORS = [
  '#6C3BFF',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

function colorFor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

interface MemberAvatarsProps {
  members: Member[];
  max?: number;
}

export default function MemberAvatars({ members, max = 3 }: MemberAvatarsProps) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <div className="flex items-center">
      {shown.map((member) => (
        <span
          key={member.userId}
          title={member.displayName}
          aria-hidden
          className="-ml-1.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[0.62rem] font-semibold text-white ring-2 ring-card first:ml-0"
          style={{ background: colorFor(member.color ?? member.displayName) }}
        >
          {initials(member.displayName)}
        </span>
      ))}
      {overflow > 0 && <span className="ml-2 text-xs text-muted-foreground">+{overflow}</span>}
    </div>
  );
}
