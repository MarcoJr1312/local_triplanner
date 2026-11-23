// HTTP surface. Only /health and /ready are public inside the cluster; every
// /internal/v1 route requires the shared internal token. Self-service routes
// additionally require x-actor-id, resolved by the API from the session.

import type { UsersService } from './domain/service.ts';
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
  /** Optional so health/readiness can be tested without a domain service. */
  service?: UsersService;
}

interface RouteContext {
  url: URL;
  params: Record<string, string>;
  actor: string;
  body: Record<string, unknown>;
}

type RouteHandler = (ctx: RouteContext) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  actor: boolean;
  handler: RouteHandler;
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

function requireSelf(actor: string, userId: string): void {
  if (actor !== userId) {
    throw new AppError('FORBIDDEN', 'No autorizado para modificar estos favoritos.');
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

function makeRoute(
  method: string,
  path: string,
  handler: RouteHandler,
  actor = false,
): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([A-Za-z_]+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  return { method, pattern, keys, actor, handler };
}

function parseParams(route: Route, match: RegExpExecArray): Record<string, string> {
  const params: Record<string, string> = {};
  route.keys.forEach((key, index) => {
    const raw = match[index + 1] ?? '';
    try {
      params[key] = decodeURIComponent(raw);
    } catch {
      throw new AppError('INVALID_ARGUMENT', 'Parámetro de ruta inválido.');
    }
  });
  return params;
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
  const service = (): UsersService => {
    if (!deps.service) {
      throw new AppError('UNAVAILABLE', 'Servicio no disponible.');
    }
    return deps.service;
  };

  const routes: Route[] = [
    makeRoute('POST', '/internal/v1/auth/login', async (ctx) =>
      json(200, await service().login(ctx.body))),

    makeRoute('GET', '/internal/v1/users', async (ctx) =>
      json(200, {
        items: await service().listUsers(
          ctx.url.searchParams.get('query'),
          ctx.url.searchParams.get('limit'),
        ),
      })),

    makeRoute('GET', '/internal/v1/users/by-username/:username', async (ctx) =>
      json(200, await service().getByUsername(ctx.params.username ?? ''))),

    makeRoute('GET', '/internal/v1/users/by-email/:email', async (ctx) =>
      json(200, await service().getByEmail(ctx.params.email ?? ''))),

    makeRoute('POST', '/internal/v1/users/batch', async (ctx) =>
      json(200, { items: await service().batchUsers(ctx.body.ids) })),

    makeRoute('GET', '/internal/v1/users/:id/favorites', async (ctx) => {
      const id = ctx.params.id ?? '';
      requireSelf(ctx.actor, id);
      return json(200, { items: await service().listFavorites(id) });
    }, true),

    makeRoute('PUT', '/internal/v1/users/:id/favorites/:locationId', async (ctx) => {
      const id = ctx.params.id ?? '';
      requireSelf(ctx.actor, id);
      return json(200, await service().setFavorite(id, ctx.params.locationId ?? '', true));
    }, true),

    makeRoute('DELETE', '/internal/v1/users/:id/favorites/:locationId', async (ctx) => {
      const id = ctx.params.id ?? '';
      requireSelf(ctx.actor, id);
      return json(200, await service().setFavorite(id, ctx.params.locationId ?? '', false));
    }, true),

    makeRoute('POST', '/internal/v1/users', async (ctx) =>
      json(201, await service().createUser(ctx.body))),

    makeRoute('GET', '/internal/v1/users/:id/notifications', async (ctx) =>
      json(200, {
        items: await service().listNotifications(
          ctx.actor,
          ctx.params.id ?? '',
          ctx.url.searchParams.get('status'),
          ctx.url.searchParams.get('limit'),
        ),
      }), true),

    makeRoute('POST', '/internal/v1/notifications', async (ctx) => {
      const result = await service().createNotification(ctx.body);
      return json(result.created ? 201 : 200, result.notification);
    }),

    makeRoute('GET', '/internal/v1/notifications/:id', async (ctx) =>
      json(200, await service().getNotification(ctx.actor, ctx.params.id ?? '')), true),

    makeRoute('PATCH', '/internal/v1/notifications/:id', async (ctx) =>
      json(200, await service().updateNotification(ctx.actor, ctx.params.id ?? '', ctx.body)), true),

    makeRoute('GET', '/internal/v1/users/:id', async (ctx) =>
      json(200, await service().getUser(ctx.params.id ?? ''))),

    makeRoute(
      'PATCH',
      '/internal/v1/users/:id',
      async (ctx) =>
        json(200, await service().updateProfile(ctx.actor, ctx.params.id ?? '', ctx.body)),
      true,
    ),

    makeRoute('DELETE', '/internal/v1/users/:id', async (ctx) =>
      json(200, await service().deleteUser(ctx.params.id ?? ''))),
  ];

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

      const internal =
        url.pathname === '/internal/v1' || url.pathname.startsWith('/internal/v1/');
      if (!internal) {
        return json(404, { error: 'NOT_FOUND', message: 'Ruta no encontrada.' });
      }

      // Token-check unknown internal routes too, so an unauthenticated caller
      // cannot probe which routes exist.
      requireInternalToken(req, deps.internalToken);

      for (const route of routes) {
        if (route.method !== method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;

        const params = parseParams(route, match);
        const actor = route.actor ? requireActor(req) : '';
        const body =
          method === 'GET' || method === 'DELETE' ? {} : await readJson(req);

        return await route.handler({ url, params, actor, body });
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
