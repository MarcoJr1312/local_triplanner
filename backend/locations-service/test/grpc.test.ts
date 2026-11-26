import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { LocationRow } from '../src/catalogue/types.ts';
import {
  startLocationsGrpcServer,
  type LocationsGrpcCatalogue,
  type LocationsGrpcHandle,
} from '../src/grpc/server.ts';
import { renderMetrics } from '../src/metrics.ts';

const PORT = 50057;
const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/locations/v1/locations.proto', import.meta.url),
);
const HEALTH_PROTO_PATH = fileURLToPath(
  new URL('../../../proto/grpc/health/v1/health.proto', import.meta.url),
);

const DESTINATION: LocationRow = {
  id: 'toronto',
  source: 'preloaded',
  place_id: null,
  data_id: null,
  slug: 'toronto',
  name: 'Toronto',
  category: null,
  raw_type: null,
  country: 'Canada',
  description: 'City',
  lat: 43.6532,
  lng: -79.3832,
  address: null,
  rating: null,
  rating_count: null,
  hours_json: null,
  website_url: null,
  social_links_json: null,
  phone: null,
  price_level: null,
  image_url: null,
  cost: null,
  tags_json: null,
  duration_hours: null,
  parent_id: null,
  last_updated: null,
  version: 1,
  content_hash: 'hash-destination',
  created_at: '2026-11-21T00:00:00.000Z',
  expires_at: null,
};

const PLACE: LocationRow = {
  ...DESTINATION,
  id: 'tor-cn-tower',
  place_id: 'place-cn',
  data_id: 'data-cn',
  slug: null,
  name: 'CN Tower',
  category: 'sight',
  raw_type: 'tourist_attraction',
  address: '301 Front St W',
  rating: 4.7,
  rating_count: 1200,
  image_url: '/images/cn-tower.jpg',
  cost: 40,
  parent_id: 'toronto',
  version: 2,
  content_hash: 'hash-place',
};

const catalogue: LocationsGrpcCatalogue = {
  getById: async (id) => (id === PLACE.id ? PLACE : id === DESTINATION.id ? DESTINATION : null),
  getByPlaceId: async (placeId) => (placeId === PLACE.place_id ? PLACE : null),
  getByDataId: async (dataId) => (dataId === PLACE.data_id ? PLACE : null),
  search: async (q, options) => {
    if (options?.lat === 0 && options?.lng === 0) return [];
    return q.toLowerCase().includes('cn') ? [PLACE] : [];
  },
  listDestinations: async () => [DESTINATION],
  listByParent: async (parentId) => (parentId === DESTINATION.id ? [PLACE, { ...PLACE, id: 'p2' }] : []),
  listPlaces: async () => [PLACE],
};

let handle: LocationsGrpcHandle;
let client: any;
let healthClient: any;

function call(method: string, request: unknown, token = 'test-token'): Promise<any> {
  return new Promise((resolve, reject) => {
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-token', token);
    client[method](request, metadata, { deadline: Date.now() + 3000 }, (error: any, value: any) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

beforeAll(async () => {
  handle = await startLocationsGrpcServer({
    catalogue,
    port: PORT,
    internalToken: 'test-token',
  });
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  client = new proto.triplanner.locations.v1.LocationsService(
    `127.0.0.1:${PORT}`,
    grpc.credentials.createInsecure(),
  );
  const healthDefinition = loader.loadSync(HEALTH_PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const healthProto = grpc.loadPackageDefinition(healthDefinition) as any;
  healthClient = new healthProto.grpc.health.v1.Health(
    `127.0.0.1:${PORT}`,
    grpc.credentials.createInsecure(),
  );
});

afterAll(async () => {
  client?.close();
  healthClient?.close();
  await handle?.stop();
});

describe('locations gRPC', () => {
  test('reports SERVING on the standard health service', async () => {
    const response = await new Promise<any>((resolve, reject) => {
      healthClient.Check({ service: '' }, (error: any, value: any) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
    expect(response.status).toBe('SERVING');
  });
  test('maps a location with nullable and numeric fields', async () => {
    const response = await call('GetById', { id: 'tor-cn-tower' });
    expect(response.item.id).toBe('tor-cn-tower');
    expect(response.item.place_id).toBe('place-cn');
    expect(response.item.slug).toBeUndefined();
    expect(response.item.rating).toBe(4.7);
    expect(response.item.rating_count).toBe(1200);
    expect(response.item.cost).toBe(40);
    expect(response.item.parent_id).toBe('toronto');
  });

  test('looks up by place and data id', async () => {
    expect((await call('GetByPlaceId', { place_id: 'place-cn' })).item.id).toBe('tor-cn-tower');
    expect((await call('GetByDataId', { data_id: 'data-cn' })).item.id).toBe('tor-cn-tower');
  });

  test('searches, lists destinations, activities and places', async () => {
    const search = await call('Search', { q: 'cn', limit: 10, lat: 43.65, lng: -79.38 });
    expect(search.items.map((item: any) => item.id)).toEqual(['tor-cn-tower']);

    const destinations = await call('ListDestinations', {});
    expect(destinations.items[0].slug).toBe('toronto');
    expect(destinations.items[0].category).toBeUndefined();

    const activities = await call('ListByParent', { parent_id: 'toronto', limit: 1 });
    expect(activities.items).toHaveLength(1);

    const places = await call('ListPlaces', {});
    expect(places.items).toHaveLength(1);
  });

  test('rejects a half-specified radius and requires the token', async () => {
    const invalid: any = await call('Search', { q: 'cn', lat: 43.65 }).catch((error) => error);
    expect(invalid.code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(invalid.metadata.get('x-error-code')[0]).toBe('INVALID_ARGUMENT');

    const unauthorized: any = await call('GetById', { id: 'tor-cn-tower' }, 'wrong').catch(
      (error) => error,
    );
    expect(unauthorized.code).toBe(grpc.status.UNAUTHENTICATED);
  });

  test('maps a missing location to NOT_FOUND', async () => {
    const missing: any = await call('GetById', { id: 'missing' }).catch((error) => error);
    expect(missing.code).toBe(grpc.status.NOT_FOUND);
    expect(missing.metadata.get('x-error-code')[0]).toBe('NOT_FOUND');
  });

  test('records gRPC calls and status codes in Prometheus metrics', async () => {
    await call('GetById', { id: 'tor-cn-tower' });
    const missing: any = await call('GetById', { id: 'missing' }).catch((error) => error);
    expect(missing.code).toBe(grpc.status.NOT_FOUND);

    const { body } = await renderMetrics();
    expect(body).toContain('triplanner_grpc_requests_total');
    expect(body).toContain('triplanner_grpc_request_duration_seconds');
    expect(body).toContain('method="GetById"');
    expect(body).toContain('status="OK"');
    expect(body).toContain('status="NOT_FOUND"');
    expect(body).toContain('service="locations"');
  });
});
