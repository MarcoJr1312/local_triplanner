// Vinculacion de identidades Firebase con la tabla local `users`.
// - La identidad de negocio es el EMAIL (los datos existentes se indexan por el):
//   si ya hay fila con ese email se reutiliza, si no se crea una nueva.
// - firebase_uid se rellena una sola vez (cuando estaba NULL); email_verified se
//   sincroniza en cada login con el claim del token.

import { randomUUID } from 'node:crypto';
import type { Db, UserRow } from '../schema-types.ts';
import type { FirebaseClaims } from './verify.ts';

export interface UpsertUserResult {
  user: UserRow;
  created: boolean;
}

// Nombre por defecto si el token no trae `name`: prefijo del email (antes del @).
export function defaultDisplayName(email: string): string {
  const prefix = email.split('@')[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : 'Viajero';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Busca por email normalizado; crea o actualiza la fila del usuario local.
export function upsertUserByEmail(db: Db, claims: FirebaseClaims): UpsertUserResult {
  const email = normalizeEmail(claims.email);
  if (!email) throw new Error('El token de Firebase no incluye email');
  const uid = claims.uid || null;
  const verified = claims.email_verified ? 1 : 0;

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (existing) {
    // Solo se completa firebase_uid si estaba vacio (no se re-vincula a otro uid).
    const nextUid = existing.firebase_uid ?? uid;
    db.prepare('UPDATE users SET firebase_uid = ?, email_verified = ? WHERE id = ?')
      .run(nextUid, verified, existing.id);
    // Self-heal del display_name: cuentas creadas antes del fix quedaron con el
    // prefijo del email como nombre. Si el token trae un nombre REAL y el
    // guardado sigue siendo el default, corregirlo (sin pisar renombres hechos
    // por el usuario en la app, que nunca coinciden con el default del email).
    const claimedName = claims.name?.trim();
    const storedName = existing.display_name ?? '';
    if (
      claimedName &&
      claimedName.length > 0 &&
      (storedName.length === 0 ||
        storedName === defaultDisplayName(email) ||
        storedName === email)
    ) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(claimedName, existing.id);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as unknown as UserRow;
    return { user, created: false };
  }

  const id = randomUUID();
  const name = claims.name?.trim() || defaultDisplayName(email);
  db.prepare(`
    INSERT INTO users (id, email, display_name, color, language, firebase_uid, email_verified)
    VALUES (?, ?, ?, NULL, 'es', ?, ?)
  `).run(id, email, name, uid, verified);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
  return { user, created: true };
}

// Marca el email de bienvenida como enviado (idempotencia del login).
export function markWelcomeSent(db: Db, userId: string): void {
  db.prepare("UPDATE users SET welcome_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(userId);
}
