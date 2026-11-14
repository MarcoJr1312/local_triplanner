// MongoDB implementation of the location catalogue.
// The local runner seeds real Toronto places here; search is bounded regex
// matching over `name_lower`, which is enough at demo scale.

import { MongoClient, type Collection, type Db } from 'mongodb';
import type { LocationRow, UpsertLocationInput } from '../schema-types.ts';
import { LOCATION_FIELDS, tokenize, type LocationCatalogue } from './types.ts';

export const DEFAULT_MONGO_URL = 'mongodb://localhost:27017/triplanner';
export const DEFAULT_COLLECTION = 'locations';

export interface CatalogueOptions {
  url?: string;
  dbName?: string;
  collectionName?: string;
}

function toRow(doc: Record<string, unknown> | null | undefined): LocationRow | null {
  if (!doc) return null;
  const row = {} as Record<string, unknown>;
  for (const field of LOCATION_FIELDS) row[field] = doc[field] ?? null;
  return row as unknown as LocationRow;
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

  private constructor(client: MongoClient, db: Db, collectionName: string) {
    this.client = client;
    this.db = db;
    this.collectionName = collectionName;
    this.collection = db.collection(collectionName);
  }

  static async connect(options: CatalogueOptions = {}): Promise<MongoLocationCatalogue> {
    const url = options.url ?? process.env.MONGODB_URL ?? DEFAULT_MONGO_URL;
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
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
    source.last_updated = loc.last_updated ?? now;
    source.expires_at = null;
    source.name_lower = String(source.name ?? '').toLowerCase();

    const doc = Object.fromEntries(
      LOCATION_FIELDS.map((field) => [field, source[field] ?? null]),
    ) as Record<string, unknown>;
    doc._id = id;
    doc.name_lower = String(source.name ?? '').toLowerCase();

    await this.collection.replaceOne({ id }, doc, { upsert: true });
    const row = await this.getById(id);
    if (!row) throw new Error('No se pudo guardar el lugar');
    return row;
  }

  async search(q: string, limit = 20): Promise<LocationRow[]> {
    const tokens = tokenize(q).slice(0, 4);
    if (tokens.length === 0) return [];
    const filters = tokens.map((token) => ({
      name_lower: { $regex: token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
    }));
    const docs = await this.collection
      .find({ $and: [{ category: { $exists: true, $ne: null } }, ...filters] })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    return docs.map(toRow).filter((row): row is LocationRow => row !== null);
  }

  async listDestinations(): Promise<LocationRow[]> {
    const docs = await this.collection.find({ slug: { $exists: true, $ne: null } }).toArray();
    return docs
      .map(toRow)
      .filter((row): row is LocationRow => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listByParent(parentId: string): Promise<LocationRow[]> {
    const docs = await this.collection
      .find({ parent_id: parentId, category: { $exists: true, $ne: null } })
      .toArray();
    return docs
      .map(toRow)
      .filter((row): row is LocationRow => row !== null)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name));
  }

  async listPlaces(): Promise<LocationRow[]> {
    const docs = await this.collection.find({ category: { $exists: true, $ne: null } }).toArray();
    return docs.map(toRow).filter((row): row is LocationRow => row !== null);
  }

  async clear(): Promise<void> {
    await this.collection.deleteMany({});
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
