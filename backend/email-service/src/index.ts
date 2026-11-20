// Email microservice entrypoint.
//
//   Kafka topic  triplanner.email.requests.v1
//     -> validate/render/send with retries
//     -> Resend (or sink in local mode)
//     -> dead-letter topic after a non-retryable/exhausted failure
//
// The HTTP server exists only for /health and /ready probes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from './config.ts';
import { startEmailConsumer, type ConsumerState, type EmailConsumerHandle } from './consumer.ts';
import { startHealthServer, type HealthHandle } from './health.ts';
import { handleEmailEvent } from './handler.ts';
import { MemoryIdempotencyStore } from './idempotency.ts';
import { createLogger, type Logger } from './logger.ts';
import { createEmailProvider } from './providers/index.ts';
import { renderEmail } from './templates/index.ts';

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
try {
  process.loadEnvFile(ENV_PATH);
} catch {
  // .env is optional; Kubernetes injects the environment directly.
}

let logger: Logger = createLogger('info');
let shuttingDown = false;
let shutdownTimeoutMs = 15_000;
let consumerHandle: EmailConsumerHandle | undefined;
let healthHandle: HealthHandle | undefined;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('service.shutdown.start', { signal });

  const force = setTimeout(() => {
    logger.error('service.shutdown.timeout', { timeoutMs: shutdownTimeoutMs });
    process.exit(1);
  }, shutdownTimeoutMs);
  force.unref();

  await consumerHandle?.stop();
  await healthHandle?.close().catch(() => {});
  clearTimeout(force);

  logger.info('service.shutdown.done', { exitCode });
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger = createLogger(config.logLevel);
  shutdownTimeoutMs = config.shutdownTimeoutMs;

  const provider = createEmailProvider(config.email, logger);
  const providerState = provider.ready();
  if (!providerState.ok) {
    throw new Error(`email provider is not ready: ${providerState.reason}`);
  }

  let kafkaState: ConsumerState = { ready: false, reason: 'consumer starting' };
  healthHandle = await startHealthServer({
    port: config.healthPort,
    logger,
    getState: () => ({
      ready: providerState.ok && kafkaState.ready,
      provider: provider.name,
      providerReady: providerState.ok,
      kafkaReady: kafkaState.ready,
      ...(kafkaState.reason ? { reason: kafkaState.reason } : {}),
    }),
  });

  logger.info('service.start', {
    provider: provider.name,
    topic: config.kafka.topic,
    dlqTopic: config.kafka.dlqTopic,
    groupId: config.kafka.groupId,
    brokerCount: config.kafka.brokers.length,
    maxAttempts: config.email.maxAttempts,
    compression: 'gzip-only',
  });

  const idempotency = new MemoryIdempotencyStore();
  consumerHandle = await startEmailConsumer({
    kafka: config.kafka,
    logger,
    handler: (raw) =>
      handleEmailEvent(raw, {
        provider,
        logger,
        idempotency,
        maxAttempts: config.email.maxAttempts,
        baseDelayMs: config.email.retryBaseMs,
        render: (event) => renderEmail(event, { appUrl: config.appUrl }),
      }),
    onStateChange: (state) => {
      kafkaState = state;
    },
    onFatal: (error) => {
      logger.error('service.fatal', { reason: error.message });
      void shutdown('fatal', 1);
    },
  });

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

process.on('uncaughtException', (error) => {
  logger.error('service.uncaught_exception', { reason: error.message });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('service.unhandled_rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

main().catch((error: unknown) => {
  if (error instanceof ConfigError) logger.error('service.config_error', { reason: error.message });
  else logger.error('service.start_failed', { reason: error instanceof Error ? error.message : String(error) });
  void healthHandle?.close().catch(() => {});
  process.exit(1);
});
