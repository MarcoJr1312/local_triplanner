// Email microservice entrypoint.
//
//   Broker topic TripInvitation
//     -> validate/render/send with retries
//     -> Resend (or sink in local mode)
//     -> DLQ topic on a terminal failure
//
// The HTTP server exposes /health, /ready and the internal BYOK settings API.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INTERNAL_TOKEN, loadConfig, ConfigError } from './config.ts';
import { createBrokerClient } from './broker.ts';
import { startBrokerConsumer, type ConsumerState, type EmailConsumerHandle } from './consumer.ts';
import { startHttpServer, type HttpHandle } from './http.ts';
import { handleEmailEvent } from './handler.ts';
import { MemoryIdempotencyStore } from './idempotency.ts';
import { createLogger, type Logger } from './logger.ts';
import { createSettingsProvider } from './providers/index.ts';
import { EmailSettingsStore } from './settings.ts';
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
let httpHandle: HttpHandle | undefined;

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
  await httpHandle?.close().catch(() => {});
  clearTimeout(force);

  logger.info('service.shutdown.done', { exitCode });
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger = createLogger(config.logLevel);
  shutdownTimeoutMs = config.shutdownTimeoutMs;

  const settings = new EmailSettingsStore({
    filePath: config.settingsFile,
    defaults: {
      provider: config.email.provider,
      apiKey: config.email.resendApiKey ?? '',
      from: config.email.from,
      replyTo: config.email.replyTo ?? '',
    },
    logger,
  });
  const provider = createSettingsProvider(settings, logger, {
    endpoint: config.email.resendEndpoint,
    timeoutMs: config.email.timeoutMs,
  });
  const initialProviderState = provider.ready();
  if (!initialProviderState.ok) {
    throw new Error(`email provider is not ready: ${initialProviderState.reason}`);
  }

  const broker = createBrokerClient({
    baseUrl: config.broker.url,
    topic: config.broker.topic,
    consumer: config.broker.consumer,
    dlqTopic: config.broker.dlqTopic,
    batchSize: config.broker.batchSize,
    waitSeconds: config.broker.waitSeconds,
    requestTimeoutMs: config.broker.requestTimeoutMs,
  });

  let brokerState: ConsumerState = { ready: false, reason: 'consumer starting' };
  httpHandle = await startHttpServer({
    port: config.healthPort,
    logger,
    settings,
    internalToken: config.internalToken,
    getState: () => {
      const providerState = provider.ready();
      return {
        ready: providerState.ok && brokerState.ready,
        provider: provider.name,
        providerReady: providerState.ok,
        brokerReady: brokerState.ready,
        ...(!providerState.ok
          ? { reason: providerState.reason }
          : brokerState.reason
            ? { reason: brokerState.reason }
            : {}),
      };
    },
  });

  if (config.internalToken === DEFAULT_INTERNAL_TOKEN) {
    logger.warn('service.internal_token.default', {
      message: 'INTERNAL_TOKEN is the development default; set it from a Secret in Kubernetes',
    });
  }

  logger.info('service.start', {
    provider: provider.name,
    settingsFile: config.settingsFile,
    brokerUrl: config.broker.url,
    topic: config.broker.topic,
    dlqTopic: config.broker.dlqTopic,
    consumer: config.broker.consumer,
    maxAttempts: config.email.maxAttempts,
  });

  const idempotency = new MemoryIdempotencyStore();
  consumerHandle = startBrokerConsumer({
    client: broker,
    topic: config.broker.topic,
    dlqTopic: config.broker.dlqTopic,
    logger,
    retryDelayMs: config.broker.retryDelayMs,
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
      brokerState = state;
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
  void httpHandle?.close().catch(() => {});
  process.exit(1);
});
