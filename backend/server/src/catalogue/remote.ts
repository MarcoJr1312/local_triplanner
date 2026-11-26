// Cliente HTTP del servicio de catalogo. La API mantiene el contrato
// `LocationCatalogue`, pero en modo remoto delega en `triplanner-locations`.

import type { LocationRow, UpsertLocationInput } from '../schema-types.ts';
import type { LocationCatalogue } from './types.ts';

export class CatalogueUnavailableError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'CatalogueUnavailableError';
  }
}

export interface RemoteCatalogueOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface ItemsResponse<T> {
  items: T[];
}

interface ItemResponse<T> {
  item: T;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export class RemoteLocationCatalogue implements LocationCatalogue {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(options: RemoteCatalogueOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}, allow404 = false): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'x-internal-token': this.token,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new CatalogueUnavailableError('Locations service unreachable', error);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404 && allow404) return null;
    if (!response.ok) {
      throw new CatalogueUnavailableError(`Locations service returned ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async getById(id: string): Promise<LocationRow | null> {
    const data = await this.request<ItemResponse<LocationRow>>(
      `/internal/v1/locations/${encodeURIComponent(id)}`,
      {},
      true,
    );
    return data?.item ?? null;
  }

  async getByPlaceId(placeId: string): Promise<LocationRow | null> {
    const data = await this.request<ItemResponse<LocationRow>>(
      `/internal/v1/locations/by-place/${encodeURIComponent(placeId)}`,
      {},
      true,
    );
    return data?.item ?? null;
  }

  async getByDataId(dataId: string): Promise<LocationRow | null> {
    const data = await this.request<ItemResponse<LocationRow>>(
      `/internal/v1/locations/by-data/${encodeURIComponent(dataId)}`,
      {},
      true,
    );
    return data?.item ?? null;
  }

  async search(
    q: string,
    limit = 20,
    options: { lat?: number | null; lng?: number | null } = {},
  ): Promise<LocationRow[]> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (options.lat != null && options.lng != null) {
      params.set('lat', String(options.lat));
      params.set('lng', String(options.lng));
    }
    const data = await this.request<ItemsResponse<LocationRow>>(
      `/internal/v1/locations/search?${params.toString()}`,
    );
    return data?.items ?? [];
  }

  async listDestinations(): Promise<LocationRow[]> {
    const data = await this.request<ItemsResponse<LocationRow>>('/internal/v1/destinations');
    return data?.items ?? [];
  }

  async listByParent(parentId: string, limit = 200): Promise<LocationRow[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    const data = await this.request<ItemsResponse<LocationRow>>(
      `/internal/v1/destinations/${encodeURIComponent(parentId)}/activities?${params.toString()}`,
    );
    return data?.items ?? [];
  }

  async listPlaces(): Promise<LocationRow[]> {
    const data = await this.request<ItemsResponse<LocationRow>>('/internal/v1/locations');
    return data?.items ?? [];
  }

  async upsert(loc: UpsertLocationInput): Promise<LocationRow> {
    const data = await this.request<ItemResponse<LocationRow>>('/internal/v1/locations', {
      method: 'POST',
      body: JSON.stringify(loc),
    });
    if (!data?.item) throw new CatalogueUnavailableError('Locations service returned no item');
    return data.item;
  }

  async clear(): Promise<void> {
    throw new Error('RemoteLocationCatalogue does not support clear()');
  }

  async close(): Promise<void> {
    // Sin conexiones persistentes.
  }
}
