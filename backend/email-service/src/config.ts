// Environment contract for the email microservice.
//
// Every value here maps 1:1 to a Helm value documented in
// docs/migrations/0001-email-service.md. Secrets are passed as environment
// variables sourced from Kubernetes Secrets; they are never read from files
// inside the repository.

export type EmailProviderName = 'resend' | 'sink';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

export interface KafkaSaslSettings {
  mechanism: SaslMechanism;
  username: string;
  password: string;
}

export interface KafkaSettings {
  brokers: string[];
  clientId: string;
  groupId: string;
  topic: string;
  dlqTopic: string;
  ssl: boolean;
  sslCaPath?: string;
  sslRejectUnauthorized: boolean;
  sasl?: KafkaSaslSettings;
  ensureTopics: boolean;
  partitions: number;
  replicationFactor: number;
  concurrency: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
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
  kafka: KafkaSettings;
  email: EmailSettings;
  appUrl: string;
  healthPort: number;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

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

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = readOptional(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`${name} must be true or false`);
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

export function loadConfig(env: Env = process.env): AppConfig {
  const brokersRaw = readOptional(env, 'KAFKA_BROKERS');
  if (!brokersRaw) throw new ConfigError('KAFKA_BROKERS is required');
  const brokers = brokersRaw
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
  if (brokers.length === 0) throw new ConfigError('KAFKA_BROKERS must contain at least one broker');

  const saslMechanism = readOptional(env, 'KAFKA_SASL_MECHANISM')?.toLowerCase();
  const saslUsername = readOptional(env, 'KAFKA_SASL_USERNAME');
  const saslPassword = readOptional(env, 'KAFKA_SASL_PASSWORD');
  let sasl: KafkaSaslSettings | undefined;
  if (saslMechanism) {
    if (!(['plain', 'scram-sha-256', 'scram-sha-512'] as const).includes(saslMechanism as SaslMechanism)) {
      throw new ConfigError('KAFKA_SASL_MECHANISM must be one of: plain, scram-sha-256, scram-sha-512');
    }
    if (!saslUsername) throw new ConfigError('KAFKA_SASL_USERNAME is required when SASL is enabled');
    if (!saslPassword) throw new ConfigError('KAFKA_SASL_PASSWORD is required when SASL is enabled');
    sasl = {
      mechanism: saslMechanism as SaslMechanism,
      username: saslUsername,
      password: saslPassword,
    };
  } else if (saslUsername || saslPassword) {
    throw new ConfigError('KAFKA_SASL_MECHANISM is required when SASL credentials are provided');
  }

  const topic = readString(env, 'KAFKA_TOPIC', 'triplanner.email.requests.v1');
  const dlqTopic = readString(env, 'KAFKA_DLQ_TOPIC', `${topic}.dlq`);

  const provider = readEnum(env, 'EMAIL_PROVIDER', ['resend', 'sink'] as const, 'resend');
  const resendApiKey = readOptional(env, 'RESEND_API_KEY');
  if (provider === 'resend' && !resendApiKey) {
    throw new ConfigError('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }

  return {
    kafka: {
      brokers,
      clientId: readString(env, 'KAFKA_CLIENT_ID', 'triplanner-email-service'),
      groupId: readString(env, 'KAFKA_GROUP_ID', 'triplanner-email-service'),
      topic,
      dlqTopic,
      ssl: readBool(env, 'KAFKA_SSL', false),
      sslCaPath: readOptional(env, 'KAFKA_SSL_CA_PATH'),
      sslRejectUnauthorized: readBool(env, 'KAFKA_SSL_REJECT_UNAUTHORIZED', true),
      sasl,
      ensureTopics: readBool(env, 'KAFKA_ENSURE_TOPICS', false),
      partitions: readInt(env, 'KAFKA_PARTITIONS', 3, 1, 512),
      replicationFactor: readInt(env, 'KAFKA_REPLICATION_FACTOR', 1, 1, 9),
      concurrency: readInt(env, 'KAFKA_CONCURRENCY', 3, 1, 64),
      connectionTimeoutMs: readInt(env, 'KAFKA_CONNECTION_TIMEOUT_MS', 10_000, 1_000, 120_000),
      requestTimeoutMs: readInt(env, 'KAFKA_REQUEST_TIMEOUT_MS', 30_000, 1_000, 300_000),
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
  };
}
