// @ts-nocheck
import { beforeEach, describe, expect, test } from 'bun:test';
import { renderMetrics, resetMetrics, withHttpMetrics } from './metrics';

describe('web metrics', () => {
  beforeEach(() => resetMetrics());

  test('renders Prometheus text with runtime metrics', async () => {
    const { body, contentType } = await renderMetrics();
    expect(contentType).toContain('text/plain');
    expect(body).toContain('triplanner_build_info');
    expect(body).toContain('triplanner_http_requests_total');
    expect(body).toContain('triplanner_http_request_duration_seconds');
    expect(body).toContain('triplanner_http_requests_in_flight');
    expect(body).toContain('service="web"');
    expect(body).toContain('process_cpu_seconds_total');
  });

  test('records a fixed route label', async () => {
    const handler = withHttpMetrics('/api/health', async (_req: Request) =>
      Response.json({ status: 'ok' }),
    );
    await handler(new Request('http://localhost/api/health'));
    const { body } = await renderMetrics();
    expect(body).toContain('route="/api/health"');
    expect(body).toContain('status="200"');
    expect(body).toContain('method="GET"');
  });

  test('never records the raw path or query string', async () => {
    const handler = withHttpMetrics('/api/agent/*', async (_req: Request) =>
      Response.json({ ok: true }),
    );
    await handler(new Request('http://localhost/api/agent/suggestions?trip=trip-123'));
    const { body } = await renderMetrics();
    expect(body).not.toContain('trip-123');
    expect(body).not.toContain('/api/agent/suggestions');
    expect(body).toContain('route="/api/agent/*"');
  });
});
