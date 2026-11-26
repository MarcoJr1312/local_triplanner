// gRPC adapter for the locations catalogue. The API keeps the LocationCatalogue
// port; this adapter is selected by LOCATIONS_TRANSPORT=grpc.

import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocationRow, UpsertLocationInput } from '../schema-types.ts';
import { CatalogueUnavailableError } from './remote.ts';
import type { LocationCatalogue } from './types.ts';

const PROTO_ROOT =
  process.env.PROTO_ROOT ??
  fileURLToPath(new URL('../../../../proto', import.meta.url));
const PROTO_PATH = path.join(PROTO_ROOT, 'triplanner', 'locations', 'v1', 'locations.proto');

export interface GrpcCatalogueOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;

function nullable<T>(value: T | null | undefined): T | null {
  return value === undefined ? null : value;
}

function toLocation(raw: any): LocationRow {
  const expiresAt = raw.expires_at ? Date.parse(raw.expires_at) : NaN;
  return {
    id: String(raw.id ?? ''),
    source: nullable(raw.source),
    place_id: nullable(raw.place_id),
    data_id: nullable(raw.data_id),
    slug: nullable(raw.slug),
    name: String(raw.name ?? ''),
    category: nullable(raw.category),
    raw_type: nullable(raw.raw_type),
    country: nullable(raw.country),
    description: nullable(raw.description),
    lat: nullable(raw.lat),
    lng: nullable(raw.lng),
    address: nullable(raw.address),
    rating: nullable(raw.rating),
    rating_count: nullable(raw.rating_count),
    hours_json: nullable(raw.hours_json),
    website_url: nullable(raw.website_url),
    social_links_json: nullable(raw.social_links_json),
    phone: nullable(raw.phone),
    price_level: nullable(raw.price_level),
    image_url: nullable(raw.image_url),
    cost: nullable(raw.cost),
    tags_json: nullable(raw.tags_json),
    duration_hours: nullable(raw.duration_hours),
    parent_id: nullable(raw.parent_id),
    last_updated: nullable(raw.last_updated),
    created_at: nullable(raw.created_at),
    expires_at: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

function isNotFound(error: any): boolean {
  if (error?.code === grpc.status.NOT_FOUND) return true;
  const values = error?.metadata?.get?.('x-error-code');
  return Array.isArray(values) && values.length > 0 && String(values[0]) === 'NOT_FOUND';
}

export class GrpcLocationCatalogue implements LocationCatalogue {
  private readonly client: any;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: GrpcCatalogueOptions) {
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const definition = loader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(definition) as any;
    const descriptor = proto.triplanner.locations.v1.LocationsService;
    this.client = new descriptor(options.baseUrl, grpc.credentials.createInsecure());
  }

  private invoke<T>(method: string, request: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const metadata = new grpc.Metadata();
      metadata.set('x-internal-token', this.token);
      this.client[method](
        request,
        metadata,
        { deadline: Date.now() + this.timeoutMs },
        (error: any, value: T) => {
          if (error) reject(error);
          else resolve(value);
        },
      );
    });
  }

  private async lookup(
    method: string,
    request: Record<string, unknown>,
  ): Promise<LocationRow | null> {
    try {
      const response = await this.invoke<any>(method, request);
      return response.item ? toLocation(response.item) : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new CatalogueUnavailableError('Locations service unreachable', error);
    }
  }

  private async list(
    method: string,
    request: Record<string, unknown>,
  ): Promise<LocationRow[]> {
    try {
      const response = await this.invoke<any>(method, request);
      return (response.items ?? []).map(toLocation);
    } catch (error) {
      throw new CatalogueUnavailableError('Locations service unreachable', error);
    }
  }

  async getById(id: string): Promise<LocationRow | null> {
    return this.lookup('GetById', { id });
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    return this.lookup('GetByPlaceId', { place_id: placeId });
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    return this.lookup('GetByDataId', { data_id: dataId });
  }

  async search(
    q: string,
    limit = 20,
    options: { lat?: number | null; lng?: number | null } = {},
  ): Promise<LocationRow[]> {
    return this.list('Search', {
      q,
      limit,
      ...(options.lat != null && options.lng != null
        ? { lat: options.lat, lng: options.lng }
        : {}),
    });
  }

  async listDestinations(): Promise<LocationRow[]> {
    return this.list('ListDestinations', {});
  }

  async listByParent(parentId: string, limit = 200): Promise<LocationRow[]> {
    return this.list('ListByParent', { parent_id: parentId, limit });
  }

  async listPlaces(): Promise<LocationRow[]> {
    return this.list('ListPlaces', {});
  }

  async upsert(_loc: UpsertLocationInput): Promise<LocationRow> {
    throw new CatalogueUnavailableError('Locations gRPC does not support upsert');
  }

  async clear(): Promise<void> {
    throw new CatalogueUnavailableError('Locations gRPC does not support clear');
  }

  async close(): Promise<void> {
    // The gRPC channel is process-lifetime; nothing to release per request.
  }
}
