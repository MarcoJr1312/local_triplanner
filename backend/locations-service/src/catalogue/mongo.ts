// Adaptador MongoDB del catalogo. El servicio es el unico dueno de esta
// coleccion; la API y el agente ya no abren conexiones a Mongo.

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
      .limit(500)
      .toArray();
    return docs.map(toRow).filter((row): row is LocationRow => row !== null);
  }

  async clear(): Promise<void> {
    await this.collection.deleteMany({});
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
