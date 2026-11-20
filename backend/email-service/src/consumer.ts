// HTTP broker consumer. One loop per email-service replica. The broker keeps
// one offset per consumer name; a message is acknowledged only after a send,
// duplicate or DLQ publish succeeds.

import type { BrokerClient } from './broker.ts';
import type { HandleEmailEventResult } from './handler.ts';
import type { Logger } from './logger.ts';

export interface ConsumerState {
  ready: boolean;
  reason?: string;
}

export interface StartBrokerConsumerOptions {
  client: BrokerClient;
  topic: string;
  dlqTopic: string;
  logger: Logger;
  handler: (raw: unknown) => Promise<HandleEmailEventResult>;
  retryDelayMs: number;
  onStateChange?: (state: ConsumerState) => void;
}

export interface EmailConsumerHandle {
  isReady(): boolean;
  stop(): Promise<void>;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    signal.addEventListener('abort', onAbort, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
  });
}

export function startBrokerConsumer({
  client,
  topic,
  dlqTopic,
  logger,
  handler,
  retryDelayMs,
  onStateChange,
}: StartBrokerConsumerOptions): EmailConsumerHandle {
  let ready = false;
  let stopping = false;
  const abortController = new AbortController();

  const setState = (next: boolean, reason?: string): void => {
    if (ready === next && (!reason || ready)) return;
    ready = next;
    onStateChange?.({ ready, ...(reason ? { reason } : {}) });
  };

  const processMessages = async (messages: Awaited<ReturnType<BrokerClient['fetch']>>): Promise<void> => {
    for (const message of messages) {
      if (stopping) return;
      const result = await handler(message.value);

      if (result.status === 'sent' || result.status === 'duplicate') {
        await client.ack(message.offset);
        logger.debug('broker.message.acked', {
          offset: message.offset,
          status: result.status,
        });
        continue;
      }

      // Terminal message: publish the original envelope + failure metadata to
      // the DLQ, then advance the offset. If the DLQ publish fails, the outer
      // catch leaves the offset unacked so it is retried.
      await client.publish(dlqTopic, message.key || `offset-${message.offset}`, {
        failedAt: new Date().toISOString(),
        originalTopic: topic,
        offset: message.offset,
        reason: result.reason,
        attempts: result.attempts,
        eventId: result.eventId,
        event: message.value,
      });
      await client.ack(message.offset);
      logger.warn('broker.message.dead_lettered', {
        offset: message.offset,
        eventId: result.eventId,
        reason: result.reason,
      });
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        const messages = await client.fetch(abortController.signal);
        setState(true);
        if (messages.length > 0) {
          logger.info('broker.messages.received', { count: messages.length });
          await processMessages(messages);
        }
      } catch (error) {
        if (stopping) break;
        setState(false, 'broker fetch failed');
        logger.warn('broker.consumer.error', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        await sleep(retryDelayMs, abortController.signal);
      }
    }
  };

  const loopPromise = loop().catch((error: unknown) => {
    if (!stopping) {
      logger.error('broker.consumer.stopped', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      setState(false, 'consumer stopped');
    }
  });

  return {
    isReady: () => ready,
    async stop() {
      if (stopping) return;
      stopping = true;
      abortController.abort();
      await loopPromise;
      setState(false, 'shutting down');
    },
  };
}
