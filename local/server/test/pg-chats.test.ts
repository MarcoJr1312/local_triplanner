import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import type { PgDb } from '../src/pg/db.ts';
import { getSuggestionChat, listSuggestionChats, upsertSuggestionChat } from '../src/pg/chats.ts';

let db: PgDb | null = null;

before(async () => {
  db = await connectPg();
});

after(async () => {
  await db?.close();
});

describe('suggestion chats on Postgres', () => {
  test('upserts by (trip, user, day) and updates in place', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const tripId = 'trip-chat-1';

    const first = await upsertSuggestionChat(db, {
      tripId,
      userId,
      day: '2026-02-01',
      messages: [{ role: 'user', content: 'hola' }],
    });
    assert.equal(first.messages.length, 1);

    const second = await upsertSuggestionChat(db, {
      tripId,
      userId,
      day: '2026-02-01',
      messages: [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '¿qué plan buscas?' },
      ],
    });
    assert.equal(second.id, first.id);
    assert.equal(second.messages.length, 2);

    const { c } = (await db
      .prepare('SELECT count(*)::int AS c FROM suggestion_chats WHERE trip_id = ?')
      .get<{ c: number }>(tripId)) ?? { c: 0 };
    assert.equal(c, 1);

    await deleteUser(db, userId);
  });

  test('filters by day and returns null for an unknown chat', async () => {
    if (!db) return;
    const userId = await insertUser(db);
    const tripId = 'trip-chat-2';

    await upsertSuggestionChat(db, { tripId, userId, day: 'd1', messages: [{ role: 'user', content: 'a' }] });
    await upsertSuggestionChat(db, { tripId, userId, day: 'd2', messages: [{ role: 'user', content: 'b' }] });

    const all = await listSuggestionChats(db, tripId, userId);
    assert.equal(all.length, 2);

    const onlyD2 = await listSuggestionChats(db, tripId, userId, 'd2');
    assert.equal(onlyD2.length, 1);
    assert.equal(onlyD2[0]?.day, 'd2');

    assert.equal(await getSuggestionChat(db, tripId, userId, 'nope'), null);

    await deleteUser(db, userId);
  });
});
