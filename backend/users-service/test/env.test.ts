import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_INTERNAL_TOKEN,
  isUsingDefaultInternalToken,
  loadConfig,
  verifyInternalToken,
} from '../src/env.ts';

describe('loadConfig', () => {
  test('applies demo-safe defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4500);
    expect(config.internalToken).toBe(DEFAULT_INTERNAL_TOKEN);
    expect(config.databaseUrl).toBeNull();
    expect(config.postgres.host).toBe('127.0.0.1');
    expect(config.postgres.port).toBe(5432);
    expect(config.postgres.database).toBe('users');
    expect(config.postgres.user).toBe('users');
    // Demo accounts are seeded by default; tests opt out explicitly.
    expect(config.seedDemo).toBe(true);
    expect(config.shutdownTimeoutMs).toBe(10_000);
    expect(config.dbConnectAttempts).toBe(30);
    expect(config.dbConnectDelayMs).toBe(500);
  });

  test('reads overrides and preserves the password verbatim', () => {
    const config = loadConfig({
      PORT: '4600',
      INTERNAL_TOKEN: 'secret',
      USERS_DATABASE_URL: 'postgres://u:p@db:5432/users',
      SEED_DEMO: 'no',
      POSTGRES_HOST: 'users-postgres',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'users_demo',
      POSTGRES_USER: 'demo',
      POSTGRES_PASSWORD: '  spaced  ',
      SHUTDOWN_TIMEOUT_MS: '3000',
      DB_CONNECT_ATTEMPTS: '5',
      DB_CONNECT_DELAY_MS: '0',
    });

    expect(config.port).toBe(4600);
    expect(config.internalToken).toBe('secret');
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/users');
    expect(config.seedDemo).toBe(false);
    expect(config.postgres).toEqual({
      host: 'users-postgres',
      port: 5433,
      database: 'users_demo',
      user: 'demo',
      password: '  spaced  ',
    });
    expect(config.shutdownTimeoutMs).toBe(3000);
    expect(config.dbConnectAttempts).toBe(5);
    expect(config.dbConnectDelayMs).toBe(0);
  });

  test('treats an empty DSN as null', () => {
    const config = loadConfig({ USERS_DATABASE_URL: '   ' });
    expect(config.databaseUrl).toBeNull();
  });

  test('ignores an empty password instead of failing', () => {
    const config = loadConfig({ POSTGRES_PASSWORD: '' });
    expect(config.postgres.password).toBe('');
  });

  test('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ POSTGRES_PORT: '0' })).toThrow(/Invalid POSTGRES_PORT/);
  });

  test('rejects an invalid boolean', () => {
    expect(() => loadConfig({ SEED_DEMO: 'maybe' })).toThrow(/Invalid SEED_DEMO/);
  });

  test('rejects a negative delay', () => {
    expect(() => loadConfig({ DB_CONNECT_DELAY_MS: '-1' })).toThrow(/Invalid DB_CONNECT_DELAY_MS/);
  });
});

describe('internal token', () => {
  test('accepts only the exact token', () => {
    expect(verifyInternalToken('secret', 'secret')).toBe(true);
    expect(verifyInternalToken('secret', 'secre')).toBe(false);
    expect(verifyInternalToken('secret', 'secret ')).toBe(false);
    expect(verifyInternalToken('secret', '')).toBe(false);
    expect(verifyInternalToken('secret', null)).toBe(false);
    expect(verifyInternalToken('secret', undefined)).toBe(false);
  });

  test('flags the dev default', () => {
    expect(isUsingDefaultInternalToken(loadConfig({}))).toBe(true);
    expect(isUsingDefaultInternalToken(loadConfig({ INTERNAL_TOKEN: 'real' }))).toBe(false);
  });
});
