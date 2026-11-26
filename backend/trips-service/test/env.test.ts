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
    expect(config.port).toBe(4400);
    expect(config.internalToken).toBe(DEFAULT_INTERNAL_TOKEN);
    expect(config.databaseUrl).toBeNull();
    expect(config.postgres.host).toBe('127.0.0.1');
    expect(config.postgres.port).toBe(5432);
    expect(config.postgres.database).toBe('trips');
    expect(config.postgres.user).toBe('trips');
    expect(config.seedDemo).toBe(false);
    expect(config.locations.url).toBe('http://127.0.0.1:4300');
    expect(config.broker.topic).toBe('TripInvitation');
    expect(config.outbox.batchSize).toBe(10);
  });

  test('reads overrides and strips a trailing slash from base URLs', () => {
    const config = loadConfig({
      PORT: '4500',
      INTERNAL_TOKEN: 'secret',
      TRIPS_DATABASE_URL: 'postgres://u:p@db:5432/trips',
      SEED_DEMO: 'yes',
      LOCATIONS_URL: 'http://locations:4300/',
      BROKER_URL: 'http://broker:8080//',
      OUTBOX_MAX_ATTEMPTS: '3',
      POSTGRES_PASSWORD: '  spaced  ',
    });

    expect(config.port).toBe(4500);
    expect(config.internalToken).toBe('secret');
    expect(config.databaseUrl).toBe('postgres://u:p@db:5432/trips');
    expect(config.seedDemo).toBe(true);
    expect(config.locations.url).toBe('http://locations:4300');
    expect(config.broker.url).toBe('http://broker:8080');
    expect(config.outbox.maxAttempts).toBe(3);
    expect(config.postgres.password).toBe('  spaced  ');
  });

  test('treats an empty DSN as null', () => {
    const config = loadConfig({ TRIPS_DATABASE_URL: '   ' });
    expect(config.databaseUrl).toBeNull();
  });

  test('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });

  test('rejects an invalid boolean', () => {
    expect(() => loadConfig({ SEED_DEMO: 'maybe' })).toThrow(/Invalid SEED_DEMO/);
  });
});

describe('internal token', () => {
  test('accepts only the exact token', () => {
    expect(verifyInternalToken('secret', 'secret')).toBe(true);
    expect(verifyInternalToken('secret', 'secre')).toBe(false);
    expect(verifyInternalToken('secret', 'secret ')).toBe(false);
    expect(verifyInternalToken('secret', null)).toBe(false);
    expect(verifyInternalToken('secret', undefined)).toBe(false);
  });

  test('flags the dev default', () => {
    expect(isUsingDefaultInternalToken(loadConfig({}))).toBe(true);
    expect(isUsingDefaultInternalToken(loadConfig({ INTERNAL_TOKEN: 'real' }))).toBe(false);
  });
});
