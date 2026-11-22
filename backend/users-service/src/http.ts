// HTTP surface. Only /health and /ready are public inside the cluster; every
// /internal/v1 route requires the shared internal token. Actor-scoped routes
// additionally require x-actor-id, resolved by the API from the session.

import { verifyInternalToken } from './env.ts';
import { AppError, toErrorResponse } from './errors.ts';

export const MAX_BODY_BYTES = 1_048_576;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export interface ReadinessDb {
  ping(): Promise<void>;
  isMigrated(): Promise<boolean>;
}

export interface HttpDeps {
  db: ReadinessDb;
  internalToken: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function requireInternalToken(req: Request, expected: string): void {
  const provided = req.headers.get('x-internal-token');
  if (!verifyInternalToken(expected, provided)) {
    throw new AppError('UNAUTHORIZED', 'Token interno inválido.');
  }
}

export function requireActor(req: Request): string {
  const actor = req.headers.get('x-actor-id')?.trim();
  if (!actor) {
    throw new AppError('ACTOR_REQUIRED', 'x-actor-id requerido.');
  }
  return actor;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new AppError('INVALID_ARGUMENT', 'Cuerpo demasiado grande.', 413);
  }
  const text = new TextDecoder().decode(buffer).trim();
  if (text === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_ARGUMENT', 'JSON inválido.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('INVALID_ARGUMENT', 'Se esperaba un objeto JSON.');
  }
  return parsed as Record<string, unknown>;
}

async function readiness(deps: HttpDeps): Promise<Response> {
  try {
    await deps.db.ping();
  } catch {
    return json(503, { status: 'not_ready', postgres: 'down', migrated: false });
  }

  let migrated = false;
  try {
    migrated = await deps.db.isMigrated();
  } catch {
    migrated = false;
  }
  if (!migrated) {
    return json(503, { status: 'not_ready', postgres: 'ok', migrated: false });
  }
  return json(200, { status: 'ready', postgres: 'ok', migrated: true });
}

export function createHandler(deps: HttpDeps): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();

      if (method === 'GET' && url.pathname === '/health') {
        return json(200, { status: 'ok' });
      }
      if (method === 'GET' && url.pathname === '/ready') {
        return await readiness(deps);
      }

      // Token-check unknown internal routes too, so an unauthenticated caller
      // cannot probe which routes exist.
      if (url.pathname === '/internal/v1' || url.pathname.startsWith('/internal/v1/')) {
        requireInternalToken(req, deps.internalToken);
        return json(404, { error: 'NOT_FOUND', message: 'Ruta no encontrada.' });
      }

      return json(404, { error: 'NOT_FOUND', message: 'Ruta no encontrada.' });
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      if (status >= 500 && !(error instanceof AppError)) {
        console.error('[users] unhandled request error:', error);
      }
      return json(status, body);
    }
  };
}
