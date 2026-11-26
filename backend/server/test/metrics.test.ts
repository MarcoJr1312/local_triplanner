import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoute, renderMetrics, resetMetrics } from '../src/metrics.ts';

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  test('renders Prometheus text with runtime metrics', async () => {
    const { body, contentType } = await renderMetrics();
    assert.match(contentType, /text\/plain/);
    assert.match(body, /triplanner_build_info/);
    assert.match(body, /triplanner_http_requests_total/);
    assert.match(body, /triplanner_http_request_duration_seconds/);
    assert.match(body, /triplanner_http_requests_in_flight/);
    assert.match(body, /service="api"/);
    assert.match(body, /process_cpu_seconds_total/);
  });

  test('normalizes API routes without identifiers', () => {
    assert.equal(normalizeRoute('/graphql'), '/graphql');
    assert.equal(normalizeRoute('/health'), '/health');
    assert.equal(normalizeRoute('/internal/trip-context/trip-123'), '/internal/trip-context/*');
    assert.equal(normalizeRoute('/internal/save-chat'), '/internal/save-chat/*');
    assert.equal(normalizeRoute('/uploads/seed/cn-tower.jpg'), '/uploads/*');
    assert.equal(normalizeRoute('/unknown/path'), 'other');
  });
});
