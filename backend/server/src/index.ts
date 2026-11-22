// GraphQL server (graphql-yoga) on Postgres + MongoDB + local storage.

import { createYoga, createSchema, createPubSub } from 'graphql-yoga';
import { createServer } from 'node:http';
import { loadTypeDefs } from './schema.ts';
import { resolvers, type Ctx, type PubSub } from './resolvers.ts';
import { PgDb } from './pg/db.ts';
import { migrate } from './db/migrate.ts';
import { resolveDatabaseUrl } from './pg/config.ts';
import { getCurrentUserId } from './pg/auth.ts';
import { createCatalogue } from './catalogue/index.ts';
import { guardCatalogue } from './catalogue/guard.ts';
import { defaultStorage } from './storage.ts';
import {
  PORT,
  INTERNAL_TOKEN,
  isUsingDefaultInternalToken,
  BOOTSTRAP_LOCAL,
  TRIPS_URL,
  TRIPS_TIMEOUT_MS,
  USERS_MODE,
  USERS_URL,
  USERS_TIMEOUT_MS,
} from './env.ts';
import { createInternalRouter } from './internal.ts';
import { serveUploads } from './uploads.ts';
import { createTripsStore } from './trips/index.ts';
import { createUsersStore } from './users/index.ts';
import { ensureLocalDemoUsers } from './users/local.ts';

const databaseUrl = await resolveDatabaseUrl();
const db = await PgDb.connect(databaseUrl);

// Local bootstrapping: schema must exist before serving.
if (BOOTSTRAP_LOCAL) {
  await migrate(databaseUrl);
}

const users = createUsersStore({
  mode: USERS_MODE,
  db,
  baseUrl: USERS_URL,
  internalToken: INTERNAL_TOKEN,
  timeoutMs: USERS_TIMEOUT_MS,
});

// Demo identities live in the users service in remote mode.
if (USERS_MODE === 'local') {
  await ensureLocalDemoUsers(db);
}

const catalogue = await createCatalogue();
const gqlCatalogue = guardCatalogue(catalogue);
const storage = defaultStorage();
const pubsub = createPubSub() as unknown as PubSub;

const trips = createTripsStore({
  baseUrl: TRIPS_URL,
  internalToken: INTERNAL_TOKEN,
  timeoutMs: TRIPS_TIMEOUT_MS,
});

const internalRouter = createInternalRouter({ db, catalogue, internalToken: INTERNAL_TOKEN, trips, users });

const schema = createSchema({
  typeDefs: loadTypeDefs(),
  resolvers,
});

const yoga = createYoga({
  schema,
  context: async ({ request }: { request: Request }): Promise<Ctx> => ({
    db,
    catalogue: gqlCatalogue,
    storage,
    pubsub,
    trips,
    users,
    currentUserId: getCurrentUserId(request),
  }),
  graphiql: true,
});

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
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
  console.log(`[triplanner-local] trips url=${TRIPS_URL}`);
  console.log(`[triplanner-local] users mode=${USERS_MODE} url=${USERS_URL}`);
  if (isUsingDefaultInternalToken()) {
    console.warn(
      '[triplanner-local] INTERNAL_TOKEN no definido: usando default de desarrollo (define INTERNAL_TOKEN en backend/.env)',
    );
  }
});

// Reminder emails are intentionally disabled in the local demo: there is no
// email provider. The recruiter tests invitations through the copyable link.
