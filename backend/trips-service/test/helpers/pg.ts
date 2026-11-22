import { connect, type Db } from '../../src/db.ts';
import { loadConfig } from '../../src/env.ts';

// Local throwaway Postgres for the service tests. CI overrides this with
// TEST_TRIPS_DATABASE_URL (or TRIPS_DATABASE_URL).
const DEFAULT_TEST_URL = 'postgres://trips:trips@127.0.0.1:55432/trips';

export async function connectTestDb(): Promise<Db | null> {
  const url =
    process.env.TEST_TRIPS_DATABASE_URL ??
    process.env.TRIPS_DATABASE_URL ??
    DEFAULT_TEST_URL;

  const config = loadConfig({
    TRIPS_DATABASE_URL: url,
    INTERNAL_TOKEN: 'test-token',
    DB_CONNECT_ATTEMPTS: '1',
    DB_CONNECT_DELAY_MS: '0',
  });

  try {
    return await connect(config);
  } catch {
    return null;
  }
}

export async function resetSchema(db: Db): Promise<void> {
  await db.exec(
    'DROP TABLE IF EXISTS outbox, invitations, trip_items, trip_members, trips, schema_migrations CASCADE',
  );
}
