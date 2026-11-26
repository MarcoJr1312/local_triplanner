// Metrics contract tests with an in-memory catalogue; no MongoDB required.

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, type SeedState } from '../src/http.ts';
import { resetMetrics } from '../src/metrics.ts';
import type { LocationCatalogue } from '../src/catalogue/types.ts';
import type { LocationsSettingsProvider } from '../src/settings.ts';

const catalogue = {
  ping: async () => undefined,
  getById: async () => null,
} as unknown as LocationCatalogue;

const settings = {
  public: () => ({
    provider: 'preloaded' as const,
    hasKey: false,
    cacheTtlHours: 120,
  }),
} as unknown as LocationsSettingsProvider;

const seedState: SeedState = {
  enabled: false,
  seeded: true,
  count: 0,
  lastError: null,
};

function makeHandler() {
  return createHandler({
    catalogue,
    settings,
    verifyToken: () => true,
    seedState,
  });
}

function call(handler: (req: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handler(new Request(`http://localhost${path}`, init));
}

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  test('GET /metrics exposes Prometheus text with runtime metrics', async () => {
    const res = await call(makeHandler(), '/metrics');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    const body = await res.text();
    assert.match(body, /triplanner_build_info/);
    assert.match(body, /triplanner_http_requests_total/);
    assert.match(body, /triplanner_http_request_duration_seconds/);
    assert.match(body, /triplanner_http_requests_in_flight/);
    assert.match(body, /service="locations"/);
    assert.match(body, /process_cpu_seconds_total/);
  });

  test('records health requests with bounded labels', async () => {
    const handler = makeHandler();
    await call(handler, '/health');
    const body = await (await call(handler, '/metrics')).text();
    assert.match(body, /route="\/health"/);
    assert.match(body, /status="200"/);
    assert.match(body, /method="GET"/);
  });

  test('never records identifiers or raw paths', async () => {
    const handler = makeHandler();
    const marker = 'loc-4c9e1b';
    await call(handler, `/internal/v1/locations/${marker}`, {
      headers: { 'x-internal-token': 'test-token' },
    });
    const body = await (await call(handler, '/metrics')).text();
    assert.ok(!body.includes(marker));
    assert.match(body, /route="\/internal\/v1\/locations\/\*"/);
  });

  test('does not count its own scrapes', async () => {
    const handler = makeHandler();
    await call(handler, '/metrics');
    const body = await (await call(handler, '/metrics')).text();
    assert.ok(!body.includes('route="/metrics"'));
  });
});
