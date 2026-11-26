// Prometheus metrics for the Next.js web. `/metrics` is served on the web HTTP
// port and the Cilium Gateway redirects public requests to `/`; Prometheus
// scrapes the ClusterIP directly. Only HTTP/runtime counters live here.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const SERVICE = 'web';
const VERSION = process.env.SERVICE_VERSION ?? 'dev';

interface WebMetrics {
  registry: Registry;
  httpRequests: Counter;
  httpDuration: Histogram;
  inFlight: Gauge;
  startDefaultMetrics: () => void;
  reset: () => void;
}

function createMetrics(): WebMetrics {
  const registry = new Registry();
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

  let defaultsStarted = false;

  return {
    registry,
    httpRequests,
    httpDuration,
    inFlight,
    startDefaultMetrics: () => {
      if (defaultsStarted) return;
      defaultsStarted = true;
      collectDefaultMetrics({ register: registry });
    },
    reset: () => {
      registry.resetMetrics();
      buildInfo.set({ version: VERSION }, 1);
    },
  };
}

// Next can evaluate the same module in more than one bundle in a single
// process. Keep one registry per process so counters do not reset on reload.
const globalForMetrics = globalThis as unknown as {
  __triplannerWebMetrics?: WebMetrics;
};
export const webMetrics = globalForMetrics.__triplannerWebMetrics ?? createMetrics();
globalForMetrics.__triplannerWebMetrics = webMetrics;

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  webMetrics.startDefaultMetrics();
  return {
    body: await webMetrics.registry.metrics(),
    contentType: webMetrics.registry.contentType,
  };
}

export function resetMetrics(): void {
  webMetrics.reset();
}

// Route labels are fixed by the caller; never derive them from the raw URL.
// Generic over the handler arguments so Next route handlers keep their
// NextRequest/context signature.
export function withHttpMetrics<TArgs extends [Request, ...unknown[]]>(
  route: string,
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async function metricsHandler(...args: TArgs): Promise<Response> {
    const req = args[0];
    const method = req?.method?.toUpperCase() ?? 'GET';
    const started = performance.now();
    webMetrics.inFlight.inc();
    let status = 500;
    try {
      const response = await handler(...args);
      status = response.status;
      return response;
    } finally {
      webMetrics.inFlight.dec();
      const labels = { method, route, status: String(status) };
      webMetrics.httpRequests.inc(labels);
      webMetrics.httpDuration.observe(labels, (performance.now() - started) / 1000);
    }
  };
}
