// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import {
  agentOrigin,
  backendGraphqlUrl,
  backendOrigin,
  missingRuntimeConfig,
} from './server-config';

describe('server runtime config', () => {
  test('uses the documented local defaults', () => {
    expect(backendGraphqlUrl({})).toBe('http://127.0.0.1:4000/graphql');
    expect(backendOrigin({})).toBe('http://127.0.0.1:4000');
    expect(agentOrigin({})).toBe('http://127.0.0.1:4100');
  });

  test('trims trailing slashes and derives the API origin from GraphQL', () => {
    expect(
      backendGraphqlUrl({ NEXT_PRIVATE_BACKEND_URL: 'http://api:4000/graphql/' }),
    ).toBe('http://api:4000/graphql');
    expect(
      backendOrigin({ NEXT_PRIVATE_BACKEND_URL: 'http://api:4000/graphql/' }),
    ).toBe('http://api:4000');
    expect(
      backendOrigin({
        NEXT_PRIVATE_BACKEND_URL: 'http://api:4000/graphql',
        NEXT_PRIVATE_BACKEND_ORIGIN: 'http://api:4000/',
      }),
    ).toBe('http://api:4000');
    expect(agentOrigin({ NEXT_PRIVATE_AGENT_URL: 'http://agent:4100//' })).toBe(
      'http://agent:4100',
    );
  });

  test('reports the env used by the Helm chart', () => {
    expect(missingRuntimeConfig({})).toEqual([
      'NEXT_PRIVATE_BACKEND_URL',
      'NEXT_PRIVATE_AGENT_URL',
    ]);
    expect(
      missingRuntimeConfig({
        NEXT_PRIVATE_BACKEND_URL: 'http://api:4000/graphql',
        NEXT_PRIVATE_AGENT_URL: 'http://agent:4100',
      }),
    ).toEqual([]);
  });
});
