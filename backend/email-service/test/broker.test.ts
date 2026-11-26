import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createBrokerClient, BrokerError } from '../src/broker.ts';

describe('broker client', () => {
  let server: Server;
  let baseUrl: string;
  let lastAck: Record<string, unknown> | undefined;
  let lastPublish: Record<string, unknown> | undefined;
  let lastFetchUrl: string | undefined;

  before(async () => {
    server = createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url?.startsWith('/v1/topics/TripInvitation/messages')) {
        lastFetchUrl = req.url;
        send(200, {
          messages: [
            {
              offset: 7,
              key: 'evt-7',
              value: { id: 'evt-7', type: 'email.invite.v1' },
            },
          ],
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/topics/TripInvitation/ack') {
        let raw = '';
        req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
        req.on('end', () => {
          lastAck = JSON.parse(raw) as Record<string, unknown>;
          send(200, { acknowledged: true });
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/topics/TripInvitation.dlq/messages') {
        let raw = '';
        req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
        req.on('end', () => {
          lastPublish = JSON.parse(raw) as Record<string, unknown>;
          send(201, { offset: 8 });
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/ready') {
        send(200, { status: 'ready' });
        return;
      }
      send(500, { error: { code: 'TEST', message: 'unexpected route' } });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const client = () =>
    createBrokerClient({
      baseUrl,
      topic: 'TripInvitation',
      consumer: 'email-service',
      dlqTopic: 'TripInvitation.dlq',
      batchSize: 10,
      waitSeconds: 0,
      requestTimeoutMs: 5_000,
    });

  test('fetches messages with consumer, limit and wait', async () => {
    const messages = await client().fetch();
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.offset, 7);
    assert.equal(messages[0]?.key, 'evt-7');
    assert.match(lastFetchUrl ?? '', /consumer=email-service/);
    assert.match(lastFetchUrl ?? '', /limit=10/);
    assert.match(lastFetchUrl ?? '', /wait=0/);
  });

  test('acks an offset', async () => {
    await client().ack(7);
    assert.deepEqual(lastAck, { consumer: 'email-service', offset: 7 });
  });

  test('publishes a DLQ message', async () => {
    const offset = await client().publish('TripInvitation.dlq', 'evt-7', { reason: 'bad event' });
    assert.equal(offset, 8);
    assert.equal(lastPublish?.key, 'evt-7');
  });

  test('reports readiness', async () => {
    assert.equal(await client().ready(), true);
  });

  test('maps an HTTP 500 to a retryable BrokerError', async () => {
    const bad = createBrokerClient({
      baseUrl,
      topic: 'MissingTopic',
      consumer: 'email-service',
      dlqTopic: 'MissingTopic.dlq',
      batchSize: 10,
      waitSeconds: 0,
      requestTimeoutMs: 5_000,
    });
    await assert.rejects(
      bad.fetch(),
      (error: unknown) => error instanceof BrokerError && error.retryable === true && error.status === 500,
    );
  });
});
