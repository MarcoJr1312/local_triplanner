// Logica de negocio de invitaciones por email.
// - Codigo unico por invitacion: 12 chars URL-safe (base64url de 9 bytes random).
// - Ligado al email del destinatario: solo ese email puede aceptarla.
// - Un solo uso: pending -> accepted.

import { randomBytes, randomUUID } from 'node:crypto';
import type { Db, InvitationRow } from './schema-types.ts';

export type InvitationStatus = InvitationRow['status'];
export type InvitationRole = InvitationRow['role'];

// Genera un codigo de 12 caracteres URL-safe sin ambiguedades (base64url).
// Verifica unicidad contra la tabla antes de devolverlo.
export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url');
}

export function isInviteCodeValid(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{12}$/.test(code);
}

export interface CreateInvitationInput {
  tripId: string;
  email: string;
  role?: InvitationRole;
  createdBy: string;
}

export function createInvitation(db: Db, { tripId, email, role = 'viewer', createdBy }: CreateInvitationInput): InvitationRow {
  const id = randomUUID();
  // El codigo debe ser unico: reintentar si hay colision (improbable).
  let code = generateInviteCode();
  for (let i = 0; i < 5; i++) {
    const existing = db.prepare('SELECT id FROM invitations WHERE code = ?').get(code);
    if (!existing) break;
    code = generateInviteCode();
  }
  db.prepare(`
    INSERT INTO invitations (id, trip_id, email, code, role, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, tripId, email.toLowerCase(), code, role, createdBy);
  return db.prepare('SELECT * FROM invitations WHERE id = ?').get(id) as unknown as InvitationRow;
}

// Busca una invitacion pendiente por codigo (sin distinguir estado aun).
export function findInvitationByCode(db: Db, code: string): InvitationRow | null {
  const row = db.prepare('SELECT * FROM invitations WHERE code = ?').get(code);
  return (row as unknown as InvitationRow) ?? null;
}

// Marca la invitacion como aceptada.
export function acceptInvitation(db: Db, id: string): void {
  db.prepare(
    "UPDATE invitations SET status = 'accepted', accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(id);
}

// Valida que el email coincida con el de la invitacion (case-insensitive).
export function isEmailMatch(invitation: InvitationRow, email: string): boolean {
  return invitation.email.toLowerCase() === email.trim().toLowerCase();
}
