// gRPC locations adapter contract: metadata, null mapping, lists and failures.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { GrpcLocationCatalogue } from '../src/catalogue/grpc.ts';
import { RemoteLocationCatalogue, CatalogueUnavailableError } from '../src/catalogue/remote.ts';

const PROTO_PATH = fileURLToPath(
  new URL('../../../proto/triplanner/locations/v1/locations.proto', import.meta.url),
);

const PLACE = {
  id: 'loc-1',
  source: 'preloaded',
  place_id: 'place-1',
  data_id: 'data-1',
  name: 'CN Tower',
  category: 'sight',
  country: 'Canada',
  lat: 43.6426,
  lng: -79.3871,
  address: '301 Front St W',
  rating: 4.7,
  rating_count: 1200,
  cost: 40,
  parent_id: 'toronto',
  version: 1,
  content_hash: 'hash',
  created_at: '2026-11-21T00:00:00.000Z',
  expires_at: '2026-12-01T00:00:00.000Z',
};

const seen: { method: string; request: any; token?: string }[] = [];
let server: grpc.Server;
let port = 0;
let catalogue: GrpcLocationCatalogue;

function value(md: grpc.Metadata, key: string): string | undefined {
  const values = md.get(key);
  return Array.isArray(values) && values.length > 0 ? String(values[0]) : undefined;
}

function record(method: string, call: grpc.ServerUnaryCall<any, any>): void {
  seen.push({ method, request: call.request, token: value(call.metadata, 'x-internal-token') });
}

function fail(callback: grpc.sendUnaryData<any>, status: grpc.status, code: string): void {
  const metadata = new grpc.Metadata();
  metadata.set('x-error-code', code);
  callback({ code: status, details: code, metadata });
}

before(async () => {
  const definition = loader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as any;
  const descriptor = proto.triplanner.locations.v1.LocationsService;

  server = new grpc.Server();
  server.addService(descriptor.service, {
    GetById: (call: any, callback: any) => {
      record('GetById', call);
      if (call.request.id === 'missing') {
        fail(callback, grpc.status.NOT_FOUND, 'NOT_FOUND');
        return;
      }
      if (call.request.id === 'boom') {
        fail(callback, grpc.status.UNAVAILABLE, 'UNAVAILABLE');
        return;
      }
      callback(null, { item: PLACE });
    },
    GetByPlaceId: (call: any, callback: any) => {
      record('GetByPlaceId', call);
      callback(null, { item: PLACE });
    },
    GetByDataId: (call: any, callback: any) => {
      record('GetByDataId', call);
      callback(null, { item: PLACE });
    },
    Search: (call: any, callback: any) => {
      record('Search', call);
      callback(null, { items: [PLACE] });
    },
    ListDestinations: (call: any, callback: any) => {
      record('ListDestinations', call);
      callback(null, { items: [{ ...PLACE, slug: 'toronto', category: undefined }] });
    },
    ListByParent: (call: any, callback: any) => {
      record('ListByParent', call);
      callback(null, { items: [PLACE] });
    },
    ListPlaces: (call: any, callback: any) => {
      record('ListPlaces', call);
      callback(null, { items: [PLACE] });
    },
  });

  ({ port } = await new Promise<{ port: number }>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) => {
      if (error) reject(error);
      else resolve({ port: bound });
    });
  }));

  catalogue = new GrpcLocationCatalogue({
    baseUrl: `127.0.0.1:${port}`,
    token: 'secret',
    timeoutMs: 2000,
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
});

describe('GrpcLocationCatalogue', () => {
  test('maps a location and sends the internal token', async () => {
    seen.length = 0;
    const row = await catalogue.getById('loc-1');
    assert.equal(row?.id, 'loc-1');
    assert.equal(row?.place_id, 'place-1');
    assert.equal(row?.slug, null);
    assert.equal(row?.rating, 4.7);
    assert.equal(row?.rating_count, 1200);
    assert.equal(row?.expires_at, Date.parse('2026-12-01T00:00:00.000Z'));
    assert.equal(seen[0]!.token, 'secret');
  });

  test('returns null for a missing location', async () => {
    assert.equal(await catalogue.getById('missing'), null);
  });

  test('looks up by place and data id', async () => {
    assert.equal((await catalogue.getByPlaceId('place-1'))?.id, 'loc-1');
    assert.equal((await catalogue.getByDataId('data-1'))?.id, 'loc-1');
  });

  test('searches with limit and optional radius, and lists the catalogue', async () => {
    seen.length = 0;
    const results = await catalogue.search('cn', 5, { lat: 43.65, lng: -79.38 });
    assert.equal(results[0]!.id, 'loc-1');
    assert.deepEqual(
      { q: seen[0]!.request.q, limit: seen[0]!.request.limit, lat: seen[0]!.request.lat },
      { q: 'cn', limit: 5, lat: 43.65 },
    );

    await catalogue.search('cn', 5);
    assert.equal(seen[1]!.request.lat, undefined);

    assert.equal((await catalogue.listDestinations())[0]!.slug, 'toronto');
    assert.equal((await catalogue.listByParent('toronto', 10))[0]!.id, 'loc-1');
    assert.equal((await catalogue.listPlaces())[0]!.id, 'loc-1');
  });

  test('maps service failures to CatalogueUnavailableError', async () => {
    await assert.rejects(
      () => catalogue.getById('boom'),
      (error) => error instanceof CatalogueUnavailableError,
    );
  });

  test('does not pretend to support upsert over gRPC', async () => {
    await assert.rejects(
      () => catalogue.upsert({ id: 'x', name: 'X' }),
      (error) => error instanceof CatalogueUnavailableError,
    );
  });

  test('the HTTP adapter remains the default class', () => {
    const remote = new RemoteLocationCatalogue({ baseUrl: 'http://locations', token: 'secret' });
    assert.ok(remote instanceof RemoteLocationCatalogue);
    assert.ok(catalogue instanceof GrpcLocationCatalogue);
  });
});
