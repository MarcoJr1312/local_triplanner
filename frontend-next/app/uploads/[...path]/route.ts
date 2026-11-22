import type { NextRequest } from 'next/server';
import { backendOrigin } from '@/lib/server-config';

// Same-origin proxy for uploaded bytes. Runs at request time so Compose and
// Helm can point it at the API service without rebuilding the image.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(request.url);
  const target = `${backendOrigin()}/uploads/${path.map(encodeURIComponent).join('/')}${url.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, { cache: 'no-store' });
  } catch {
    return new Response('No se pudo leer el archivo.', { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'Cache-Control': upstream.headers.get('cache-control') ?? 'no-store',
    },
  });
}
