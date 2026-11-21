// Entrypoint del servicio de catalogo. Conecta a Mongo, siembra el dataset
// comprometido y expone /health, /ready y /internal/v1/*.

import { MongoLocationCatalogue } from './catalogue/mongo.ts';
import { createHandler, type SeedState } from './http.ts';
import { seedFromFile } from './seed.ts';
import {
  INTERNAL_TOKEN,
  isUsingDefaultInternalToken,
  MONGODB_COLLECTION,
  MONGODB_URL,
  MONGO_CONNECT_ATTEMPTS,
  MONGO_CONNECT_DELAY_MS,
  PORT,
  SEED_CATALOGUE,
  SEED_DATA_PATH,
  SEED_STARTUP_TIMEOUT_MS,
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

const handler = createHandler({
  catalogue,
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

async function shutdown(signal: string): Promise<void> {
  console.log(`[locations] ${signal}; cerrando`);
  server.stop();
  await catalogue.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
