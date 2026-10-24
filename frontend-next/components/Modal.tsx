'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  // Popups que exigen una acción explícita (p. ej. intereses post-login):
  // sin X, sin clic en el overlay y sin Escape.
  hideClose?: boolean;
  dismissible?: boolean;
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

// Centrado SIEMPRE (feedback de Marco: en móvil la hoja inferior quedaba debajo
// del teclado; el modal centrado + scroll interno es más usable con teclado).
const position = 'top-[50%] translate-y-[-50%]';

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  hideClose = false,
  dismissible = true,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && dismissible) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        className={cn(
          'flex max-h-[85dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl',
          position,
          sizes[size]
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </DialogTitle>
          {!hideClose && (
            <DialogClose
              aria-label="Cerrar"
              className="rounded-lg p-1.5 text-muted-foreground transition duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="h-5 w-5" />
            </DialogClose>
          )}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
