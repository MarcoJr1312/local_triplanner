// Environment contract for the email microservice.

import path from 'node:path';

export type EmailProviderName = 'resend' | 'sink';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const DEFAULT_INTERNAL_TOKEN = 'dev-internal-token';

export interface BrokerSettings {
  url: string;
  topic: string;
  consumer: string;
  dlqTopic: string;
  batchSize: number;
  waitSeconds: number;
  requestTimeoutMs: number;
  retryDelayMs: number;
}

export interface EmailSettings {
  provider: EmailProviderName;
  from: string;
  replyTo?: string;
  resendApiKey?: string;
  resendEndpoint: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

export interface AppConfig {
  broker: BrokerSettings;
  email: EmailSettings;
  appUrl: string;
  healthPort: number;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
  internalToken: string;
  settingsFile: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;

function readOptional(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function readString(env: Env, name: string, fallback?: string): string {
  const value = readOptional(env, name) ?? fallback;
  if (value === undefined) throw new ConfigError(`${name} is required`);
  return value;
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = readOptional(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function readEnum<T extends string>(env: Env, name: string, values: readonly T[], fallback: T): T {
  const raw = readOptional(env, name)?.toLowerCase() ?? fallback;
  if (!(values as readonly string[]).includes(raw)) {
    throw new ConfigError(`${name} must be one of: ${values.join(', ')}`);
  }
  return raw as T;
}

function readUrl(env: Env, name: string, fallback: string): string {
  const value = readString(env, name, fallback);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${name} must use http or https`);
  }
  return value.replace(/\/+$/, '');
}

function readName(env: Env, name: string, fallback: string): string {
  const value = readString(env, name, fallback);
  if (!NAME_RE.test(value)) {
    throw new ConfigError(`${name} must match [A-Za-z0-9._-] and be at most 128 characters`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const topic = readName(env, 'BROKER_TOPIC', 'TripInvitation');
  const consumer = readName(env, 'BROKER_CONSUMER', 'email-service');

  const provider = readEnum(env, 'EMAIL_PROVIDER', ['resend', 'sink'] as const, 'resend');
  const resendApiKey = readOptional(env, 'RESEND_API_KEY');
  if (provider === 'resend' && !resendApiKey) {
    throw new ConfigError('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }

  return {
    broker: {
      url: readUrl(env, 'BROKER_URL', 'http://127.0.0.1:8080'),
      topic,
      consumer,
      dlqTopic: readName(env, 'BROKER_DLQ_TOPIC', `${topic}.dlq`),
      batchSize: readInt(env, 'BROKER_BATCH_SIZE', 10, 1, 100),
      waitSeconds: readInt(env, 'BROKER_WAIT_SECONDS', 20, 0, 30),
      requestTimeoutMs: readInt(env, 'BROKER_REQUEST_TIMEOUT_MS', 35_000, 1_000, 120_000),
      retryDelayMs: readInt(env, 'BROKER_RETRY_DELAY_MS', 1_000, 100, 60_000),
    },
    email: {
      provider,
      from: readString(env, 'RESEND_FROM', 'Triplanner <onboarding@resend.dev>'),
      replyTo: readOptional(env, 'RESEND_REPLY_TO'),
      resendApiKey,
      resendEndpoint: readUrl(env, 'RESEND_ENDPOINT', 'https://api.resend.com/emails'),
      timeoutMs: readInt(env, 'RESEND_TIMEOUT_MS', 10_000, 1_000, 120_000),
      maxAttempts: readInt(env, 'EMAIL_MAX_ATTEMPTS', 5, 1, 20),
      retryBaseMs: readInt(env, 'EMAIL_RETRY_BASE_MS', 500, 10, 60_000),
    },
    appUrl: readUrl(env, 'APP_URL', 'http://localhost:3000'),
    healthPort: readInt(env, 'HEALTH_PORT', 4200, 1, 65_535),
    logLevel: readEnum(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    shutdownTimeoutMs: readInt(env, 'SHUTDOWN_TIMEOUT_MS', 15_000, 1_000, 120_000),
    internalToken: readString(env, 'INTERNAL_TOKEN', DEFAULT_INTERNAL_TOKEN),
    settingsFile: readString(env, 'EMAIL_SETTINGS_FILE', path.resolve(process.cwd(), '.data', 'email.json')),
  };
}
