import { beforeEach, describe, expect, test } from 'bun:test';
import { createHandler } from '../src/http.ts';
import { resetMetrics } from '../src/metrics.ts';

function makeHandler() {
  const db = {
    ping: async () => undefined,
    isMigrated: async () => true,
  };
  return createHandler({ db, internalToken: 'test-token' });
}

function call(handler: (req: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handler(new Request(`http://localhost${path}`, init));
}

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  test('GET /metrics exposes Prometheus text with runtime metrics', async () => {
    const res = await call(makeHandler(), '/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('triplanner_build_info');
    expect(body).toContain('triplanner_http_requests_total');
    expect(body).toContain('triplanner_http_request_duration_seconds');
    expect(body).toContain('triplanner_http_requests_in_flight');
    expect(body).toContain('service="trips"');
    expect(body).toContain('process_cpu_seconds_total');
  });

  test('records health requests with bounded labels', async () => {
    const handler = makeHandler();
    await call(handler, '/health');
    const body = await (await call(handler, '/metrics')).text();
    expect(body).toContain('route="/health"');
    expect(body).toContain('status="200"');
    expect(body).toContain('method="GET"');
  });

  test('never records identifiers or raw paths', async () => {
    const handler = makeHandler();
    const marker = 'trip-7b2d1a';
    await call(handler, `/internal/v1/trips/${marker}/items/item-456`, {
      headers: { 'x-internal-token': 'test-token', 'x-actor-id': 'demo' },
    });
    const body = await (await call(handler, '/metrics')).text();
    expect(body).not.toContain(marker);
    expect(body).not.toContain('item-456');
    expect(body).toContain('route="/internal/v1/trips/*"');
  });

  test('does not count its own scrapes', async () => {
    const handler = makeHandler();
    await call(handler, '/metrics');
    const body = await (await call(handler, '/metrics')).text();
    expect(body).not.toContain('route="/metrics"');
  });
});
