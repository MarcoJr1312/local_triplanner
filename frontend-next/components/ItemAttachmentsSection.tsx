'use client';

// Seccion de boletos/adjuntos de una actividad: subir (PDF/imagen) y ver en
// folders con pestaña. Al abrir un folder, el archivo se muestra SOLO, a
// pantalla completa (AttachmentViewer por encima del modal de la actividad).
// El uploader elige por archivo quien puede verlo (default: solo el) y puede
// editar esos permisos o borrar el archivo desde la fila.

import { useRef, useState } from 'react';
import { Eye, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, localizeApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import type { Attachment, Member, TripItem } from '@/lib/types';
import AttachmentFolder from './AttachmentFolder';
import AttachmentViewer from './AttachmentViewer';
import AttachmentVisibilityPicker from './AttachmentVisibilityPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface ItemAttachmentsSectionProps {
  item: TripItem;
  tripId: string;
  members: Member[];
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export default function ItemAttachmentsSection({ item, tripId, members }: ItemAttachmentsSectionProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedViewerIds, setSelectedViewerIds] = useState<string[]>([]);

  const [editAttachment, setEditAttachment] = useState<Attachment | null>(null);
  const [editViewerIds, setEditViewerIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentUserId = user?.userId ?? null;
  const attachments = item.attachments ?? [];
  const openAttachment = attachments.find((a) => a.id === openId) ?? null;
  const otherMembers = members.filter((m) => m.userId !== currentUserId);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t('attachments.errorFormat'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('attachments.errorTooLarge'));
      return;
    }
    const viewerIds = otherMembers
      .filter((m) => selectedViewerIds.includes(m.userId))
      .map((m) => m.userId);
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.addItemAttachment(
          tripId,
          item.id,
          {
            fileName: file.name,
            mimeType: file.type,
            dataUrl: String(reader.result),
          },
          viewerIds
        );
        setSelectedViewerIds([]);
      } catch (e) {
        setError(localizeApiError(e, t));
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setError(t('attachments.errorRead'));
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const isUploader = (att: Attachment): boolean =>
    att.createdBy ? att.createdBy === currentUserId : att.viewerIds != null;

  const openEditDialog = (att: Attachment) => {
    setEditAttachment(att);
    setEditViewerIds((att.viewerIds ?? []).filter((id) => otherMembers.some((m) => m.userId === id)));
    setEditError(null);
  };

  const closeEditDialog = () => {
    if (savingEdit) return;
    setEditAttachment(null);
    setEditError(null);
  };

  const handleSaveViewers = async () => {
    if (!editAttachment) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const viewerIds = otherMembers
        .filter((m) => editViewerIds.includes(m.userId))
        .map((m) => m.userId);
      await api.updateAttachmentViewers(editAttachment.id, viewerIds);
      setEditAttachment(null);
    } catch (e) {
      setEditError(localizeApiError(e, t));
    } finally {
      setSavingEdit(false);
    }
  };

  const openDeleteDialog = (att: Attachment) => {
    setDeleteTarget(att);
    setDeleteError(null);
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleRemove = async (att: Attachment) => {
    setRemovingId(att.id);
    setError(null);
    try {
      await api.removeItemAttachment(att.id);
      if (openId === att.id) setOpenId(null);
    } catch (e) {
      setError(localizeApiError(e, t));
    } finally {
      setRemovingId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.removeItemAttachment(deleteTarget.id);
      if (openId === deleteTarget.id) setOpenId(null);
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(localizeApiError(e, t));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          {t('attachments.title')}
          {attachments.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {attachments.length}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-brand-600 transition duration-150 hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60 dark:hover:bg-brand-500/10"
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          {uploading ? t('attachments.uploading') : t('attachments.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mb-3">
        <AttachmentVisibilityPicker
          members={members}
          currentUserId={currentUserId}
          selectedViewerIds={selectedViewerIds}
          onChange={setSelectedViewerIds}
        />
      </div>

      {error && <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {attachments.length === 0 && !uploading ? (
        <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {t('attachments.empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {attachments.map((att) => {
            const uploader = isUploader(att);
            const shared = att.visibility === 'shared';
            const viewerCount = att.viewerIds?.length ?? 0;
            return (
              <li key={att.id}>
                <AttachmentFolder
                  attachment={att}
                  open={openId === att.id}
                  onToggle={() => setOpenId((cur) => (cur === att.id ? null : att.id))}
                  actions={
                    uploader ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditDialog(att)}
                          aria-label={t('attachments.editVisibilityAria', { name: att.fileName })}
                          title={t('attachments.editVisibility')}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteDialog(att)}
                          aria-label={t('attachments.deleteAria', { name: att.fileName })}
                          title={t('attachments.delete')}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition duration-150 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </>
                    ) : undefined
                  }
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ' +
                      (shared
                        ? 'border-brand-200 bg-brand-50/60 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-border bg-muted/50 text-muted-foreground')
                    }
                  >
                    {shared
                      ? viewerCount > 0
                        ? t('attachments.sharedBadge', { n: viewerCount })
                        : t('attachments.sharedGeneric')
                      : t('attachments.privateBadge')}
                  </span>
                  {!uploader && att.uploadedByName && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('attachments.uploadedBy', { name: att.uploadedByName })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openAttachment && (
        <AttachmentViewer
          attachment={openAttachment}
          onClose={() => setOpenId(null)}
          removeButton={
            isUploader(openAttachment) ? (
              <button
                type="button"
                onClick={() => handleRemove(openAttachment)}
                disabled={removingId === openAttachment.id}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 transition duration-150 hover:border-rose-400/50 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 disabled:opacity-60"
                aria-label={t('attachments.removeAria', { name: openAttachment.fileName })}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
              </button>
            ) : undefined
          }
        />
      )}

      <Dialog
        open={editAttachment !== null}
        onOpenChange={(next) => {
          if (!next) closeEditDialog();
        }}
      >
        <DialogContent className="z-[110] w-[calc(100%-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{t('attachments.editVisibilityTitle')}</DialogTitle>
            <DialogDescription className="truncate">
              {editAttachment?.fileName}
            </DialogDescription>
          </DialogHeader>
          <AttachmentVisibilityPicker
            members={members}
            currentUserId={currentUserId}
            selectedViewerIds={editViewerIds}
            onChange={setEditViewerIds}
            disabled={savingEdit}
          />
          {editError && <p className="text-xs text-rose-600 dark:text-rose-400">{editError}</p>}
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={closeEditDialog}
              disabled={savingEdit}
              className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveViewers}
              disabled={savingEdit}
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {savingEdit ? t('common.saving') : t('attachments.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) closeDeleteDialog();
        }}
      >
        <DialogContent className="z-[110] w-[calc(100%-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{t('attachments.delete')}</DialogTitle>
            <DialogDescription>{t('attachments.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <p className="truncate rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground">
              {deleteTarget.fileName}
            </p>
          )}
          {deleteError && <p className="text-xs text-rose-600 dark:text-rose-400">{deleteError}</p>}
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={closeDeleteDialog}
              disabled={deleting}
              className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              disabled={deleting}
              className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition duration-150 hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-60"
            >
              {deleting ? t('attachments.deleting') : t('attachments.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
