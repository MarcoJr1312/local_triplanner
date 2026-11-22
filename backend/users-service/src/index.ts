import { connect, type Db } from './db.ts';
import { isUsingDefaultInternalToken, loadConfig, loadDotEnv } from './env.ts';
import { createHandler } from './http.ts';
import { createShutdown } from './shutdown.ts';

loadDotEnv();
const config = loadConfig();

if (isUsingDefaultInternalToken(config)) {
  console.warn('[users] INTERNAL_TOKEN uses the dev default; set it outside the demo.');
}

const db: Db = await connect(config).catch((error: unknown) => {
  console.error('[users] cannot connect to Postgres:', error);
  process.exit(1);
});

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: config.port,
  fetch: createHandler({ db, internalToken: config.internalToken }),
  error(error) {
    console.error('[users] unhandled error:', error);
    return new Response(
      JSON.stringify({ error: 'UNAVAILABLE', message: 'Servicio no disponible.' }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  },
});

console.log(`[users] listening on :${config.port}`);
console.log(
  config.databaseUrl
    ? '[users] postgres=dsn'
    : `[users] postgres=${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`,
);

const shutdown = createShutdown({
  server,
  db,
  timeoutMs: config.shutdownTimeoutMs,
  exit: (code) => process.exit(code),
  log: (message) => console.log(message),
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
