// Rate limit en memoria para el reenvio del email de verificacion.
// - Map<uid, timestampMs> (suficiente en un unico proceso; se reinicia al reiniciar).
// - Ventana de 60 s: el primer intento de un uid reserva el slot; los intentos
//   dentro de la ventana se rechazan (VERIFICATION_RATE_LIMITED).

export const VERIFICATION_RATE_LIMIT_MS = 60_000;

const lastSentAt = new Map<string, number>();

// Intenta reservar un envio para `uid`. Devuelve true si esta permitido.
export function tryReserveVerification(uid: string, now: number = Date.now()): boolean {
  const last = lastSentAt.get(uid);
  if (last !== undefined && now - last < VERIFICATION_RATE_LIMIT_MS) return false;
  lastSentAt.set(uid, now);
  return true;
}

// Solo para tests: limpia el estado entre casos.
export function resetVerificationRateLimit(): void {
  lastSentAt.clear();
}
