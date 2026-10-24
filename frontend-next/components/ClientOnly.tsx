'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// Gate de hidratacion: no renderiza los hijos hasta que el cliente monto.
// La app es CSR-first (todos los datos llegan por fetch al proxy), asi que
// elimina de raiz los errores de hydration mismatch (atributos/texto que
// difieren entre el HTML prerenderizado del servidor y el primer render del
// cliente: locale, hora, localStorage, extensiones del navegador, etc.).
export default function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 dark:border-brand-500/30 dark:border-t-brand-400" />
      </div>
    );
  }

  return <>{children}</>;
}
