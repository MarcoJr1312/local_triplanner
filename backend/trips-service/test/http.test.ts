import { describe, expect, test } from 'bun:test';
import { AppError, toErrorResponse } from '../src/errors.ts';
import {
  createHandler,
  MAX_BODY_BYTES,
  readJson,
  requireActor,
} from '../src/http.ts';

function makeHandler(overrides?: {
  ping?: () => Promise<void>;
  isMigrated?: () => Promise<boolean>;
}) {
  const db = {
    ping: overrides?.ping ?? (async () => undefined),
    isMigrated: overrides?.isMigrated ?? (async () => true),
  };
  return createHandler({ db, internalToken: 'test-token' });
}

function call(handler: (req: Request) => Promise<Response>, path: string, init?: RequestInit) {
  return handler(new Request(`http://localhost${path}`, init));
}

describe('health and readiness', () => {
  test('GET /health', async () => {
    const res = await call(makeHandler(), '/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /ready is ready when Postgres answers and is migrated', async () => {
    const res = await call(makeHandler(), '/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', postgres: 'ok', migrated: true });
  });

  test('GET /ready is 503 when the database is down', async () => {
    const res = await call(
      makeHandler({ ping: async () => Promise.reject(new Error('down')) }),
      '/ready',
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      postgres: 'down',
      migrated: false,
    });
  });

  test('GET /ready is 503 before migrations run', async () => {
    const res = await call(makeHandler({ isMigrated: async () => false }), '/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      postgres: 'ok',
      migrated: false,
    });
  });
});

describe('internal guard', () => {
  test('rejects a missing token on an internal route', async () => {
    const res = await call(makeHandler(), '/internal/v1/trips');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Token interno inválido.',
    });
  });

  test('rejects a wrong token', async () => {
    const res = await call(makeHandler(), '/internal/v1/trips', {
      headers: { 'x-internal-token': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  test('an authenticated unknown route is a 404', async () => {
    const res = await call(makeHandler(), '/internal/v1/nope', {
      headers: { 'x-internal-token': 'test-token' },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'NOT_FOUND',
      message: 'Ruta no encontrada.',
    });
  });

  test('a real internal route requires x-actor-id', async () => {
    const res = await call(makeHandler(), '/internal/v1/trips', {
      headers: { 'x-internal-token': 'test-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'ACTOR_REQUIRED',
      message: 'x-actor-id requerido.',
    });
  });

  test('a matched route without a domain service is 503', async () => {
    const res = await call(makeHandler(), '/internal/v1/trips', {
      headers: { 'x-internal-token': 'test-token', 'x-actor-id': 'u1' },
    });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'UNAVAILABLE' });
  });

  test('unknown public path is a 404', async () => {
    const res = await call(makeHandler(), '/nope');
    expect(res.status).toBe(404);
  });
});

describe('request helpers', () => {
  test('requireActor trims and returns the header', () => {
    const req = new Request('http://localhost', { headers: { 'x-actor-id': ' demo-user ' } });
    expect(requireActor(req)).toBe('demo-user');
  });

  test('requireActor rejects a missing header', () => {
    try {
      requireActor(new Request('http://localhost'));
      throw new Error('expected requireActor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('ACTOR_REQUIRED');
      expect((error as AppError).status).toBe(401);
    }
  });

  test('readJson accepts an empty body and an object', async () => {
    expect(await readJson(new Request('http://localhost', { method: 'POST' }))).toEqual({});
    expect(
      await readJson(new Request('http://localhost', { method: 'POST', body: '{"a":1}' })),
    ).toEqual({ a: 1 });
  });

  test('readJson rejects invalid JSON and non-objects', async () => {
    for (const body of ['{', '[]', '"x"']) {
      try {
        await readJson(new Request('http://localhost', { method: 'POST', body }));
        throw new Error('expected readJson to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('INVALID_ARGUMENT');
      }
    }
  });

  test('readJson enforces the body cap', async () => {
    const body = 'x'.repeat(MAX_BODY_BYTES + 1);
    try {
      await readJson(new Request('http://localhost', { method: 'POST', body }));
      throw new Error('expected readJson to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(413);
    }
  });
});

describe('error mapping', () => {
  test('does not leak an unexpected error message', () => {
    const { status, body } = toErrorResponse(new Error('database password is hunter2'));
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR', message: 'Error interno.' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
