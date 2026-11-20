// Kafka adapter. Delivery semantics are at-least-once: the offset is committed
// after `eachMessage` resolves, so a crash between the provider call and the
// commit can redeliver. Resend's Idempotency-Key (the event id) absorbs that.

import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import { CompressionTypes, Kafka, logLevel, type Consumer, type KafkaConfig, type Producer } from 'kafkajs';
import type { KafkaSaslSettings, KafkaSettings } from './config.ts';
import type { HandleEmailEventResult } from './handler.ts';
import type { Logger } from './logger.ts';

export interface ConsumerState {
  ready: boolean;
  reason?: string;
}

export interface StartEmailConsumerOptions {
  kafka: KafkaSettings;
  logger: Logger;
  handler: (raw: unknown) => Promise<HandleEmailEventResult>;
  onStateChange?: (state: ConsumerState) => void;
  onFatal?: (error: Error) => void;
}

export interface EmailConsumerHandle {
  isReady(): boolean;
  stop(): Promise<void>;
}

interface DlqInput {
  originalTopic: string;
  partition: number;
  offset: string;
  reason: string;
  attempts: number;
  eventId?: string;
  raw: unknown;
}

function buildSsl(config: KafkaSettings): boolean | ConnectionOptions | undefined {
  if (!config.ssl) return undefined;
  const options: ConnectionOptions = { rejectUnauthorized: config.sslRejectUnauthorized };
  if (config.sslCaPath) options.ca = [readFileSync(config.sslCaPath, 'utf8')];
  return options;
}

function buildSasl(config: KafkaSaslSettings | undefined): KafkaConfig['sasl'] {
  if (!config) return undefined;
  switch (config.mechanism) {
    case 'plain':
      return { mechanism: 'plain', username: config.username, password: config.password };
    case 'scram-sha-256':
      return { mechanism: 'scram-sha-256', username: config.username, password: config.password };
    case 'scram-sha-512':
      return { mechanism: 'scram-sha-512', username: config.username, password: config.password };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startEmailConsumer({
  kafka,
  logger,
  handler,
  onStateChange,
  onFatal,
}: StartEmailConsumerOptions): Promise<EmailConsumerHandle> {
  const client = new Kafka({
    clientId: kafka.clientId,
    brokers: kafka.brokers,
    ssl: buildSsl(kafka),
    sasl: buildSasl(kafka.sasl),
    connectionTimeout: kafka.connectionTimeoutMs,
    requestTimeout: kafka.requestTimeoutMs,
    logLevel: logLevel.NOTHING,
    retry: { retries: 8 },
  });

  const producer: Producer = client.producer({ allowAutoTopicCreation: false });
  const consumer: Consumer = client.consumer({
    groupId: kafka.groupId,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    retry: { retries: 8 },
  });

  let ready = false;
  let stopping = false;

  const setState = (next: boolean, reason?: string): void => {
    ready = next;
    onStateChange?.({ ready, ...(reason ? { reason } : {}) });
  };

  const publishDlq = async (input: DlqInput): Promise<void> => {
    const value = JSON.stringify({
      failedAt: new Date().toISOString(),
      originalTopic: input.originalTopic,
      partition: input.partition,
      offset: input.offset,
      reason: input.reason,
      attempts: input.attempts,
      event: input.raw,
    });
    await producer.send({
      topic: kafka.dlqTopic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          value,
          headers: {
            'x-original-topic': input.originalTopic,
            'x-original-partition': String(input.partition),
            'x-original-offset': input.offset,
            'x-error': input.reason.slice(0, 500),
            'x-attempts': String(input.attempts),
            ...(input.eventId ? { 'x-event-id': input.eventId } : {}),
          },
        },
      ],
    });
    logger.warn('email.dead_letter', {
      eventId: input.eventId,
      originalTopic: input.originalTopic,
      partition: input.partition,
      offset: input.offset,
      reason: input.reason,
    });
  };

  const handleMessage = async ({
    topic,
    partition,
    message,
  }: {
    topic: string;
    partition: number;
    message: { value: Buffer | null; offset: string };
  }): Promise<void> => {
    const offset = message.offset;
    if (!message.value) {
      await publishDlq({
        originalTopic: topic,
        partition,
        offset,
        reason: 'empty message value',
        attempts: 0,
        raw: null,
      });
      return;
    }

    const rawText = message.value.toString('utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      await publishDlq({
        originalTopic: topic,
        partition,
        offset,
        reason: 'invalid JSON',
        attempts: 0,
        raw: rawText,
      });
      return;
    }

    const result = await handler(raw);
    if (result.status === 'dead-letter') {
      await publishDlq({
        originalTopic: topic,
        partition,
        offset,
        reason: result.reason,
        attempts: result.attempts,
        eventId: result.eventId,
        raw,
      });
    }
  };

  if (kafka.ensureTopics) {
    const admin = client.admin();
    await admin.connect();
    try {
      const created = await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic: kafka.topic,
            numPartitions: kafka.partitions,
            replicationFactor: kafka.replicationFactor,
            configEntries: [{ name: 'compression.type', value: 'gzip' }],
          },
          {
            topic: kafka.dlqTopic,
            numPartitions: kafka.partitions,
            replicationFactor: kafka.replicationFactor,
            configEntries: [{ name: 'compression.type', value: 'gzip' }],
          },
        ],
      });
      logger.info('kafka.topics.ensured', { created, topic: kafka.topic, dlqTopic: kafka.dlqTopic });
    } catch (error) {
      // Topic-already-exists is the normal path after the first boot.
      logger.debug('kafka.topics.ensure_failed', { reason: errorMessage(error) });
    } finally {
      await admin.disconnect().catch(() => {});
    }
  }

  consumer.on(consumer.events.GROUP_JOIN, () => {
    setState(true);
    logger.info('kafka.consumer.ready', { topic: kafka.topic, groupId: kafka.groupId });
  });
  consumer.on(consumer.events.DISCONNECT, () => {
    setState(false, 'consumer disconnected');
  });
  consumer.on(consumer.events.CRASH, (event) => {
    setState(false, 'consumer crashed');
    const reason = errorMessage(event.payload.error);
    logger.error('kafka.consumer.crash', { reason, restart: event.payload.restart });
    // KafkaJS does not restart after a non-retriable error. Staying alive but
    // unready would silently stop email; fail fast so Kubernetes restarts the
    // pod and the crash is visible. The usual cause is an undecodable batch:
    // KafkaJS 2.2.x only decodes gzip, so the topic must enforce gzip.
    if (!event.payload.restart && !stopping) {
      onFatal?.(new Error(`kafka consumer crash: ${reason}`));
    }
  });

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: kafka.topic, fromBeginning: false });

  // run() resolves only when the consumer stops; do not await it here.
  void consumer
    .run({
      partitionsConsumedConcurrently: kafka.concurrency,
      eachMessage: async ({ topic, partition, message }) => {
        await handleMessage({ topic, partition, message });
      },
    })
    .catch((error: unknown) => {
      setState(false, 'consumer run failed');
      logger.error('kafka.consumer.run_failed', { reason: errorMessage(error) });
      if (!stopping) onFatal?.(error instanceof Error ? error : new Error(errorMessage(error)));
    });

  return {
    isReady: () => ready,
    async stop() {
      stopping = true;
      setState(false, 'shutting down');
      await consumer.disconnect().catch((error: unknown) => {
        logger.warn('kafka.consumer.disconnect_failed', { reason: errorMessage(error) });
      });
      await producer.disconnect().catch((error: unknown) => {
        logger.warn('kafka.producer.disconnect_failed', { reason: errorMessage(error) });
      });
    },
  };
}
