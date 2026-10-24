'use client';

import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { MemberRole } from '@/lib/types';

const ROLE_META: Record<MemberRole, { className: string }> = {
  owner: { className: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  editor: { className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  viewer: { className: 'bg-muted text-muted-foreground' },
};

// Clave i18n por rol; los consumidores la traducen con su propio `t`.
export const ROLE_LABEL_KEYS: Record<MemberRole, TranslationKey> = {
  owner: 'roles.owner',
  editor: 'roles.editor',
  viewer: 'roles.viewer',
};

// Labels en español para consumidores aún no migrados (p. ej. TripCard).
export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Invitado',
};

export default function RoleBadge({ role }: { role: MemberRole }) {
  const { t } = useI18n();
  const meta = ROLE_META[role];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {t(ROLE_LABEL_KEYS[role])}
    </span>
  );
}
