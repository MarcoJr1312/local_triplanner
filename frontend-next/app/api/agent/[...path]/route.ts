import type { NextRequest } from 'next/server';
import { agentOrigin } from '@/lib/server-config';
import { withHttpMetrics } from '@/lib/metrics';

// Proxy for the agent service. Runtime env keeps the same Next image working
// in Compose, Helm and host development.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
  method: 'GET' | 'POST',
): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${agentOrigin()}/api/agent/${path.join('/')}`;

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
      { error: { code: 'AGENT_UNREACHABLE', message: 'Agent unavailable.' } },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

async function getHandler(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, ctx, 'GET');
}

async function postHandler(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxy(request, ctx, 'POST');
}

export const GET = withHttpMetrics('/api/agent/*', getHandler);
export const POST = withHttpMetrics('/api/agent/*', postHandler);
