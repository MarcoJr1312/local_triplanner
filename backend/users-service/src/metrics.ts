// Prometheus metrics for the users service. `/metrics` shares the internal
// HTTP port and never touches PostgreSQL; HTTP/gRPC/runtime counters live here.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const SERVICE = 'users';
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

const EXACT_ROUTES = new Set(['/health', '/ready', '/metrics']);

// Route labels must stay bounded: resource-level templates only, never IDs.
export function normalizeRoute(pathname: string): string {
  if (EXACT_ROUTES.has(pathname)) return pathname;
  const internal = /^\/internal\/v1\/([^/]+)/.exec(pathname);
  if (internal) return `/internal/v1/${internal[1]}/*`;
  if (pathname === '/internal/v1' || pathname === '/internal/v1/') return '/internal/v1/*';
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

const grpcRequests = new Counter({
  name: 'triplanner_grpc_requests_total',
  help: 'Completed gRPC requests.',
  labelNames: ['method', 'status'],
  registers: [registry],
});

const grpcDuration = new Histogram({
  name: 'triplanner_grpc_request_duration_seconds',
  help: 'gRPC request duration in seconds.',
  labelNames: ['method', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
  registers: [registry],
});

// Method labels are bounded by the proto contract; never use raw metadata.
export function observeGrpcRequest(input: {
  method: string;
  status: string;
  durationSeconds: number;
}): void {
  const labels = { method: input.method, status: input.status };
  grpcRequests.inc(labels);
  grpcDuration.observe(labels, input.durationSeconds);
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

export function withHttpMetrics(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async function metricsHandler(req: Request): Promise<Response> {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/metrics') return handler(req);

    const method = req.method.toUpperCase();
    const route = normalizeRoute(url.pathname);
    const started = performance.now();
    inFlight.inc();
    let status = 500;
    try {
      const response = await handler(req);
      status = response.status;
      return response;
    } finally {
      inFlight.dec();
      observeHttpRequest({
        method,
        route,
        status,
        durationSeconds: (performance.now() - started) / 1000,
      });
    }
  };
}
