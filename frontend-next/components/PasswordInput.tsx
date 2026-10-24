'use client';

// Input de contraseña con ojo para revelar el texto.
// - Mantener presionado el ojo (pointerdown) muestra la contraseña; al soltar
//   se oculta de nuevo (peek temporal).
// - Un clic corto alterna la visibilidad de forma persistente.
// Un clic largo genera click tras soltar: se suprime para que el peek temporal
// no quede pegado.

import { forwardRef, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n';

type PasswordInputProps = React.ComponentProps<typeof Input>;

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, type: _type, ...props },
  ref
) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const holdStart = useRef<number | null>(null);
  const suppressClick = useRef(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${className ?? ''} pr-10`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        onPointerDown={(e) => {
          e.preventDefault();
          holdStart.current = Date.now();
          setVisible(true);
        }}
        onPointerUp={() => {
          const held = holdStart.current ? Date.now() - holdStart.current : 0;
          holdStart.current = null;
          setVisible(false);
          if (held > 200) suppressClick.current = true;
        }}
        onPointerLeave={() => {
          holdStart.current = null;
          setVisible(false);
        }}
        onPointerCancel={() => {
          holdStart.current = null;
          setVisible(false);
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setVisible((v) => !v);
        }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export default PasswordInput;
