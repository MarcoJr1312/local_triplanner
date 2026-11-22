import type { NextRequest } from 'next/server';
import { backendGraphqlUrl } from '@/lib/server-config';

// Proxy seguro de GraphQL. El navegador SOLO habla con esta ruta; aqui se
// reenvia al backend local resolviendo el x-user-id del lado del servidor.
// No hay claves de servicios externos: el backend resuelve el catalogo local.

export const dynamic = 'force-dynamic';

const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';

export async function POST(request: NextRequest) {
  const backend = backendGraphqlUrl();

  let body: string;
  try {
    body = await request.text();
  } catch {
    return Response.json({ errors: [{ message: 'Petición inválida.' }] }, { status: 400 });
  }

  const xUserId = request.headers.get('x-user-id')?.trim() || DEMO_USER_ID;
  // Demo auth: the browser selects a seeded identity; no Firebase tokens travel.
  let upstream: Response;
  try {
    upstream = await fetch(backend, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': xUserId,
      },
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { errors: [{ message: 'The local backend is unavailable.' }] },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/json';

  // Las subscriptions GraphQL llegan como text/event-stream: hay que reenviar el
  // cuerpo TAL CUAL (streaming) en vez de buffearlo con .text(), o el navegador
  // nunca recibiria eventos. X-Accel-Buffering desactiva el buffering de nginx.
  if (contentType.includes('text/event-stream') && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': contentType },
  });
}
