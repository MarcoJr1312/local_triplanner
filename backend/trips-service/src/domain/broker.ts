// Producer client for the Go demo broker. The relay calls it; a failure leaves
// the outbox row pending for the next tick.

import type { Config } from '../env.ts';

export class BrokerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerUnavailableError';
  }
}

export interface BrokerPublisher {
  publish(topic: string, key: string, payload: unknown): Promise<number>;
}

export function createBrokerPublisher(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): BrokerPublisher {
  const root = config.broker.url;

  return {
    async publish(topic: string, key: string, payload: unknown): Promise<number> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.broker.timeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchImpl(
            `${root}/v1/topics/${encodeURIComponent(topic)}/messages`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key, value: payload }),
              signal: controller.signal,
            },
          );
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'AbortError';
          throw new BrokerUnavailableError(
            timedOut ? 'broker publish timed out' : 'broker is unreachable',
          );
        }

        if (!response.ok) {
          throw new BrokerUnavailableError(`broker HTTP ${response.status}`);
        }

        const body = (await response.json()) as { offset?: unknown };
        if (typeof body.offset !== 'number') {
          throw new BrokerUnavailableError('broker returned an invalid publish response');
        }
        return body.offset;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
