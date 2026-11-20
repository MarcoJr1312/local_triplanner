import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteTrip, deleteUser, insertTrip, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { acceptInvitation, createInvitation, findInvitationByCode, isEmailMatch } from '../src/pg/invitations.ts';
import { addInvitedMember, deleteTripCascade, listMembers } from '../src/pg/trips.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

describe('invitations on Postgres', () => {
  test('creates a pending invitation with a 12-char code', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const tripId = await insertTrip(db, userId);

    const invitation = await createInvitation(db, {
      tripId,
      email: 'Guest@Example.COM',
      role: 'editor',
      createdBy: userId,
    });

    assert.equal(invitation.status, 'pending');
    assert.equal(invitation.email, 'guest@example.com');
    assert.equal(invitation.role, 'editor');
    assert.match(invitation.code, /^[A-Za-z0-9_-]{12}$/);
    assert.equal(invitation.accepted_at, null);

    const found = await findInvitationByCode(db, invitation.code);
    assert.equal(found?.id, invitation.id);

    await deleteTrip(db, tripId);
    await deleteUser(db, userId);
  });

  test('accepts once and stamps accepted_at', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const tripId = await insertTrip(db, userId);
    const invitation = await createInvitation(db, { tripId, email: 'g@example.com', createdBy: userId });

    await acceptInvitation(db, invitation.id);

    const updated = await findInvitationByCode(db, invitation.code);
    assert.equal(updated?.status, 'accepted');
    assert.equal(typeof updated?.accepted_at, 'string');

    await deleteTrip(db, tripId);
    await deleteUser(db, userId);
  });

  test('matches the invite email case-insensitively', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const tripId = await insertTrip(db, userId);
    const invitation = await createInvitation(db, { tripId, email: 'Friend@Example.com', createdBy: userId });

    assert.equal(isEmailMatch(invitation, '  friend@example.COM '), true);
    assert.equal(isEmailMatch(invitation, 'other@example.com'), false);

    await deleteTrip(db, tripId);
    await deleteUser(db, userId);
  });

  test('preserves the invited email on the membership', async () => {
    if (!db) return;
    const ownerId = await insertUser(db);
    const guestId = await insertUser(db);
    const tripId = await insertTrip(db, ownerId);

    await addInvitedMember(db, tripId, guestId, 'viewer', 'invited@example.com');
    const members = await listMembers(db, tripId);
    const guest = members.find((member) => member.user_id === guestId);
    assert.equal(guest?.invited_email, 'invited@example.com');

    await deleteTripCascade(db, tripId);
    await deleteUser(db, ownerId);
    await deleteUser(db, guestId);
  });
});
