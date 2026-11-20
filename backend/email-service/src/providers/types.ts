export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable per business event; Resend deduplicates within 24h. */
  idempotencyKey: string;
  eventId: string;
  eventType: string;
}

export interface SendReceipt {
  providerMessageId: string;
}

export type ProviderReadiness = { ok: true } | { ok: false; reason: string };

export interface EmailProvider {
  readonly name: string;
  readonly ready: () => ProviderReadiness;
  send(email: OutgoingEmail): Promise<SendReceipt>;
}

/**
 * `retryable` is decided by the provider adapter, not the consumer: only
 * transport failures, 429 and 5xx are worth retrying. A 4xx means the payload,
 * key or credentials are wrong and will fail again.
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}
