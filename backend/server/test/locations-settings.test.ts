// API client tests for the locations BYOK settings proxy.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocationsSettingsClient,
  LocationsSettingsError,
} from '../src/locations-settings.ts';

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

function makeClient(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const client = createLocationsSettingsClient({
    baseUrl: 'http://locations:4300/',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      const call = { url: String(url), init };
      calls.push(call);
      return responder(call);
    },
  });
  return { client, calls };
}

describe('locations settings client', () => {
  test('reads public settings without a key', async () => {
    const { client, calls } = makeClient(() =>
      json({ provider: 'preloaded', hasKey: false, ready: true, cachedPlaces: 187 }),
    );
    const settings = await client.get();

    assert.deepEqual(settings, {
      provider: 'preloaded',
      hasKey: false,
      ready: true,
      cachedPlaces: 187,
    });
    assert.equal(new URL(calls[0]!.url).pathname, '/api/locations/config');
    assert.equal(calls[0]!.init?.method, undefined);
  });

  test('writes provider and key with the internal token and never returns the key', async () => {
    const { client, calls } = makeClient(() =>
      json({ provider: 'hasdata', hasKey: true, ready: true, cachedPlaces: 187 }),
    );
    const settings = await client.update({ provider: 'hasdata', apiKey: 'hd_secret' });

    assert.equal(settings.hasKey, true);
    assert.equal(JSON.stringify(settings).includes('hd_secret'), false);
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.equal(
      (calls[0]!.init?.headers as Record<string, string>)['x-internal-token'],
      'test-token',
    );
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
      provider: 'hasdata',
      apiKey: 'hd_secret',
    });
  });

  test('clearing the key sends clearKey and preloaded', async () => {
    const { client, calls } = makeClient(() =>
      json({ provider: 'preloaded', hasKey: false, ready: true, cachedPlaces: 0 }),
    );
    await client.update({ provider: 'preloaded', clearKey: true });
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
      provider: 'preloaded',
      clearKey: true,
    });
  });

  test('maps invalid configuration errors', async () => {
    const { client } = makeClient(() =>
      json({ error: { code: 'LOCATIONS_CONFIG_INVALID', message: 'API key required' } }, 400),
    );
    await assert.rejects(
      () => client.update({ provider: 'hasdata' }),
      (error: unknown) =>
        error instanceof LocationsSettingsError && error.code === 'LOCATIONS_CONFIG_INVALID',
    );
  });

  test('maps transport and server failures', async () => {
    const down = makeClient(() => json({ error: 'unavailable' }, 503));
    await assert.rejects(
      () => down.client.get(),
      (error: unknown) =>
        error instanceof LocationsSettingsError && error.code === 'LOCATIONS_SETTINGS_FAILED',
    );

    const offline = createLocationsSettingsClient({
      baseUrl: 'http://locations:4300',
      token: 'test-token',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await assert.rejects(
      () => offline.get(),
      (error: unknown) =>
        error instanceof LocationsSettingsError && error.code === 'LOCATIONS_SETTINGS_FAILED',
    );
  });
});
