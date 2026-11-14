// End-to-end resolver smoke test on the flipped stack (Postgres + MongoDB + Storage).
// Exercises the GraphQL surface without HTTP, using the same Ctx the server builds.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectPg, deleteUser, insertUser } from './helpers/pg.ts';
import { connectMongo } from './helpers/mongo.ts';
import type { PgDb } from '../src/pg/db.ts';
import type { MongoLocationCatalogue } from '../src/catalogue/mongo.ts';
import { LocalDiskStorage } from '../src/storage.ts';
import { deleteTripCascade } from '../src/pg/trips.ts';
import { resolvers, type Ctx } from '../src/resolvers.ts';

let db: PgDb | null = null;
let catalogue: MongoLocationCatalogue | null = null;
let storage: LocalDiskStorage;
let root: string;
let ctx: Ctx | null = null;

const call = (fn: unknown, args: Record<string, unknown>) =>
  (fn as (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>)({}, args, ctx as Ctx);

before(async () => {
  db = await connectPg();
  catalogue = await connectMongo('locations_graphql_test');
  await catalogue?.clear();
  root = mkdtempSync(path.join(tmpdir(), 'triplanner-smoke-'));
  storage = new LocalDiskStorage(root);
});

after(async () => {
  await catalogue?.clear();
  await catalogue?.close();
  await db?.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await catalogue?.clear();
  const userId = 'smoke-user';
  if (db) {
    await db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM suggestion_chats WHERE user_id = ?').run(userId);
    await db.prepare("DELETE FROM trip_items WHERE trip_id IN (SELECT id FROM trips WHERE owner_id = ?)").run(userId);
    await db.prepare('DELETE FROM trip_members WHERE user_id = ?').run(userId);
    await db.prepare('DELETE FROM trips WHERE owner_id = ?').run(userId);
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    await db.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, 'Smoke')").run(userId, 'smoke@example.com');
  }
  ctx = db && catalogue
    ? {
        db,
        catalogue,
        storage,
        currentUserId: userId,
        pubsub: {
          publish: () => {},
          subscribe: async function* () {
            /* no events in tests */
          },
        },
      }
    : null;
});

describe('GraphQL resolvers on the flipped stack', () => {
  test('creates a trip, lists it and reads it back with items', async () => {
    if (!ctx) return;

    const trip = (await call(resolvers.Mutation.createTrip, {
      input: {
        name: 'Toronto',
        destinationId: 'dest-1',
        destinationName: 'Toronto',
        startDate: '2030-03-01',
        endDate: '2030-03-03',
        totalBudget: 500,
      },
    })) as { id: string; name: string; myRole: string; members: { role: string }[] };

    assert.equal(trip.name, 'Toronto');
    assert.equal(trip.myRole, 'owner');
    assert.deepEqual(trip.members.map((m) => m.role), ['owner']);

    const listed = (await call(resolvers.Query.listMyTrips, {})) as { tripId: string; role: string }[];
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.tripId, trip.id);

    const item = (await call(resolvers.Mutation.addItem, {
      tripId: trip.id,
      input: { title: 'CN Tower', category: 'sight', day: '2030-03-01', order: 0, cost: 40 },
    })) as { id: string; title: string };
    assert.equal(item.title, 'CN Tower');

    const full = (await call(resolvers.Query.getTrip, { id: trip.id })) as {
      items: { title: string }[];
      spent: number;
    };
    assert.deepEqual(full.items.map((i) => i.title), ['CN Tower']);
    assert.equal(full.spent, 40);

    await deleteTripCascade(ctx.db, trip.id);
  });

  test('favorites require a catalogued place and search returns it', async () => {
    if (!ctx) return;
    await catalogue!.upsert({ id: 'place-1', name: 'Museo de Arte', category: 'sight', rating: 4.8, parent_id: 'dest-1', lat: 8.99, lng: -79.51 });

    const fav = (await call(resolvers.Mutation.favoriteLocation, {
      locationId: 'place-1',
      favorite: true,
    })) as { favorite: boolean };
    assert.equal(fav.favorite, true);

    const rows = (await call(resolvers.Query.searchLocations, { q: 'museo', lat: 8.98, lng: -79.52 })) as {
      id: string;
      isFavorite: boolean;
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'place-1');
    assert.equal(rows[0]?.isFavorite, true);

    await assert.rejects(
      () => call(resolvers.Mutation.favoriteLocation, { locationId: 'missing', favorite: true }),
      /Lugar no encontrado/,
    );
  });

  test('uploads an attachment and exposes it through TripItem', async () => {
    if (!ctx) return;
    const trip = (await call(resolvers.Mutation.createTrip, {
      input: {
        name: 'Con boleto',
        destinationId: 'dest-1',
        destinationName: 'Toronto',
        startDate: '2030-04-01',
        endDate: '2030-04-02',
        totalBudget: 100,
      },
    })) as { id: string };
    const item = (await call(resolvers.Mutation.addItem, {
      tripId: trip.id,
      input: { title: 'Museo', category: 'sight', day: '2030-04-01' },
    })) as { id: string };

    const pdf = Buffer.from('%PDF-1.4 smoke').toString('base64');
    const attachment = (await call(resolvers.Mutation.addItemAttachment, {
      tripId: trip.id,
      itemId: item.id,
      viewerIds: [],
      input: { fileName: 'boleto.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${pdf}` },
    })) as { id: string; visibility: string; url: string };

    assert.equal(attachment.visibility, 'private');
    assert.match(attachment.url, /^\/uploads\/attachments\//);

    const listed = (await (resolvers.TripItem.attachments as any)(
      { id: item.id },
      {},
      ctx,
    )) as { id: string }[];
    assert.deepEqual(listed.map((a) => a.id), [attachment.id]);

    await call(resolvers.Mutation.removeItemAttachment, { attachmentId: attachment.id });
    const after = (await (resolvers.TripItem.attachments as any)({ id: item.id }, {}, ctx)) as unknown[];
    assert.equal(after.length, 0);

    await deleteTripCascade(ctx.db, trip.id);
  });

  test('rejects itinerary edits from a viewer', async () => {
    if (!ctx) return;
    const owner = await insertUser(ctx.db, 'Owner');
    const viewer = await insertUser(ctx.db, 'Viewer');
    const trip = (await call(resolvers.Mutation.createTrip, {
      input: {
        name: 'Permisos',
        destinationId: 'dest-1',
        destinationName: 'Toronto',
        startDate: '2030-05-01',
        endDate: '2030-05-02',
        totalBudget: 100,
      },
    })) as { id: string };
    await ctx.db
      .prepare("INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, 'viewer')")
      .run(trip.id, viewer);

    const viewerCtx: Ctx = { ...ctx, currentUserId: viewer };
    await assert.rejects(
      () =>
        (resolvers.Mutation.addItem as any)(
          {},
          { tripId: trip.id, input: { title: 'X', category: 'sight', day: '2030-05-01' } },
          viewerCtx,
        ),
      /FORBIDDEN_EDIT|editor/,
    );

    await deleteTripCascade(ctx.db, trip.id);
    await deleteUser(ctx.db, owner);
    await deleteUser(ctx.db, viewer);
  });
});
