// Postgres port of invitations.ts. Pure helpers (code format, email match) are
// reused from the SQLite version.

import { randomUUID } from 'node:crypto';
import { generateInviteCode, isEmailMatch, type InvitationRole } from '../invitations.ts';
import type { InvitationRow } from '../schema-types.ts';
import type { AsyncDb } from './db.ts';

export interface CreateInvitationInput {
  tripId: string;
  email: string;
  role?: InvitationRole;
  createdBy: string;
}

export async function createInvitation(
  db: AsyncDb,
  { tripId, email, role = 'viewer', createdBy }: CreateInvitationInput,
): Promise<InvitationRow> {
  const id = randomUUID();
  // The code must be unique; retry on a collision (vanishingly unlikely).
  let code = generateInviteCode();
  for (let i = 0; i < 5; i++) {
    const existing = await db.prepare('SELECT id FROM invitations WHERE code = ?').get(code);
    if (!existing) break;
    code = generateInviteCode();
  }

  await db
    .prepare(
      `INSERT INTO invitations (id, trip_id, email, code, role, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, tripId, email.toLowerCase(), code, role, createdBy);

  const row = await db.prepare('SELECT * FROM invitations WHERE id = ?').get<InvitationRow>(id);
  if (!row) throw new Error('No se pudo crear la invitación');
  return row;
}

export async function findInvitationByCode(db: AsyncDb, code: string): Promise<InvitationRow | null> {
  const row = await db.prepare('SELECT * FROM invitations WHERE code = ?').get<InvitationRow>(code);
  return row ?? null;
}

export async function acceptInvitation(db: AsyncDb, id: string): Promise<void> {
  await db
    .prepare("UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = ?")
    .run(id);
}

export { isEmailMatch };
