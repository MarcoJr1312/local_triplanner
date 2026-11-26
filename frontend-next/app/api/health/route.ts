import { withHttpMetrics } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function health(_request: Request): Promise<Response> {
  return Response.json({ status: 'ok' });
}

export const GET = withHttpMetrics('/api/health', health);
