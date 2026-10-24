'use client';

// Visor de adjunto a PANTALLA COMPLETA (portal sobre todo, incluso sobre el
// modal de la actividad): al abrir un folder, el panel desaparece visualmente
// y SOLO se ve el archivo (boleto legible). Cerrar con X, clic fuera o Esc.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Image, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Attachment } from '@/lib/types';

interface AttachmentViewerProps {
  attachment: Attachment;
  onClose: () => void;
  removeButton?: React.ReactNode;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export default function AttachmentViewer({ attachment, onClose, removeButton }: AttachmentViewerProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex animate-viewer-in flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label={attachment.fileName}
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">
          {isImage(attachment.mimeType) ? <Image className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{attachment.fileName}</p>
        {removeButton}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/80 transition duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <X className="h-3.5 w-3.5" />
          {t('attachments.close')}
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {isImage(attachment.mimeType) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.fileName}
            className="max-h-full max-w-full rounded-lg object-contain"
            draggable={false}
          />
        ) : (
          <iframe
            src={`${attachment.url}#toolbar=0&navpanes=0&view=FitH`}
            title={attachment.fileName}
            className="h-full w-full rounded-lg border-0 bg-white"
          />
        )}
      </div>
    </div>,
    document.body
  );
}
