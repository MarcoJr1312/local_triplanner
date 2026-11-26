// Mongo outbox publisher for LocationChanged. At-least-once delivery is
// acceptable: the agent is idempotent by (location_id, version).

import type { MongoLocationCatalogue, OutboxRow } from './catalogue/mongo.ts';

export interface OutboxPublisherOptions {
  store: Pick<
    MongoLocationCatalogue,
    'listOutbox' | 'markOutboxPublished' | 'markOutboxFailed'
  >;
  brokerUrl: string;
  topic: string;
  intervalMs: number;
  batchSize: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export interface OutboxEvent {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  locationId: string;
  deleted: boolean;
  location: OutboxRow['payload'];
}

export function toEvent(row: OutboxRow): OutboxEvent {
  const occurredAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  return {
    eventId: row.event_id,
    type: row.type,
    version: row.version,
    occurredAt,
    locationId: row.location_id,
    deleted: row.deleted,
    location: row.deleted ? null : row.payload,
  };
}

export class OutboxPublisher {
  private readonly store: OutboxPublisherOptions['store'];
  private readonly brokerUrl: string;
  private readonly topic: string;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: OutboxPublisherOptions) {
    this.store = options.store;
    this.brokerUrl = options.brokerUrl.replace(/\/+$/, '');
    this.topic = options.topic;
    this.intervalMs = Math.max(options.intervalMs, 100);
    this.batchSize = Math.max(options.batchSize, 1);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? ((message) => console.warn(message));
  }

  start(): void {
    if (this.timer) return;
    void this.publishOnce();
    this.timer = setInterval(() => void this.publishOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async publishOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let published = 0;
    try {
      const rows = await this.store.listOutbox(this.batchSize);
      for (const row of rows) {
        try {
          const response = await this.fetchImpl(
            `${this.brokerUrl}/v1/topics/${encodeURIComponent(this.topic)}/messages`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                key: `location:${row.location_id}`,
                value: toEvent(row),
              }),
              signal: AbortSignal.timeout(5_000),
            },
          );
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`broker HTTP ${response.status}: ${text.slice(0, 200)}`);
          }
          await this.store.markOutboxPublished(row.event_id);
          published += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.store.markOutboxFailed(row.event_id, message);
          this.log(
            `[locations] outbox publish failed for ${row.location_id} v${row.version}: ${message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return published;
  }
}
