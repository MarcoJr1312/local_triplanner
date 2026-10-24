'use client';

// Selector de visibilidad de un adjunto, compartido por la subida y la
// edicion de permisos: checkboxes de los otros miembros + "Todos los
// miembros". Es controlado: el padre guarda la seleccion.

import { useI18n } from '@/lib/i18n';
import type { Member } from '@/lib/types';

interface AttachmentVisibilityPickerProps {
  members: Member[];
  currentUserId: string | null;
  selectedViewerIds: string[];
  onChange: (viewerIds: string[]) => void;
  disabled?: boolean;
}

export default function AttachmentVisibilityPicker({
  members,
  currentUserId,
  selectedViewerIds,
  onChange,
  disabled = false,
}: AttachmentVisibilityPickerProps) {
  const { t } = useI18n();
  const otherMembers = members.filter((m) => m.userId !== currentUserId);
  const allSelected =
    otherMembers.length > 0 && otherMembers.every((m) => selectedViewerIds.includes(m.userId));

  const toggleViewer = (userId: string) => {
    onChange(
      selectedViewerIds.includes(userId)
        ? selectedViewerIds.filter((id) => id !== userId)
        : [...selectedViewerIds, userId]
    );
  };

  const toggleAll = () => {
    onChange(allSelected ? [] : otherMembers.map((m) => m.userId));
  };

  if (otherMembers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
        {t('attachments.noOtherMembers')}
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('attachments.visibility')}
      className="rounded-xl border border-border bg-muted/30 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{t('attachments.visibility')}</p>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded border-border text-brand-600 focus:ring-brand-500/40 disabled:opacity-60"
          />
          {t('attachments.allMembers')}
        </label>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {otherMembers.map((member) => (
          <label
            key={member.userId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-foreground/90 transition duration-150 hover:bg-muted/60"
          >
            <input
              type="checkbox"
              checked={selectedViewerIds.includes(member.userId)}
              onChange={() => toggleViewer(member.userId)}
              disabled={disabled}
              className="h-3.5 w-3.5 rounded border-border text-brand-600 focus:ring-brand-500/40 disabled:opacity-60"
            />
            <span className="min-w-0 truncate">{member.displayName}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
