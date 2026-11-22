import { backendOrigin, missingRuntimeConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

const API_TIMEOUT_MS = 2_000;

// Readiness gates on configuration only. The API reachability is reported in
// the body but never fails the probe: an API outage must not pull the only web
// pod out of the Service and replace the whole UI with an nginx 503 page. The
// app already shows its own degraded state when the API is down.
export async function GET(): Promise<Response> {
  const missing = missingRuntimeConfig();
  if (missing.length > 0) {
    return Response.json(
      { status: 'not_ready', backend: 'missing_config', missing },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${backendOrigin()}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) {
      return Response.json({
        status: 'ready',
        backend: 'down',
        upstream_status: response.status,
      });
    }
    return Response.json({ status: 'ready', backend: 'ok' });
  } catch {
    return Response.json({ status: 'ready', backend: 'down' });
  }
}
