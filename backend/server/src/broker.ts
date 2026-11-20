// Producer for the Go demo broker. Invitations are published after the
// Postgres row exists; a broker outage must not block the copyable join link.

import { BROKER_TOPIC, BROKER_URL } from './env.ts';

export interface TripInvitationEvent {
  id: string;
  type: 'email.invite.v1';
  version: 1;
  occurredAt: string;
  source: 'triplanner-api';
  payload: {
    to: string;
    tripName: string;
    ownerName: string;
    code: string;
    joinUrl: string;
    role: 'editor' | 'viewer';
    language: 'es' | 'en';
    demo: true;
  };
}

export class BrokerPublishError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BrokerPublishError';
  }
}

export interface BrokerPublisherOptions {
  baseUrl: string;
  topic: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface BrokerPublisher {
  publish(event: TripInvitationEvent): Promise<number>;
}

export function createBrokerPublisher({
  baseUrl,
  topic,
  fetchImpl = fetch,
  timeoutMs = 3_000,
}: BrokerPublisherOptions): BrokerPublisher {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    async publish(event: TripInvitationEvent): Promise<number> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${root}/v1/topics/${encodeURIComponent(topic)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: event.id, value: event }),
            signal: controller.signal,
          });
        } catch (error) {
          const aborted = error instanceof Error && error.name === 'AbortError';
          throw new BrokerPublishError(
            aborted ? 'broker publish timed out' : 'broker is unreachable',
          );
        }

        if (!response.ok) {
          throw new BrokerPublishError(`broker publish HTTP ${response.status}`, response.status);
        }
        const body = (await response.json()) as { offset?: unknown };
        if (typeof body.offset !== 'number') {
          throw new BrokerPublishError('broker returned an invalid publish response');
        }
        return body.offset;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const brokerPublisher = createBrokerPublisher({
  baseUrl: BROKER_URL,
  topic: BROKER_TOPIC,
});
