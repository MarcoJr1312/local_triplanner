import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { BrokerPublishError, createBrokerPublisher, type TripInvitationEvent } from '../src/broker.ts';

const event: TripInvitationEvent = {
  id: 'inv-1',
  type: 'email.invite.v1',
  version: 1,
  occurredAt: '2026-11-20T10:00:00.000Z',
  source: 'triplanner-api',
  payload: {
    to: 'friend@example.com',
    tripName: 'Toronto 2026',
    ownerName: 'Marco',
    code: 'abcDEF123_-x',
    joinUrl: 'http://localhost:3000/join?trip=t1&code=abcDEF123_-x',
    role: 'viewer',
    language: 'es',
    demo: true,
  },
};

describe('broker publisher', () => {
  let server: Server;
  let baseUrl: string;
  let lastBody: Record<string, unknown> | undefined;
  let lastPath: string | undefined;
  let fail = false;

  before(async () => {
    server = createServer((req, res) => {
      lastPath = req.url;
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      req.on('end', () => {
        lastBody = JSON.parse(raw) as Record<string, unknown>;
        if (fail) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'PUBLISH_FAILED', message: 'nope' } }));
          return;
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ offset: 1 }));
      });
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

  test('publishes the invitation envelope with the invitation id as key', async () => {
    fail = false;
    const publisher = createBrokerPublisher({ baseUrl, topic: 'TripInvitation' });
    const offset = await publisher.publish(event);
    assert.equal(offset, 1);
    assert.equal(lastPath, '/v1/topics/TripInvitation/messages');
    assert.equal(lastBody?.key, 'inv-1');
    assert.deepEqual((lastBody?.value as TripInvitationEvent).payload.tripName, 'Toronto 2026');
  });

  test('maps a broker failure to BrokerPublishError', async () => {
    fail = true;
    const publisher = createBrokerPublisher({ baseUrl, topic: 'TripInvitation' });
    await assert.rejects(
      publisher.publish(event),
      (error: unknown) => error instanceof BrokerPublishError && error.status === 500,
    );
  });
});
