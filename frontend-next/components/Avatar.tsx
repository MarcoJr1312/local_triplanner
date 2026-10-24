'use client';

// Avatar reutilizable: foto si existe, si no inicial sobre circulo de color.

import { useI18n } from '@/lib/i18n';
import type { UserProfile } from '@/lib/types';

interface AvatarProps {
  user: Pick<UserProfile, 'displayName' | 'avatarUrl' | 'color'> | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-16 w-16 text-2xl',
};

const FALLBACK_COLORS = ['#6C3BFF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

function colorFor(user: Pick<UserProfile, 'color'> | null | undefined): string {
  if (user?.color && /^#[0-9a-fA-F]{6}$/.test(user.color)) return user.color;
  const seed = user?.color ?? '';
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length] ?? '#6C3BFF';
}

export default function Avatar({ user, size = 'md', className = '' }: AvatarProps) {
  const { t } = useI18n();
  const sizeCls = SIZES[size] ?? SIZES.md;
  const initial = (user?.displayName ?? '?').trim().slice(0, 1).toUpperCase() || '?';

  if (user?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.displayName ?? t('common.avatar')}
        className={`${sizeCls} shrink-0 rounded-full object-cover ring-2 ring-card shadow-sm ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeCls} flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-card shadow-sm ${className}`}
      style={{ background: colorFor(user) }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
