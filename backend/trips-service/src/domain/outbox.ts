// Transactional outbox relay. Rows are written with the domain change and
// published here with at-least-once semantics; a failed publish keeps the row
// pending for the next tick.

import type { Db } from '../db.ts';
import type { BrokerPublisher } from './broker.ts';
import * as store from './store.ts';

export interface OutboxRelayOptions {
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  log?: (message: string) => void;
}

export interface DrainResult {
  published: number;
  failed: number;
}

export class OutboxRelay {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  private current: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly publisher: BrokerPublisher,
    private readonly options: OutboxRelayOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.current;
  }

  /** Publishes one batch. Public for tests and for a manual drain. */
  async drainOnce(): Promise<DrainResult> {
    return this.db.transaction(async (tx) => {
      const rows = await store.lockPendingOutbox(
        tx,
        this.options.batchSize,
        this.options.maxAttempts,
      );

      let published = 0;
      let failed = 0;

      for (const row of rows) {
        try {
          const offset = await this.publisher.publish(row.topic, row.event_key, row.payload);
          await store.markOutboxPublished(tx, row.id, offset);
          published += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await store.markOutboxFailed(tx, row.id, message);
          failed += 1;
          this.options.log?.(`[trips] outbox publish failed for ${row.id}: ${message}`);
        }
      }

      return { published, failed };
    });
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;

    this.current = this.drainOnce()
      .then((result) => {
        if (result.published > 0 || result.failed > 0) {
          this.options.log?.(
            `[trips] outbox published=${result.published} failed=${result.failed}`,
          );
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.options.log?.(`[trips] outbox tick error: ${message}`);
      })
      .finally(() => {
        this.running = false;
        this.current = null;
      });

    await this.current;
  }
}
