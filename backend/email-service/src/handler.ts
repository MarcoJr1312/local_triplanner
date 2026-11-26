// Pure event handler: validate -> render -> deliver with retries. The Kafka
// adapter only translates the result into a commit or a DLQ publish, which
// keeps the delivery policy fully unit-testable.

import { eventLogFields, parseEmailEvent, type EmailEvent } from './events.ts';
import type { IdempotencyStore } from './idempotency.ts';
import type { Logger } from './logger.ts';
import { EmailProviderError, type EmailProvider } from './providers/types.ts';
import type { RenderedEmail } from './templates/types.ts';

export type HandleEmailEventResult =
  | {
      status: 'sent';
      eventId: string;
      eventType: EmailEvent['type'];
      attempts: number;
      providerMessageId: string;
    }
  | { status: 'duplicate'; eventId: string; eventType: EmailEvent['type'] }
  | {
      status: 'dead-letter';
      eventId?: string;
      eventType?: EmailEvent['type'];
      attempts: number;
      reason: string;
    };

export interface HandleEmailEventDeps {
  provider: EmailProvider;
  render: (event: EmailEvent) => RenderedEmail;
  logger: Logger;
  idempotency: IdempotencyStore;
  maxAttempts?: number;
  baseDelayMs?: number;
  jitterRatio?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_BACKOFF_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with +/- jitter; attempt starts at 1. */
export function backoffMs(
  attempt: number,
  baseDelayMs: number,
  jitterRatio: number,
  random: () => number,
): number {
  const exponential = Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  const spread = exponential * jitterRatio;
  return Math.max(0, Math.round(exponential - spread + random() * spread * 2));
}

export async function handleEmailEvent(
  raw: unknown,
  {
    provider,
    render,
    logger,
    idempotency,
    maxAttempts = 5,
    baseDelayMs = 500,
    jitterRatio = 0.2,
    sleep = defaultSleep,
    random = Math.random,
  }: HandleEmailEventDeps,
): Promise<HandleEmailEventResult> {
  const parsed = parseEmailEvent(raw);
  if (!parsed.ok) {
    logger.warn('email.event.invalid', { reason: parsed.reason });
    return { status: 'dead-letter', attempts: 0, reason: parsed.reason };
  }

  const event = parsed.event;
  const logFields = eventLogFields(event);

  if (await idempotency.has(event.id)) {
    logger.info('email.event.duplicate', logFields);
    return { status: 'duplicate', eventId: event.id, eventType: event.type };
  }

  let lastReason = 'delivery failed';
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let rendered: RenderedEmail;
    try {
      rendered = render(event);
    } catch (error) {
      const reason = `render failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      logger.error('email.render.failed', { ...logFields, reason });
      return {
        status: 'dead-letter',
        eventId: event.id,
        eventType: event.type,
        attempts: attempt,
        reason,
      };
    }

    try {
      const receipt = await provider.send({
        to: event.payload.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: event.id,
        eventId: event.id,
        eventType: event.type,
      });
      await idempotency.add(event.id);
      logger.info('email.sent', { ...logFields, attempts: attempt, provider: provider.name });
      return {
        status: 'sent',
        eventId: event.id,
        eventType: event.type,
        attempts: attempt,
        providerMessageId: receipt.providerMessageId,
      };
    } catch (error) {
      const providerError =
        error instanceof EmailProviderError
          ? error
          : new EmailProviderError(
              `unexpected provider failure: ${error instanceof Error ? error.message : 'unknown error'}`,
              false,
            );
      lastReason = providerError.message;
      const retryable = providerError.retryable;

      logger.warn('email.send.failed', {
        ...logFields,
        attempt,
        retryable,
        status: providerError.status,
        reason: lastReason,
      });

      if (!retryable) {
        return {
          status: 'dead-letter',
          eventId: event.id,
          eventType: event.type,
          attempts: attempt,
          reason: lastReason,
        };
      }

      if (attempt < attempts) {
        const delayMs = backoffMs(attempt, baseDelayMs, jitterRatio, random);
        logger.info('email.send.retry', { ...logFields, attempt, delayMs });
        await sleep(delayMs);
      }
    }
  }

  logger.error('email.send.exhausted', { ...logFields, attempts, reason: lastReason });
  return {
    status: 'dead-letter',
    eventId: event.id,
    eventType: event.type,
    attempts,
    reason: `retries exhausted: ${lastReason}`,
  };
}
