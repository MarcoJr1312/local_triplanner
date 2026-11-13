// GraphQL server (graphql-yoga) on Postgres + DynamoDB + Storage.

import { createYoga, createSchema, createPubSub } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { createServer } from 'node:http';
import { loadTypeDefs } from './schema.ts';
import { resolvers, type Ctx, type PubSub } from './resolvers.ts';
import { PgDb } from './pg/db.ts';
import { migrate } from './db/migrate.ts';
import { resolveDatabaseUrl } from './pg/config.ts';
import { ensureDemoUser, resolveCurrentUserId } from './pg/auth.ts';
import { createCatalogue } from './catalogue/index.ts';
import { ensureTable } from './catalogue/bootstrap.ts';
import { defaultStorage } from './storage.ts';
import { AuthTokenError } from './auth/verify.ts';
import { HasDataClient } from './hasdata/client.ts';
import {
  HASDATA_API_KEY,
  hasHasDataKey,
  PORT,
  assertFirebaseEnv,
  INTERNAL_TOKEN,
  isUsingDefaultInternalToken,
  LOCAL_ONLY,
  BOOTSTRAP_LOCAL,
} from './env.ts';
import { createInternalRouter } from './internal.ts';
import { serveUploads } from './uploads.ts';
import { sweepOnce } from './pg/reminders.ts';
import { sendReminderEmail } from './email.ts';

if (LOCAL_ONLY) {
  console.warn('[triplanner-local] LOCAL_ONLY=1: Firebase no requerido; auth demo via x-user-id.');
} else {
  assertFirebaseEnv();
}

const databaseUrl = await resolveDatabaseUrl();
const db = await PgDb.connect(databaseUrl);

// Local bootstrapping: schema + catalogue table must exist before serving.
// In AWS both are provisioned by the wake workflow (migration/seed tasks).
if (BOOTSTRAP_LOCAL) {
  await migrate(databaseUrl);
  await ensureTable();
}
await ensureDemoUser(db);

const catalogue = createCatalogue();
const storage = defaultStorage();
const pubsub = createPubSub() as unknown as PubSub;
const hasdata = hasHasDataKey() ? new HasDataClient({ apiKey: HASDATA_API_KEY }) : null;

const internalRouter = createInternalRouter({ db, catalogue, hasdata, internalToken: INTERNAL_TOKEN });

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
    return { db, catalogue, storage, pubsub, hasdata, currentUserId };
  },
  graphiql: true,
});

const server = createServer((req, res) => {
  if (internalRouter(req, res)) return;
  void serveUploads(req, res, storage)
    .then((handled) => {
      if (!handled) yoga(req, res);
    })
    .catch((err) => {
      console.error('[uploads] error:', err instanceof Error ? err.message : err);
      if (!res.headersSent) res.writeHead(500).end('Internal error');
    });
});

server.listen(PORT, () => {
  console.log(`[triplanner-local] GraphQL en http://localhost:${PORT}/graphql`);
  console.log(`[triplanner-local] HasData key: ${hasHasDataKey() ? 'presente' : 'ausente'}`);
  if (isUsingDefaultInternalToken()) {
    console.warn(
      '[triplanner-local] INTERNAL_TOKEN no definido: usando default de desarrollo (define INTERNAL_TOKEN en local/.env)',
    );
  }
});

// Reminder sweep every minute (email 1h before start).
if (process.env.REMINDERS_DISABLED !== '1') {
  setInterval(() => {
    sweepOnce(db, sendReminderEmail).catch((e) => {
      console.error('[reminders] barrido fallido:', e instanceof Error ? e.message : e);
    });
  }, 60_000);
}
