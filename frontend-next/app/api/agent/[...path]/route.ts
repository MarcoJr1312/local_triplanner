import type { NextRequest } from 'next/server';

// Proxy for the agent service. Runtime env keeps the same Next image working
// in Docker (`http://agent:4100`) and in host development (`127.0.0.1:4100`).
const AGENT_ORIGIN = (process.env.NEXT_PRIVATE_AGENT_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');

export const dynamic = 'force-dynamic';

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
  method: 'GET' | 'POST',
): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${AGENT_ORIGIN}/api/agent/${path.join('/')}`;

  const headers: Record<string, string> = {};
  const xUserId = request.headers.get('x-user-id')?.trim();
  if (xUserId) headers['x-user-id'] = xUserId;

  let body: ArrayBuffer | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = request.headers.get('content-type') ?? 'application/json';
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
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

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, ctx, 'GET');
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, ctx, 'POST');
}
