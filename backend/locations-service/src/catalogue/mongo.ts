// Adaptador MongoDB del catalogo. El servicio es el unico dueno de esta
// coleccion; la API y el agente ya no abren conexiones a Mongo.

import { createHash, randomUUID } from 'node:crypto';
import { MongoClient, type Collection, type Db } from 'mongodb';
import {
  ACTIVITIES_MAX_LIMIT,
  LOCATION_FIELDS,
  SEARCH_MAX_LIMIT,
  clampLimit,
  rankPlaces,
  tokenize,
  withinRadius,
  type LocationCatalogue,
  type LocationRow,
  type SearchOptions,
  type UpsertLocationInput,
} from './types.ts';

export const DEFAULT_MONGO_URL = 'mongodb://localhost:27017/triplanner';
export const DEFAULT_COLLECTION = 'locations';
export const OUTBOX_COLLECTION = 'locations_outbox';

const HASH_FIELDS = LOCATION_FIELDS.filter(
  (field) =>
    field !== 'version' &&
    field !== 'content_hash' &&
    field !== 'last_updated' &&
    field !== 'created_at' &&
    field !== 'expires_at',
);

export interface OutboxRow {
  _id: string;
  event_id: string;
  location_id: string;
  version: number;
  type: string;
  payload: LocationRow | null;
  deleted: boolean;
  created_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
}

export interface CatalogueOptions {
  url?: string;
  dbName?: string;
  collectionName?: string;
  client?: MongoClient;
}

function toRow(doc: Record<string, unknown> | null | undefined): LocationRow | null {
  if (!doc) return null;
  const row = {} as Record<string, unknown>;
  for (const field of LOCATION_FIELDS) row[field] = doc[field] ?? null;
  row.version = Number(doc.version ?? 0) || 0;
  row.content_hash = String(doc.content_hash ?? '');
  return row as unknown as LocationRow;
}

function contentHash(source: Record<string, unknown>): string {
  const canonical = HASH_FIELDS.map((field) => [field, source[field] ?? null]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function dbNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\/+/, '');
    return name || 'triplanner';
  } catch {
    return 'triplanner';
  }
}

export class MongoLocationCatalogue implements LocationCatalogue {
  private readonly client: MongoClient;
  private readonly db: Db;
  readonly collectionName: string;
  private readonly collection: Collection<Record<string, unknown>>;
  private readonly outbox: Collection<OutboxRow>;
  private readonly versions: Collection<{ _id: string; version: number }>;

  private constructor(client: MongoClient, db: Db, collectionName: string) {
    this.client = client;
    this.db = db;
    this.collectionName = collectionName;
    this.collection = db.collection(collectionName);
    this.outbox = db.collection<OutboxRow>(OUTBOX_COLLECTION);
    this.versions = db.collection<{ _id: string; version: number }>(
      `${collectionName}_versions`,
    );
  }

  static async connect(options: CatalogueOptions = {}): Promise<MongoLocationCatalogue> {
    const url = options.url ?? process.env.MONGODB_URL ?? DEFAULT_MONGO_URL;
    const client = options.client ?? new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
    if (!options.client) await client.connect();
    const dbName = options.dbName ?? dbNameFromUrl(url);
    const catalogue = new MongoLocationCatalogue(
      client,
      client.db(dbName),
      options.collectionName ?? DEFAULT_COLLECTION,
    );
    await catalogue.ensureIndexes();
    return catalogue;
  }

  private async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ place_id: 1 }, { sparse: true });
    await this.collection.createIndex({ data_id: 1 }, { sparse: true });
    await this.collection.createIndex({ parent_id: 1 }, { sparse: true });
    await this.collection.createIndex({ name_lower: 1 });
    await this.collection.createIndex({ category: 1 }, { sparse: true });
    // HasData cache rows carry an `expires_at` Date; preloaded rows have null
    // and are never removed. TTL monitor runs about once per minute.
    await this.collection.createIndex(
      { expires_at: 1 },
      { name: 'expires_at_ttl', expireAfterSeconds: 0, sparse: true },
    );
    await this.outbox.createIndex({ published_at: 1, created_at: 1 });
    await this.outbox.createIndex({ event_id: 1 }, { unique: true });
  }

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  async getById(id: string): Promise<LocationRow | null> {
    return toRow(await this.collection.findOne({ id }));
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return toRow(await this.collection.findOne({ place_id: placeId }));
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return toRow(await this.collection.findOne({ data_id: dataId }));
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    let existing: LocationRow | null = null;
    if (loc.place_id) existing = await this.getByPlaceId(loc.place_id);
    if (!existing && loc.data_id) existing = await this.getByDataId(loc.data_id);
    if (!existing) existing = await this.getById(loc.id);

    const id = existing?.id ?? loc.id;
    const now = new Date().toISOString();
    const source = { ...(existing ?? {}), ...loc, id } as Record<string, unknown>;
    source.created_at = existing?.created_at ?? now;
    source.name_lower = String(source.name ?? '').toLowerCase();
    const nextHash = contentHash(source);

    // Unchanged content: only refresh the cache expiry, never bump the version
    // or enqueue an event. This keeps the idempotent seed quiet.
    if (existing && existing.content_hash === nextHash) {
      if (loc.expires_at !== undefined) {
        const expiresAt = loc.expires_at ? new Date(loc.expires_at) : null;
        await this.collection.updateOne({ id }, { $set: { expires_at: expiresAt } });
      }
      return (await this.getById(id)) ?? existing;
    }

    source.last_updated = loc.last_updated ?? now;
    source.expires_at =
      loc.expires_at !== undefined
        ? loc.expires_at
          ? new Date(loc.expires_at)
          : null
        : (existing?.expires_at ?? null);
    source.version = await this.nextVersion(id);
    source.content_hash = nextHash;

    const doc = Object.fromEntries(
      LOCATION_FIELDS.map((field) => [field, source[field] ?? null]),
    ) as Record<string, unknown>;
    doc._id = id;
    doc.name_lower = String(source.name ?? '').toLowerCase();

    await this.collection.replaceOne({ id }, doc, { upsert: true });
    const row = await this.getById(id);
    if (!row) throw new Error('No se pudo guardar el lugar');
    await this.enqueueEvent(row, false);
    return row;
  }

  async delete(id: string): Promise<LocationRow | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    await this.collection.deleteOne({ id });
    const row: LocationRow = {
      ...existing,
      version: await this.nextVersion(id),
      last_updated: new Date().toISOString(),
    };
    await this.enqueueEvent(row, true);
    return row;
  }

  private async nextVersion(id: string): Promise<number> {
    await this.versions.updateOne(
      { _id: id },
      { $inc: { version: 1 } },
      { upsert: true },
    );
    const doc = await this.versions.findOne({ _id: id });
    return Number(doc?.version ?? 1);
  }

  private async enqueueEvent(row: LocationRow, deleted: boolean): Promise<void> {
    await this.outbox.insertOne({
      _id: randomUUID(),
      event_id: randomUUID(),
      location_id: row.id,
      version: row.version,
      type: 'location.changed.v1',
      payload: deleted ? null : row,
      deleted,
      created_at: new Date(),
      published_at: null,
      attempts: 0,
      last_error: null,
    });
  }

  async listOutbox(limit = 50): Promise<OutboxRow[]> {
    return this.outbox
      .find({ published_at: null })
      .sort({ created_at: 1 })
      .limit(limit)
      .toArray();
  }

  async markOutboxPublished(eventId: string): Promise<void> {
    await this.outbox.updateOne(
      { event_id: eventId },
      { $set: { published_at: new Date(), last_error: null } },
    );
  }

  async markOutboxFailed(eventId: string, error: string): Promise<void> {
    await this.outbox.updateOne(
      { event_id: eventId },
      { $inc: { attempts: 1 }, $set: { last_error: error.slice(0, 500) } },
    );
  }

  async search(q: string, options: SearchOptions = {}): Promise<LocationRow[]> {
    const tokens = tokenize(q).slice(0, 4);
    if (tokens.length === 0) return [];
    const filters = tokens.map((token) => ({
      name_lower: { $regex: token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
    }));
    const docs = await this.collection
      .find({ $and: [{ category: { $exists: true, $ne: null } }, ...filters] })
      .limit(500)
      .toArray();
    const rows = withinRadius(
      docs.map(toRow).filter((row): row is LocationRow => row !== null),
      options.lat,
      options.lng,
    );
    return rankPlaces(rows).slice(0, clampLimit(options.limit, SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT));
  }

  async listDestinations(): Promise<LocationRow[]> {
    const docs = await this.collection.find({ slug: { $exists: true, $ne: null } }).toArray();
    return docs
      .map(toRow)
      .filter((row): row is LocationRow => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listByParent(parentId: string, limit = 50): Promise<LocationRow[]> {
    const docs = await this.collection
      .find({ parent_id: parentId, category: { $exists: true, $ne: null } })
      .limit(500)
      .toArray();
    return rankPlaces(
      docs.map(toRow).filter((row): row is LocationRow => row !== null),
    ).slice(0, clampLimit(limit, 50, ACTIVITIES_MAX_LIMIT));
  }

  async listPlaces(): Promise<LocationRow[]> {
    const docs = await this.collection
      .find({ category: { $exists: true, $ne: null } })
      .toArray();
    return docs.map(toRow).filter((row): row is LocationRow => row !== null);
  }

  async countPlaces(): Promise<number> {
    return this.collection.countDocuments({ category: { $exists: true, $ne: null } });
  }

  async clear(): Promise<void> {
    await this.collection.deleteMany({});
    await this.outbox.deleteMany({});
    await this.versions.deleteMany({});
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
