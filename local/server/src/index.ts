// Servidor GraphQL local de Triplanner (graphql-yoga) en localhost:4000.
// Mismo schema.graphql que AWS + extension local (searchLocations/locationDetails).
// Cero AWS. Cache-first: SQLite antes que HasData.

import { createYoga, createSchema, createPubSub } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { createServer } from 'node:http';
import { loadTypeDefs } from './schema.ts';
import { resolvers, type Ctx, type PubSub } from './resolvers.ts';
import { openDb } from './db.ts';
import { ensureDemoUser, resolveCurrentUserId } from './auth.ts';
import { AuthTokenError } from './auth/verify.ts';
import { HasDataClient } from './hasdata/client.ts';
import { HASDATA_API_KEY, hasHasDataKey, PORT, assertFirebaseEnv, INTERNAL_TOKEN, isUsingDefaultInternalToken, LOCAL_ONLY } from './env.ts';
import { createInternalRouter } from './internal.ts';
import { serveUploads } from './uploads.ts';
import { sweepOnce } from './reminders.ts';

if (LOCAL_ONLY) {
  console.warn('[triplanner-local] LOCAL_ONLY=1: Firebase no requerido; auth demo via x-user-id.');
} else {
  assertFirebaseEnv();
}

const db = openDb();
ensureDemoUser(db);

const pubsub = createPubSub() as unknown as PubSub;

const hasdata = hasHasDataKey() ? new HasDataClient({ apiKey: HASDATA_API_KEY }) : null;

const internalRouter = createInternalRouter({ db, hasdata, internalToken: INTERNAL_TOKEN });

const schema = createSchema({
  typeDefs: loadTypeDefs(),
  resolvers,
});

const yoga = createYoga({
  schema,
  context: async ({ request }: { request: Request }): Promise<Ctx> => {
    let currentUserId: string;
    try {
      currentUserId = await resolveCurrentUserId(db, request);
    } catch (err) {
      if (err instanceof AuthTokenError) {
        throw new GraphQLError(err.message || 'Token de sesión inválido', {
          extensions: { code: 'AUTH_TOKEN_INVALID' },
        });
      }
      throw err;
    }
    return {
      db,
      pubsub,
      hasdata,
      currentUserId,
    };
  },
  graphiql: true,
});

const server = createServer((req, res) => {
  if (serveUploads(req, res)) return;
  if (internalRouter(req, res)) return;
  yoga(req, res);
});

server.listen(PORT, () => {
  console.log(`[triplanner-local] GraphQL en http://localhost:${PORT}/graphql`);
  console.log(`[triplanner-local] HasData key: ${hasHasDataKey() ? 'presente' : 'ausente'}`);
  if (isUsingDefaultInternalToken()) {
    console.warn('[triplanner-local] INTERNAL_TOKEN no definido: usando default de desarrollo (define INTERNAL_TOKEN en local/.env)');
  }
});

// Barrido de recordatorios cada minuto (email 1h antes del inicio).
if (process.env.REMINDERS_DISABLED !== '1') {
  setInterval(() => {
    sweepOnce(db).catch((e) => {
      console.error('[reminders] barrido fallido:', e instanceof Error ? e.message : e);
    });
  }, 60_000);
}
