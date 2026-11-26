// HTTP surface. Only /health and /ready are public inside the cluster; every
// /internal/v1 route requires the shared internal token. Actor-scoped routes
// additionally require x-actor-id, resolved by the API from the browser.

import type { TripsService } from './domain/service.ts';
import { verifyInternalToken } from './env.ts';
import { AppError, toErrorResponse } from './errors.ts';
import { renderMetrics, withHttpMetrics } from './metrics.ts';

export const MAX_BODY_BYTES = 1_048_576;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export interface ReadinessDb {
  ping(): Promise<void>;
  isMigrated(): Promise<boolean>;
  outboxPending?(): Promise<number>;
}

export interface HttpDeps {
  db: ReadinessDb;
  internalToken: string;
  /** Optional so health/readiness can be tested without a domain service. */
  service?: TripsService;
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
  actor = true,
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

  const body: Record<string, unknown> = { status: 'ready', postgres: 'ok', migrated: true };
  if (deps.db.outboxPending) {
    try {
      body.outbox_pending = await deps.db.outboxPending();
    } catch {
      // Informational only; a count failure must not fail readiness.
    }
  }
  return json(200, body);
}

export function createHandler(deps: HttpDeps): (req: Request) => Promise<Response> {
  const service = (): TripsService => {
    if (!deps.service) {
      throw new AppError('UNAVAILABLE', 'Servicio no disponible.');
    }
    return deps.service;
  };

  const routes: Route[] = [
    makeRoute('POST', '/internal/v1/trips', async (ctx) =>
      json(201, await service().createTrip(ctx.actor, ctx.body))),

    makeRoute('GET', '/internal/v1/trips', async (ctx) =>
      json(200, { items: await service().listTrips(ctx.actor) })),

    makeRoute('GET', '/internal/v1/trips/:id/context', async (ctx) =>
      json(200, await service().getContext(ctx.actor, ctx.params.id ?? ''))),

    makeRoute('GET', '/internal/v1/trips/:id/members', async (ctx) =>
      json(200, { items: await service().listMembers(ctx.actor, ctx.params.id ?? '') })),

    makeRoute('POST', '/internal/v1/trips/:id/members', async (ctx) =>
      json(201, await service().addMember(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('PATCH', '/internal/v1/trips/:id/members/:userId', async (ctx) =>
      json(200, await service().updateMemberRole(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.userId ?? '',
        ctx.body,
      ))),

    makeRoute('DELETE', '/internal/v1/trips/:id/members/:userId', async (ctx) =>
      json(200, await service().removeMember(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.userId ?? '',
      ))),

    makeRoute('POST', '/internal/v1/trips/:id/invitations', async (ctx) =>
      json(201, await service().createInvitation(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('GET', '/internal/v1/invitations/by-code/:code', async (ctx) =>
      json(200, await service().previewInvitation(ctx.params.code ?? '')), false),

    makeRoute('POST', '/internal/v1/trips/:id/join', async (ctx) =>
      json(200, await service().joinTrip(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('POST', '/internal/v1/trips/:id/local-invite', async (ctx) => {
      const result = await service().createLocalInvitation(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.body,
      );
      return json(result.created ? 201 : 200, result.invitation);
    }),

    makeRoute('POST', '/internal/v1/trips/:id/join-local', async (ctx) =>
      json(200, await service().joinLocal(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute(
      'POST',
      '/internal/v1/trips/:id/local-invite/:invitationId/decline',
      async (ctx) =>
        json(200, await service().declineLocalInvitation(
          ctx.actor,
          ctx.params.id ?? '',
          {
            ...ctx.body,
            invitation_id: ctx.params.invitationId ?? '',
          },
        )),
    ),

    makeRoute(
      'POST',
      '/internal/v1/trips/:id/local-invite/:invitationId/revoke',
      async (ctx) =>
        json(200, await service().revokeLocalInvitation(
          ctx.actor,
          ctx.params.id ?? '',
          ctx.params.invitationId ?? '',
        )),
    ),

    makeRoute('POST', '/internal/v1/trips/:id/leave', async (ctx) =>
      json(200, await service().leaveTrip(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('GET', '/internal/v1/trips/:id/items', async (ctx) =>
      json(200, { items: await service().listItems(ctx.actor, ctx.params.id ?? '') })),

    makeRoute('POST', '/internal/v1/trips/:id/items', async (ctx) =>
      json(201, await service().addItem(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('PATCH', '/internal/v1/trips/:id/items/:itemId', async (ctx) =>
      json(200, await service().updateItem(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
        ctx.body,
      ))),

    makeRoute('DELETE', '/internal/v1/trips/:id/items/:itemId', async (ctx) =>
      json(200, await service().deleteItem(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
      ))),

    makeRoute('POST', '/internal/v1/trips/:id/items/:itemId/move', async (ctx) =>
      json(200, await service().moveItem(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
        ctx.body,
      ))),

    makeRoute('POST', '/internal/v1/trips/:id/items/:itemId/reminder', async (ctx) =>
      json(200, await service().setReminder(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
        ctx.body,
      ))),

    makeRoute('PUT', '/internal/v1/trips/:id/items/:itemId/reminder', async (ctx) =>
      json(200, await service().setReminder(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
        ctx.body,
      ))),

    makeRoute('GET', '/internal/v1/trips/:id/items/:itemId/reminder', async (ctx) =>
      json(200, await service().getReminder(
        ctx.actor,
        ctx.params.id ?? '',
        ctx.params.itemId ?? '',
      ))),

    makeRoute('GET', '/internal/v1/reminders/due', async (ctx) => {
      const raw = ctx.url.searchParams.get('now');
      const now = raw ? new Date(raw) : new Date();
      return json(200, {
        items: await service().dueReminders(
          Number.isFinite(now.getTime()) ? now : new Date(),
        ),
      });
    }, false),

    makeRoute('POST', '/internal/v1/reminders/:itemId/sent', async (ctx) => {
      const ids = Array.isArray(ctx.body.user_ids)
        ? ctx.body.user_ids.filter((value): value is string => typeof value === 'string')
        : [];
      await service().markReminderSent(ctx.params.itemId ?? '', ids);
      return json(200, { ok: true });
    }, false),

    makeRoute('GET', '/internal/v1/items/:itemId', async (ctx) =>
      json(200, await service().getItemForActor(ctx.actor, ctx.params.itemId ?? ''))),

    makeRoute('GET', '/internal/v1/trips/:id', async (ctx) =>
      json(200, await service().getTrip(ctx.actor, ctx.params.id ?? ''))),

    makeRoute('PATCH', '/internal/v1/trips/:id', async (ctx) =>
      json(200, await service().updateTrip(ctx.actor, ctx.params.id ?? '', ctx.body))),

    makeRoute('DELETE', '/internal/v1/trips/:id', async (ctx) =>
      json(200, await service().deleteTrip(ctx.actor, ctx.params.id ?? ''))),
  ];

  return withHttpMetrics(async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();

      if (method === 'GET' && url.pathname === '/metrics') {
        const { body, contentType } = await renderMetrics();
        return new Response(body, {
          status: 200,
          headers: { 'content-type': contentType, 'cache-control': 'no-store' },
        });
      }
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
        console.error('[trips] unhandled request error:', error);
      }
      return json(status, body);
    }
  });
}
