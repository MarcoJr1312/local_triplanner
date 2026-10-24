// Invitacion pendiente: cuando alguien se registra desde /join y su email aun
// no esta verificado, guardamos el codigo para aplicarlo automaticamente en
// cuanto la cuenta quede verificada (el link de verificacion abre la app).

const KEY = 'triplanner.pendingJoin';

export interface PendingJoin {
  code: string;
  trip?: string;
}

export function setPendingJoin(code: string, trip?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ code, trip } satisfies PendingJoin));
  } catch {
    // localStorage puede no estar disponible; el join simplemente no se difiere.
  }
}

export function readPendingJoin(): PendingJoin | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingJoin;
    if (parsed && typeof parsed.code === 'string' && parsed.code) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearPendingJoin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
