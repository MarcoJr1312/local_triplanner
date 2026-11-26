import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startHttpServer, type HttpHandle } from '../src/http.ts';
import type { Logger } from '../src/logger.ts';
import { EmailSettingsStore } from '../src/settings.ts';
import { resetMetrics } from '../src/metrics.ts';

function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

describe('email service metrics', () => {
  let dir: string;
  let handle: HttpHandle;
  let base: string;

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'triplanner-email-metrics-'));
    const settings = new EmailSettingsStore({
      filePath: path.join(dir, 'email.json'),
      defaults: {
        provider: 'sink',
        apiKey: '',
        from: 'Triplanner <onboarding@resend.dev>',
        replyTo: '',
      },
      logger: silentLogger(),
    });
    handle = await startHttpServer({
      port: 0,
      logger: silentLogger(),
      settings,
      internalToken: 'test-token',
      getState: () => ({
        ready: true,
        provider: 'sink',
        providerReady: true,
        brokerReady: true,
      }),
    });
    base = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => resetMetrics());

  test('GET /metrics exposes Prometheus text with runtime metrics', async () => {
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    const body = await res.text();
    assert.match(body, /triplanner_build_info/);
    assert.match(body, /triplanner_http_requests_total/);
    assert.match(body, /triplanner_http_request_duration_seconds/);
    assert.match(body, /triplanner_http_requests_in_flight/);
    assert.match(body, /service="email"/);
    assert.match(body, /process_cpu_seconds_total/);
  });

  test('records health requests with bounded labels', async () => {
    const res = await fetch(`${base}/health`);
    await res.text();
    const body = await (await fetch(`${base}/metrics`)).text();
    assert.match(body, /route="\/health"/);
    assert.match(body, /status="200"/);
    assert.match(body, /method="GET"/);
  });

  test('does not count its own scrapes', async () => {
    await (await fetch(`${base}/metrics`)).text();
    const body = await (await fetch(`${base}/metrics`)).text();
    assert.ok(!body.includes('route="/metrics"'));
  });
});
