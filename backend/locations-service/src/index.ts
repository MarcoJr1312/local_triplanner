// Entrypoint del servicio de catalogo. Conecta a Mongo, siembra el dataset
// comprometido y expone /health, /ready y /internal/v1/*.

import { MongoLocationCatalogue } from './catalogue/mongo.ts';
import { CatalogueService } from './catalogue/service.ts';
import { HasDataClient } from './hasdata.ts';
import { LocationsSettingsStore } from './settings.ts';
import { createHandler, type SeedState } from './http.ts';
import { startLocationsGrpcServer } from './grpc/server.ts';
import { OutboxPublisher } from './outbox.ts';
import { seedFromFile } from './seed.ts';
import {
  HASDATA_API_BASE,
  HASDATA_API_KEY,
  HASDATA_CACHE_TTL_MS,
  HASDATA_GL,
  HASDATA_HL,
  HASDATA_TIMEOUT_MS,
  INTERNAL_TOKEN,
  isUsingDefaultInternalToken,
  MONGODB_COLLECTION,
  MONGODB_URL,
  MONGO_CONNECT_ATTEMPTS,
  MONGO_CONNECT_DELAY_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_INTERVAL_MS,
  BROKER_URL,
  BROKER_TOPIC,
  GRPC_PORT,
  PORT,
  SEED_CATALOGUE,
  SEED_DATA_PATH,
  SEED_STARTUP_TIMEOUT_MS,
  SETTINGS_FILE,
  verifyInternalToken,
} from './env.ts';

async function connectWithRetry(): Promise<MongoLocationCatalogue> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MONGO_CONNECT_ATTEMPTS; attempt++) {
    try {
      return await MongoLocationCatalogue.connect({
        url: MONGODB_URL,
        collectionName: MONGODB_COLLECTION,
      });
    } catch (error) {
      lastError = error;
      if (attempt < MONGO_CONNECT_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, MONGO_CONNECT_DELAY_MS));
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`No se pudo conectar a MongoDB: ${message}`);
}

async function runSeed(catalogue: MongoLocationCatalogue): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`El seed excedio ${SEED_STARTUP_TIMEOUT_MS} ms`)),
      SEED_STARTUP_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([seedFromFile(catalogue, SEED_DATA_PATH), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const catalogue = await connectWithRetry();

if (isUsingDefaultInternalToken()) {
  console.warn('[locations] INTERNAL_TOKEN no configurado; usando el valor de desarrollo.');
}

const settings = new LocationsSettingsStore({
  filePath: SETTINGS_FILE,
  defaults: {
    provider: HASDATA_API_KEY ? 'hasdata' : 'preloaded',
    apiKey: HASDATA_API_KEY,
  },
});

const hasdata = new HasDataClient({
  apiKey: () => settings.get().apiKey,
  baseUrl: HASDATA_API_BASE,
  timeoutMs: HASDATA_TIMEOUT_MS,
  hl: HASDATA_HL,
  gl: HASDATA_GL,
  ttlMs: HASDATA_CACHE_TTL_MS,
});

const cache = new CatalogueService({
  store: catalogue,
  settings,
  hasdata,
  cacheTtlMs: HASDATA_CACHE_TTL_MS,
});

const seedState: SeedState = {
  enabled: SEED_CATALOGUE,
  seeded: !SEED_CATALOGUE,
  count: 0,
  lastError: null,
};

if (SEED_CATALOGUE) {
  try {
    seedState.count = await runSeed(catalogue);
    seedState.seeded = true;
    console.log(`[locations] seed OK: ${seedState.count} lugares desde ${SEED_DATA_PATH}`);
  } catch (error) {
    seedState.lastError = error instanceof Error ? error.message : 'seed failed';
    console.error(`[locations] seed fallo: ${seedState.lastError}`);
    await catalogue.close();
    process.exit(1);
  }
} else {
  console.log('[locations] SEED_CATALOGUE=false; no se siembra el catalogo.');
}

const outbox = new OutboxPublisher({
  store: catalogue,
  brokerUrl: BROKER_URL,
  topic: BROKER_TOPIC,
  intervalMs: OUTBOX_INTERVAL_MS,
  batchSize: OUTBOX_BATCH_SIZE,
});
outbox.start();
console.log(`[locations] outbox -> ${BROKER_URL} topic=${BROKER_TOPIC}`);

const handler = createHandler({
  catalogue: cache,
  settings,
  verifyToken: verifyInternalToken,
  seed: () => runSeed(catalogue),
  seedState,
});

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  fetch: handler,
  error(error) {
    console.error('[locations] unhandled error:', error);
    return new Response(JSON.stringify({ error: 'UNAVAILABLE' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  },
});

console.log(`[locations] listening on :${PORT} (collection=${MONGODB_COLLECTION})`);

const grpcServer = await startLocationsGrpcServer({
  catalogue: cache,
  port: GRPC_PORT,
  internalToken: INTERNAL_TOKEN,
}).catch((error: unknown) => {
  console.error('[locations] gRPC server failed:', error);
  process.exit(1);
});
console.log(`[locations] gRPC listening on :${GRPC_PORT}`);
console.log(
  `[locations] provider=${settings.public().provider} hasKey=${settings.public().hasKey} cacheTtlHours=${HASDATA_CACHE_TTL_MS / 3_600_000}`,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[locations] ${signal}; cerrando`);
  outbox.stop();
  server.stop();
  await grpcServer.stop();
  await cache.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
