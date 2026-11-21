// Contract tests for the remote catalogue client. No server or Mongo needed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogueUnavailableError, RemoteLocationCatalogue } from '../src/catalogue/remote.ts';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = new RemoteLocationCatalogue({
    baseUrl: 'http://locations:4300/',
    token: 'secret',
    timeoutMs: 500,
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return responder(call);
    },
  });
  return { client, calls };
}

describe('remote locations client', () => {
  test('search sends q, limit, coordinates and the internal token', async () => {
    const { client, calls } = makeClient(() => json({ items: [{ id: 'a', name: 'A' }] }));
    const rows = await client.search('cn tower', 25, { lat: 43.6, lng: -79.4 });

    assert.equal(rows.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/internal/v1/locations/search');
    assert.equal(url.searchParams.get('q'), 'cn tower');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(url.searchParams.get('lat'), '43.6');
    assert.equal(url.searchParams.get('lng'), '-79.4');
    assert.equal((calls[0]!.init?.headers as Record<string, string>)['x-internal-token'], 'secret');
  });

  test('list endpoints map to the v1 routes', async () => {
    const { client, calls } = makeClient((call) => {
      if (call.url.includes('/destinations/toronto/activities')) return json({ items: [] });
      if (call.url.includes('/destinations')) return json({ items: [{ id: 'toronto' }] });
      if (call.url.endsWith('/locations')) return json({ items: [{ id: 'p1' }] });
      return json({ items: [] });
    });

    assert.equal((await client.listDestinations()).length, 1);
    assert.equal((await client.listByParent('toronto')).length, 0);
    assert.equal((await client.listPlaces()).length, 1);
    assert.ok(calls.some((call) => call.url.endsWith('/internal/v1/locations')));
  });

  test('404 returns null for single-item lookups', async () => {
    const { client } = makeClient(() => json({ error: 'NOT_FOUND' }, 404));
    assert.equal(await client.getById('missing'), null);
    assert.equal(await client.getByPlaceId('missing'), null);
    assert.equal(await client.getByDataId('missing'), null);
  });

  test('non-2xx responses become CatalogueUnavailableError', async () => {
    const { client } = makeClient(() => json({ error: 'UNAVAILABLE' }, 503));
    await assert.rejects(() => client.listDestinations(), CatalogueUnavailableError);
  });

  test('network failures become CatalogueUnavailableError', async () => {
    const { client } = makeClient(() => {
      throw new Error('ECONNREFUSED');
    });
    await assert.rejects(() => client.search('toronto'), CatalogueUnavailableError);
  });

  test('upsert posts JSON and honours the overridden id', async () => {
    const { client, calls } = makeClient(() => json({ item: { id: 'new', name: 'New' } }));
    const row = await client.upsert({ id: 'new', name: 'New' });

    assert.equal(row.id, 'new');
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { id: 'new', name: 'New' });
  });
});
