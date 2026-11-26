// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { GET } from './route';

describe('GET /api/health', () => {
  test('reports the process as healthy without calling a backend', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
