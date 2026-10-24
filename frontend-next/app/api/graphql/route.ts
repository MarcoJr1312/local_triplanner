import type { NextRequest } from 'next/server';

// Proxy seguro de GraphQL. El navegador SOLO habla con esta ruta; aqui se
// reenvia al backend local resolviendo el x-user-id del lado del servidor.
// La key de HasData JAMAS se usa aqui ni se expone: vive solo en el backend
// local (localhost:4000).

const DEFAULT_BACKEND = 'http://localhost:4000/graphql';
const DEMO_USER_ID = 'demo-user';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const backend = (process.env.NEXT_PRIVATE_BACKEND_URL ?? '').trim() || DEFAULT_BACKEND;

  let body: string;
  try {
    body = await request.text();
  } catch {
    return Response.json({ errors: [{ message: 'Petición inválida.' }] }, { status: 400 });
  }

  const xUserId = request.headers.get('x-user-id')?.trim() || DEMO_USER_ID;
  // Reenvia el ID token de Firebase (si lo hay) para que el backend pueda
  // resolver/verificar el usuario autenticado. En modo demo no llega.
  const authorization = request.headers.get('authorization');

  let upstream: Response;
  try {
    upstream = await fetch(backend, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': xUserId,
        ...(authorization ? { authorization } : {}),
      },
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { errors: [{ message: 'No se pudo conectar con el backend local.' }] },
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
