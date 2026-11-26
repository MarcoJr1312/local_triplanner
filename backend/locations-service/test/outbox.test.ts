import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OutboxPublisher, toEvent } from '../src/outbox.ts';
import type { OutboxRow } from '../src/catalogue/mongo.ts';

const row: OutboxRow = {
  _id: 'outbox-1',
  event_id: 'event-1',
  location_id: 'loc-1',
  version: 4,
  type: 'location.changed.v1',
  payload: {
    id: 'loc-1',
    source: 'seed',
    place_id: null,
    data_id: null,
    slug: null,
    name: 'CN Tower',
    category: 'sight',
    raw_type: null,
    country: null,
    description: null,
    lat: 43.64,
    lng: -79.38,
    address: null,
    rating: 4.7,
    rating_count: 10,
    hours_json: null,
    website_url: null,
    social_links_json: null,
    phone: null,
    price_level: null,
    image_url: null,
    cost: 43,
    tags_json: null,
    duration_hours: null,
    parent_id: 'toronto',
    last_updated: '2026-11-23T00:00:00.000Z',
    version: 4,
    content_hash: 'hash',
    created_at: null,
    expires_at: null,
  },
  deleted: false,
  created_at: new Date('2026-11-23T00:00:00.000Z'),
  published_at: null,
  attempts: 0,
  last_error: null,
};

function storeFor(rows: OutboxRow[]) {
  const published: string[] = [];
  const failed: { id: string; error: string }[] = [];
  return {
    store: {
      listOutbox: async () => rows,
      markOutboxPublished: async (id: string) => {
        published.push(id);
      },
      markOutboxFailed: async (id: string, error: string) => {
        failed.push({ id, error });
      },
    },
    published,
    failed,
  };
}

describe('LocationChanged outbox publisher', () => {
  test('publishes a versioned event and marks it published', async () => {
    const { store, published } = storeFor([row]);
    let sent: any = null;
    const publisher = new OutboxPublisher({
      store,
      brokerUrl: 'http://broker',
      topic: 'LocationChanged',
      intervalMs: 1000,
      batchSize: 10,
      fetchImpl: (async (_url: any, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response('{}', { status: 201 });
      }) as unknown as typeof fetch,
      log: () => undefined,
    });

    assert.equal(await publisher.publishOnce(), 1);
    assert.deepEqual(published, ['event-1']);
    assert.equal(sent?.key, 'location:loc-1');
    const value = sent?.value as Record<string, unknown>;
    assert.equal(value.eventId, 'event-1');
    assert.equal(value.version, 4);
    assert.equal(value.deleted, false);
    assert.equal((value.location as Record<string, unknown>).name, 'CN Tower');
  });

  test('marks a failed publish for retry', async () => {
    const { store, failed, published } = storeFor([row]);
    const publisher = new OutboxPublisher({
      store,
      brokerUrl: 'http://broker',
      topic: 'LocationChanged',
      intervalMs: 1000,
      batchSize: 10,
      fetchImpl: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
      log: () => undefined,
    });

    assert.equal(await publisher.publishOnce(), 0);
    assert.deepEqual(published, []);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.id, 'event-1');
  });

  test('serializes deletes with a location id and no body', () => {
    const event = toEvent({ ...row, deleted: true, payload: null });
    assert.equal(event.deleted, true);
    assert.equal(event.locationId, 'loc-1');
    assert.equal(event.location, null);
  });
});
