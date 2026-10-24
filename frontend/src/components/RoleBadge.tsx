import type { MemberRole } from '../lib/types';

const ROLE_META: Record<MemberRole, { label: string; className: string }> = {
  owner: { label: 'Propietario', className: 'bg-brand-100 text-brand-700' },
  editor: { label: 'Editor', className: 'bg-indigo-100 text-indigo-700' },
  viewer: { label: 'Espectador', className: 'bg-slate-100 text-slate-600' },
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Espectador',
};

export default function RoleBadge({ role }: { role: MemberRole }) {
  const meta = ROLE_META[role];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
}
