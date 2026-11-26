// HasData client tests with a mocked fetch. No network or key required.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HasDataClient, HasDataError, DEFAULT_HASDATA_TTL_MS } from '../src/hasdata.ts';

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

function client(responder: (call: Call) => Response, apiKey = 'hd_test_key') {
  const calls: Call[] = [];
  const instance = new HasDataClient({
    apiKey,
    baseUrl: 'https://hasdata.test/scrape/google-maps/',
    hl: 'en',
    gl: 'ca',
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return responder(call);
    },
  });
  return { instance, calls };
}

describe('HasData client', () => {
  test('normalizes search results and sends the x-api-key header', async () => {
    const { instance, calls } = client(() =>
      json({
        localResults: [
          {
            title: 'CN Tower',
            placeId: 'place-cn',
            latitude: 43.6426,
            longitude: -79.3871,
            rating: 4.8,
            reviews: 1200,
            type: 'Tourist attraction',
            address: '290 Bremner Blvd',
            website: 'https://cntower.ca',
            phone: '+1 416 000 0000',
            imageUrl: 'https://img.example/cn.jpg',
            description: 'Iconic tower',
          },
        ],
      }),
    );

    const rows = await instance.search('cn tower', {
      lat: 43.6532,
      lng: -79.3832,
      limit: 10,
    });

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.id, 'tor-place-cn');
    assert.equal(row.place_id, 'place-cn');
    assert.equal(row.name, 'CN Tower');
    assert.equal(row.category, 'sight');
    assert.equal(row.rating, 4.8);
    assert.equal(row.rating_count, 1200);
    assert.equal(row.lat, 43.6426);
    assert.equal(row.lng, -79.3871);
    assert.equal(row.source, 'hasdata');
    assert.match(String(row.expires_at), /^\d{4}-\d{2}-\d{2}T/);

    const expires = new Date(String(row.expires_at)).getTime();
    assert.ok(expires > Date.now() + DEFAULT_HASDATA_TTL_MS - 60_000);
    assert.ok(expires < Date.now() + DEFAULT_HASDATA_TTL_MS + 60_000);

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/scrape/google-maps/search');
    assert.equal(url.searchParams.get('q'), 'cn tower');
    assert.equal(url.searchParams.get('ll'), '@43.6532,-79.3832,12z');
    assert.equal((calls[0]!.init?.headers as Record<string, string>)['x-api-key'], 'hd_test_key');
  });

  test('normalizes a place response and requests the place endpoint', async () => {
    const { instance, calls } = client(() =>
      json({
        place: {
          title: 'Royal Ontario Museum',
          placeId: 'place-rom',
          latitude: 43.6677,
          longitude: -79.3948,
          type: 'Museum',
        },
      }),
    );

    const row = await instance.getPlace('place-rom');
    assert.equal(row?.id, 'tor-place-rom');
    assert.equal(row?.name, 'Royal Ontario Museum');
    assert.equal(row?.category, 'sight');

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/scrape/google-maps/place');
    assert.equal(url.searchParams.get('placeId'), 'place-rom');
    assert.equal(url.searchParams.get('fetchWebResults'), 'false');
  });

  test('empty queries do not consume a request', async () => {
    const { instance, calls } = client(() => json({ localResults: [] }));
    assert.deepEqual(await instance.search('   '), []);
    assert.equal(calls.length, 0);
  });

  test('HTTP failures become HasDataError without the key in the message', async () => {
    const { instance } = client(() => new Response('nope', { status: 429 }));
    await assert.rejects(
      () => instance.search('cn tower'),
      (error: unknown) =>
        error instanceof HasDataError &&
        error.status === 429 &&
        !error.message.includes('hd_test_key'),
    );
  });
});
