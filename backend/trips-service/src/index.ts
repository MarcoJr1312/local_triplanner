import { connect, type Db } from './db.ts';
import { createBrokerPublisher } from './domain/broker.ts';
import { createLocationsClient } from './domain/locations.ts';
import { OutboxRelay } from './domain/outbox.ts';
import { TripsService } from './domain/service.ts';
import { isUsingDefaultInternalToken, loadConfig, loadDotEnv } from './env.ts';
import { createHandler } from './http.ts';
import { createShutdown } from './shutdown.ts';

loadDotEnv();
const config = loadConfig();

if (isUsingDefaultInternalToken(config)) {
  console.warn('[trips] INTERNAL_TOKEN uses the dev default; set it outside the demo.');
}

const db: Db = await connect(config).catch((error: unknown) => {
  console.error('[trips] cannot connect to Postgres:', error);
  process.exit(1);
});

const locations = createLocationsClient(config);
const publisher = createBrokerPublisher(config);
const service = new TripsService(db, locations, { brokerTopic: config.broker.topic });
const relay = new OutboxRelay(db, publisher, {
  intervalMs: config.outbox.intervalMs,
  batchSize: config.outbox.batchSize,
  maxAttempts: config.outbox.maxAttempts,
  log: (message) => console.log(message),
});
relay.start();

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: config.port,
  fetch: createHandler({ db, internalToken: config.internalToken, service }),
  error(error) {
    console.error('[trips] unhandled error:', error);
    return new Response(
      JSON.stringify({ error: 'UNAVAILABLE', message: 'Servicio no disponible.' }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  },
});

console.log(`[trips] listening on :${config.port}`);
console.log(
  config.databaseUrl
    ? '[trips] postgres=dsn'
    : `[trips] postgres=${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`,
);
console.log(
  `[trips] broker=${config.broker.url} topic=${config.broker.topic} outbox=${config.outbox.intervalMs}ms`,
);

const shutdown = createShutdown({
  server,
  db,
  timeoutMs: config.shutdownTimeoutMs,
  exit: (code) => process.exit(code),
  log: (message) => console.log(message),
  beforeClose: () => relay.stop(),
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
