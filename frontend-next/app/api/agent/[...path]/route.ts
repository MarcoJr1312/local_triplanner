import type { NextRequest } from 'next/server';

// Proxy del servicio agente (127.0.0.1:4100) como ROUTE HANDLER.
// Reemplaza el rewrite de next.config.ts porque el proxy de rewrites del
// dev server corta los pedidos a los 30s exactos y el agente tarda 20-90s
// (LLM + RAG en frío). El fetch del servidor NO tiene ese límite; timeout
// generoso de 150s (el agente propio corta a 90s).

const AGENT_ORIGIN = (process.env.NEXT_PRIVATE_AGENT_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${AGENT_ORIGIN}/api/agent/${path.join('/')}`;

  const authorization = request.headers.get('authorization');
  const xUserId = request.headers.get('x-user-id')?.trim();
  const contentType = request.headers.get('content-type') ?? 'application/json';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        ...(authorization ? { authorization } : {}),
        ...(xUserId ? { 'x-user-id': xUserId } : {}),
      },
      body: await request.arrayBuffer(),
      cache: 'no-store',
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    return Response.json(
      { error: { code: 'AGENT_UNREACHABLE', message: 'El agente no está disponible.' } },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
