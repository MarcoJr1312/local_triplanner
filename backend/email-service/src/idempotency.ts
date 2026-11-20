// Best-effort in-process dedupe. It catches Kafka redeliveries within a pod,
// but the real duplicate guard is the Resend `Idempotency-Key` (24h window),
// which also covers restarts and multiple replicas.
//
// A shared Redis/Postgres store is intentionally out of scope for the first
// slice; see docs/migrations/0001-email-service.md.

export interface IdempotencyStore {
  has(key: string): boolean | Promise<boolean>;
  add(key: string): void | Promise<void>;
}

export interface MemoryIdempotencyStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({ ttlMs = 24 * 60 * 60_000, maxEntries = 10_000, now = Date.now }: MemoryIdempotencyStoreOptions = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  has(key: string): boolean {
    this.prune();
    return this.entries.has(key);
  }

  add(key: string): void {
    this.prune();
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, this.now() + this.ttlMs);
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}
