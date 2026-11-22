// Service configuration. Pure on purpose: index.ts decides when to load .env,
// tests pass their own environment object.

import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_INTERNAL_TOKEN = 'dev-internal-token';

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface Config {
  port: number;
  internalToken: string;
  /** Optional full DSN for local tools/tests. Null means discrete fields. */
  databaseUrl: string | null;
  postgres: PostgresConfig;
  seedDemo: boolean;
  shutdownTimeoutMs: number;
  dbConnectAttempts: number;
  dbConnectDelayMs: number;
}

function textEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  return value === '' ? fallback : value;
}

function numberEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: "${raw}" (expected an integer between ${min} and ${max})`);
  }
  return value;
}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`Invalid ${name}: "${raw}" (expected a boolean)`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = (env.USERS_DATABASE_URL ?? '').trim();

  return {
    port: numberEnv(env, 'PORT', 4500, 1, 65_535),
    internalToken: textEnv(env, 'INTERNAL_TOKEN', DEFAULT_INTERNAL_TOKEN),
    databaseUrl: databaseUrl === '' ? null : databaseUrl,
    postgres: {
      host: textEnv(env, 'POSTGRES_HOST', '127.0.0.1'),
      port: numberEnv(env, 'POSTGRES_PORT', 5432, 1, 65_535),
      database: textEnv(env, 'POSTGRES_DB', 'users'),
      user: textEnv(env, 'POSTGRES_USER', 'users'),
      // Preserve the password exactly; trimming would change a valid secret.
      password: env.POSTGRES_PASSWORD ?? '',
    },
    // The two protected demo accounts are required for the recruiter demo and
    // are seeded idempotently; only tests turn this off.
    seedDemo: booleanEnv(env, 'SEED_DEMO', true),
    shutdownTimeoutMs: numberEnv(env, 'SHUTDOWN_TIMEOUT_MS', 10_000, 1, 120_000),
    dbConnectAttempts: numberEnv(env, 'DB_CONNECT_ATTEMPTS', 30, 1, 600),
    dbConnectDelayMs: numberEnv(env, 'DB_CONNECT_DELAY_MS', 500, 0, 60_000),
  };
}

export function isUsingDefaultInternalToken(config: Config): boolean {
  return config.internalToken === DEFAULT_INTERNAL_TOKEN;
}

export function verifyInternalToken(expected: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Optional local .env; the deployed service uses real environment variables. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // No .env is normal in containers.
  }
}
