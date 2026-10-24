'use client';

import { useI18n } from '@/lib/i18n';
import Modal from './Modal';

interface DayTemplateOfferProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}

// Oferta post-creación: el viaje ya existe y preguntamos si el usuario quiere
// que el agente le arme un día plantilla. Rechazar/cerrar no hace nada más.
export default function DayTemplateOffer({
  open,
  onAccept,
  onDecline,
  onClose,
}: DayTemplateOfferProps) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('template.offerTitle')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-xl px-4 py-2 text-sm font-medium text-foreground/90 transition duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {t('template.noThanks')}
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 max-sm:min-h-11"
          >
            {t('template.yes')}
          </button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">{t('template.offerBody')}</p>
    </Modal>
  );
}
