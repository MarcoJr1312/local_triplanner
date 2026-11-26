// Router HTTP/JSON del servicio. Se exporta como handler puro (Request ->
// Response) para poder testearlo sin abrir un puerto.

import {
  ACTIVITIES_MAX_LIMIT,
  SEARCH_MAX_LIMIT,
  clampLimit,
  type LocationCatalogue,
  type UpsertLocationInput,
} from './catalogue/types.ts';
import {
  LocationsSettingsValidationError,
  type LocationsSettingsProvider,
} from './settings.ts';
import { renderMetrics, withHttpMetrics } from './metrics.ts';

export interface SeedState {
  enabled: boolean;
  seeded: boolean;
  count: number;
  lastError: string | null;
}

export interface HttpDeps {
  catalogue: LocationCatalogue;
  settings: LocationsSettingsProvider;
  verifyToken: (provided: string | null | undefined) => boolean;
  seed?: () => Promise<number>;
  seedState: SeedState;
}

const MAX_BODY_BYTES = 1_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(status: number, code: string, message?: string): Response {
  return json(status, message ? { error: code, message } : { error: code });
}

function parseLimit(raw: string | null, fallback: number, max: number): number | null {
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return clampLimit(value, fallback, max);
}

function parseCoord(raw: string | null): number | null | undefined {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createHandler(deps: HttpDeps): (req: Request) => Promise<Response> {
  const { catalogue, seedState } = deps;

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/metrics' && req.method === 'GET') {
      const { body, contentType } = await renderMetrics();
      return new Response(body, {
        status: 200,
        headers: { 'content-type': contentType, 'cache-control': 'no-store' },
      });
    }

    if (path === '/health' && req.method === 'GET') {
      return json(200, { status: 'ok' });
    }

    if (path === '/ready' && req.method === 'GET') {
      try {
        await catalogue.ping();
      } catch {
        return json(503, { status: 'not_ready', mongo: 'down', seeded: seedState.seeded });
      }
      if (seedState.enabled && !seedState.seeded) {
        return json(503, { status: 'not_ready', mongo: 'ok', seeded: false });
      }
      return json(200, {
        status: 'ready',
        mongo: 'ok',
        seeded: seedState.seeded,
        places: seedState.count,
        provider: deps.settings.public().provider,
      });
    }

    if (path === '/api/locations/config' && req.method === 'GET') {
      return json(200, {
        ...deps.settings.public(),
        cachedPlaces: await catalogue.countPlaces(),
      });
    }

    if (path === '/api/locations/config' && req.method === 'POST') {
      if (!deps.verifyToken(req.headers.get('x-internal-token'))) {
        return json(401, { error: { code: 'AUTH_INVALID', message: 'invalid internal token' } });
      }
      const body = await readJson(req);
      if (!body) {
        return json(400, {
          error: { code: 'LOCATIONS_CONFIG_INVALID', message: 'body must be a valid JSON object' },
        });
      }
      if (typeof body.provider !== 'string') {
        return json(400, {
          error: { code: 'LOCATIONS_CONFIG_INVALID', message: 'provider must be a string' },
        });
      }
      if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== 'string') {
        return json(400, {
          error: { code: 'LOCATIONS_CONFIG_INVALID', message: 'apiKey must be a string' },
        });
      }
      if (body.clearKey !== undefined && typeof body.clearKey !== 'boolean') {
        return json(400, {
          error: { code: 'LOCATIONS_CONFIG_INVALID', message: 'clearKey must be a boolean' },
        });
      }
      try {
        const saved = deps.settings.update({
          provider: body.provider,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
          clearKey: body.clearKey === true,
        });
        return json(200, { ...saved, cachedPlaces: await catalogue.countPlaces() });
      } catch (error) {
        if (error instanceof LocationsSettingsValidationError) {
          return json(400, {
            error: { code: 'LOCATIONS_CONFIG_INVALID', message: error.message },
          });
        }
        console.error('[locations] settings persist failed', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        return json(500, {
          error: {
            code: 'LOCATIONS_SETTINGS_PERSIST_FAILED',
            message: 'could not persist locations settings',
          },
        });
      }
    }

    if (!path.startsWith('/internal/v1/')) {
      return fail(404, 'NOT_FOUND');
    }

    if (!deps.verifyToken(req.headers.get('x-internal-token'))) {
      return fail(401, 'UNAUTHORIZED');
    }

    const segments = path.slice('/internal/v1/'.length).split('/').filter(Boolean);

    if (segments.length === 1 && segments[0] === 'destinations' && req.method === 'GET') {
      return json(200, { items: await catalogue.listDestinations() });
    }

    if (
      segments.length === 3 &&
      segments[0] === 'destinations' &&
      segments[2] === 'activities' &&
      req.method === 'GET'
    ) {
      const slug = decodeURIComponent(segments[1] ?? '');
      if (!slug) return fail(400, 'INVALID_ARGUMENT', 'destination slug required');
      const limit = parseLimit(url.searchParams.get('limit'), 50, ACTIVITIES_MAX_LIMIT);
      if (limit == null) return fail(400, 'INVALID_ARGUMENT', 'invalid limit');
      const category = url.searchParams.get('category');
      const rows = await catalogue.listByParent(slug, ACTIVITIES_MAX_LIMIT);
      const filtered = category ? rows.filter((row) => row.category === category) : rows;
      return json(200, { items: filtered.slice(0, limit) });
    }

    if (segments.length === 2 && segments[0] === 'locations' && segments[1] === 'search' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const limit = parseLimit(url.searchParams.get('limit'), SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT);
      if (limit == null) return fail(400, 'INVALID_ARGUMENT', 'invalid limit');
      const lat = parseCoord(url.searchParams.get('lat'));
      const lng = parseCoord(url.searchParams.get('lng'));
      if (lat === undefined || lng === undefined || (lat == null) !== (lng == null)) {
        return fail(400, 'INVALID_ARGUMENT', 'lat and lng must be provided together');
      }
      return json(200, { items: await catalogue.search(q, { lat, lng, limit }) });
    }

    if (segments.length === 1 && segments[0] === 'locations' && req.method === 'GET') {
      return json(200, { items: await catalogue.listPlaces() });
    }

    if (
      segments.length === 3 &&
      segments[0] === 'locations' &&
      segments[1] === 'by-place' &&
      req.method === 'GET'
    ) {
      const placeId = decodeURIComponent(segments[2] ?? '');
      if (!placeId) return fail(400, 'INVALID_ARGUMENT', 'place id required');
      const item = await catalogue.getByPlaceId(placeId);
      return item ? json(200, { item }) : fail(404, 'NOT_FOUND');
    }

    if (
      segments.length === 3 &&
      segments[0] === 'locations' &&
      segments[1] === 'by-data' &&
      req.method === 'GET'
    ) {
      const dataId = decodeURIComponent(segments[2] ?? '');
      if (!dataId) return fail(400, 'INVALID_ARGUMENT', 'data id required');
      const item = await catalogue.getByDataId(dataId);
      return item ? json(200, { item }) : fail(404, 'NOT_FOUND');
    }

    if (segments.length === 2 && segments[0] === 'locations' && req.method === 'GET') {
      const id = decodeURIComponent(segments[1] ?? '');
      if (!id) return fail(400, 'INVALID_ARGUMENT', 'location id required');
      const item = await catalogue.getById(id);
      return item ? json(200, { item }) : fail(404, 'NOT_FOUND');
    }

    if (segments.length === 1 && segments[0] === 'locations' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body) return fail(400, 'INVALID_ARGUMENT', 'invalid JSON body');
      if (typeof body.id !== 'string' || body.id.length === 0) {
        return fail(400, 'INVALID_ARGUMENT', 'id is required');
      }
      if (typeof body.name !== 'string' || body.name.length === 0) {
        return fail(400, 'INVALID_ARGUMENT', 'name is required');
      }
      const item = await catalogue.upsert(body as unknown as UpsertLocationInput);
      return json(200, { item });
    }

    if (segments.length === 2 && segments[0] === 'locations' && req.method === 'DELETE') {
      const id = decodeURIComponent(segments[1] ?? '');
      if (!id) return fail(400, 'INVALID_ARGUMENT', 'location id required');
      const item = await catalogue.delete(id);
      return item ? json(200, { item }) : fail(404, 'NOT_FOUND');
    }

    if (segments.length === 1 && segments[0] === 'seed' && req.method === 'POST') {
      if (!seedState.enabled || !deps.seed) {
        return fail(403, 'SEED_DISABLED');
      }
      try {
        const count = await deps.seed();
        seedState.seeded = true;
        seedState.count = count;
        seedState.lastError = null;
        return json(200, { seeded: count });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'seed failed';
        seedState.lastError = message;
        return fail(503, 'UNAVAILABLE', message);
      }
    }

    return fail(404, 'NOT_FOUND');
  }

  return withHttpMetrics(async function handle(req: Request): Promise<Response> {
    try {
      return await route(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'catalogue unavailable';
      console.error('[locations] request failed:', message);
      return fail(503, 'UNAVAILABLE');
    }
  });
}
