// Prometheus metrics for the email service. `/metrics` shares the internal
// HTTP port and never touches the broker or Resend; only HTTP/runtime counters
// live here.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const SERVICE = 'email';
const VERSION = process.env.SERVICE_VERSION ?? 'dev';

export const registry = new Registry();
registry.setDefaultLabels({ service: SERVICE });

const buildInfo = new Gauge({
  name: 'triplanner_build_info',
  help: 'Triplanner build information; always 1.',
  labelNames: ['version'],
  registers: [registry],
});
buildInfo.set({ version: VERSION }, 1);

const httpRequests = new Counter({
  name: 'triplanner_http_requests_total',
  help: 'Completed HTTP requests.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpDuration = new Histogram({
  name: 'triplanner_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
  registers: [registry],
});

const inFlight = new Gauge({
  name: 'triplanner_http_requests_in_flight',
  help: 'HTTP requests currently being served.',
  registers: [registry],
});

const EXACT_ROUTES = new Set(['/health', '/ready', '/metrics', '/api/email/config']);

// Route labels must stay bounded: fixed routes only, never IDs or query data.
export function normalizeRoute(pathname: string): string {
  if (EXACT_ROUTES.has(pathname)) return pathname;
  return 'other';
}

export function observeHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationSeconds: number;
}): void {
  const labels = {
    method: input.method.toUpperCase(),
    route: input.route,
    status: String(input.status),
  };
  httpRequests.inc(labels);
  httpDuration.observe(labels, input.durationSeconds);
}

let defaultMetricsStarted = false;

export function startDefaultMetrics(): void {
  if (defaultMetricsStarted) return;
  defaultMetricsStarted = true;
  collectDefaultMetrics({ register: registry });
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  startDefaultMetrics();
  return { body: await registry.metrics(), contentType: registry.contentType };
}

export function resetMetrics(): void {
  registry.resetMetrics();
  buildInfo.set({ version: VERSION }, 1);
}

// Attach HTTP metrics to a Node request/response pair. `finish` covers normal
// responses; `close` covers client aborts. `/metrics` is never counted.
export function instrumentNodeRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/metrics') return;

  const method = (req.method ?? 'GET').toUpperCase();
  const route = normalizeRoute(url.pathname);
  const started = performance.now();
  let done = false;

  const complete = (): void => {
    if (done) return;
    done = true;
    inFlight.dec();
    observeHttpRequest({
      method,
      route,
      status: res.statusCode,
      durationSeconds: (performance.now() - started) / 1000,
    });
  };

  inFlight.inc();
  res.once('finish', complete);
  res.once('close', complete);
}
