// HTTP client for the Go demo broker. The broker is topic/offset/ack based;
// it is not the Kafka wire protocol (the API is expected to move to gRPC later).

export interface BrokerMessage {
  offset: number;
  key: string;
  value: unknown;
}

export class BrokerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

export interface BrokerClientOptions {
  baseUrl: string;
  topic: string;
  consumer: string;
  dlqTopic: string;
  batchSize: number;
  waitSeconds: number;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface BrokerClient {
  fetch(signal?: AbortSignal): Promise<BrokerMessage[]>;
  ack(offset: number): Promise<void>;
  publish(topic: string, key: string, value: unknown): Promise<number>;
  ready(): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMessages(body: unknown): BrokerMessage[] {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    throw new BrokerError('broker returned an invalid messages payload', false);
  }
  return body.messages.map((raw): BrokerMessage => {
    if (!isRecord(raw) || typeof raw.offset !== 'number' || typeof raw.key !== 'string' || !('value' in raw)) {
      throw new BrokerError('broker returned an invalid message', false);
    }
    return { offset: raw.offset, key: raw.key, value: raw.value };
  });
}

export function createBrokerClient(options: BrokerClientOptions): BrokerClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async (path: string, init: RequestInit | undefined, timeoutMs: number, signal?: AbortSignal): Promise<Response> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new BrokerError(aborted ? 'broker request timed out' : 'broker is unreachable', true);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };

  const topicPath = (topic: string) => `/v1/topics/${encodeURIComponent(topic)}`;

  return {
    async fetch(signal?: AbortSignal): Promise<BrokerMessage[]> {
      const query = new URLSearchParams({
        consumer: options.consumer,
        limit: String(options.batchSize),
        wait: String(options.waitSeconds),
      });
      const response = await request(
        `${topicPath(options.topic)}/messages?${query.toString()}`,
        undefined,
        options.requestTimeoutMs,
        signal,
      );
      if (!response.ok) {
        throw new BrokerError(`broker fetch HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status);
      }
      return parseMessages(await response.json());
    },

    async ack(offset: number): Promise<void> {
      const response = await request(
        `${topicPath(options.topic)}/ack`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consumer: options.consumer, offset }),
        },
        options.requestTimeoutMs,
      );
      if (!response.ok) {
        throw new BrokerError(`broker ack HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status);
      }
    },

    async publish(topic: string, key: string, value: unknown): Promise<number> {
      const response = await request(
        `${topicPath(topic)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        },
        options.requestTimeoutMs,
      );
      if (!response.ok) {
        throw new BrokerError(`broker publish HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status);
      }
      const body = (await response.json()) as unknown;
      if (!isRecord(body) || typeof body.offset !== 'number') {
        throw new BrokerError('broker returned an invalid publish response', false);
      }
      return body.offset;
    },

    async ready(): Promise<boolean> {
      try {
        const response = await request('/ready', undefined, 3_000);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
