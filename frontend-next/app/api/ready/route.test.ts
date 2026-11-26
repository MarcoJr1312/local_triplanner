// @ts-nocheck
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GET } from './route';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_BACKEND = process.env.NEXT_PRIVATE_BACKEND_URL;
const ORIGINAL_AGENT = process.env.NEXT_PRIVATE_AGENT_URL;
const ORIGINAL_ORIGIN = process.env.NEXT_PRIVATE_BACKEND_ORIGIN;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.NEXT_PRIVATE_BACKEND_URL = 'http://api:4000/graphql';
  process.env.NEXT_PRIVATE_BACKEND_ORIGIN = 'http://api:4000';
  process.env.NEXT_PRIVATE_AGENT_URL = 'http://agent:4100';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restore('NEXT_PRIVATE_BACKEND_URL', ORIGINAL_BACKEND);
  restore('NEXT_PRIVATE_BACKEND_ORIGIN', ORIGINAL_ORIGIN);
  restore('NEXT_PRIVATE_AGENT_URL', ORIGINAL_AGENT);
});

describe('GET /api/ready', () => {
  test('is ready when the API health endpoint answers', async () => {
    let called = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      called = String(input);
      return Response.json({ status: 'ok' });
    }) as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', backend: 'ok' });
    expect(called).toBe('http://api:4000/health');
  });

  test('stays ready and reports the backend when the API reports an error', async () => {
    globalThis.fetch = (async () =>
      new Response('down', { status: 503 })) as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      backend: 'down',
      upstream_status: 503,
    });
  });

  test('stays ready and reports the backend when the API is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', backend: 'down' });
  });

  test('is 503 before any call when required config is missing', async () => {
    delete process.env.NEXT_PRIVATE_BACKEND_URL;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ status: 'ok' });
    }) as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'not_ready',
      backend: 'missing_config',
      missing: ['NEXT_PRIVATE_BACKEND_URL'],
    });
    expect(called).toBe(false);
  });
});
