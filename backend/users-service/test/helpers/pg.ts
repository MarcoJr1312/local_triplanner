import { connect, type Db } from '../../src/db.ts';
import { loadConfig } from '../../src/env.ts';

// Local throwaway Postgres for the service tests. CI overrides this with
// TEST_USERS_DATABASE_URL (or USERS_DATABASE_URL). Never point the default at
// the live `users` database: the suite drops and recreates its schema.
const DEFAULT_TEST_URL = 'postgres://users:users@127.0.0.1:55433/users_test';

export async function connectTestDb(): Promise<Db | null> {
  const url =
    process.env.TEST_USERS_DATABASE_URL ??
    process.env.USERS_DATABASE_URL ??
    DEFAULT_TEST_URL;

  const config = loadConfig({
    USERS_DATABASE_URL: url,
    INTERNAL_TOKEN: 'test-token',
    SEED_DEMO: 'false',
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
    'DROP TABLE IF EXISTS favorite_locations, notifications, users, schema_migrations CASCADE',
  );
}
