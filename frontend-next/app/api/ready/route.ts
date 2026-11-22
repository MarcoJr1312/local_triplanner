import { backendOrigin, missingRuntimeConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

const API_TIMEOUT_MS = 2_000;

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
      return Response.json(
        { status: 'not_ready', backend: 'down', upstream_status: response.status },
        { status: 503 },
      );
    }
    return Response.json({ status: 'ready', backend: 'ok' });
  } catch {
    return Response.json(
      { status: 'not_ready', backend: 'down' },
      { status: 503 },
    );
  }
}
