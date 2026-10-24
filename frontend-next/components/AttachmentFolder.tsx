'use client';

// Folder de adjunto (variante B · pestaña izquierda): una sola forma
// (pestaña + tapa compacta), nombre SOLO en la pestaña. La pestaña abre el
// visor a pantalla completa (AttachmentViewer) — el archivo se ve solo,
// sin el panel de la actividad. Las acciones del uploader (permisos, borrar)
// se muestran junto al nombre, fuera del botón para no anidar controles.

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Attachment } from '@/lib/types';

interface AttachmentFolderProps {
  attachment: Attachment;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}

export default function AttachmentFolder({ attachment, open, onToggle, actions }: AttachmentFolderProps) {
  const { t } = useI18n();

  return (
    <div className="relative flex flex-col pt-[30px]">
      <div className="absolute left-0 top-0 z-[3] flex max-w-full items-start gap-0.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t('attachments.openClose', { name: attachment.fileName })}
          className={
            'flex h-[30px] min-w-[132px] max-w-[230px] items-start gap-1.5 overflow-hidden rounded-[9px_9px_4px_4px] border-t border-border bg-secondary px-3 pt-2 transition duration-150 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40' +
            (open ? ' brightness-105' : '')
          }
        >
          <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-brand-600" />
          <span className="min-w-0 truncate text-[11.5px] font-semibold leading-snug text-foreground">
            {attachment.fileName}
          </span>
        </button>
        {actions && <div className="flex h-[30px] items-center gap-0.5">{actions}</div>}
      </div>

      <div className="relative z-[1] min-h-4 rounded-[4px_14px_14px_14px] border border-border bg-secondary" />
    </div>
  );
}
