// Resolves the Postgres connection string.
// Local runner: DATABASE_URL or the documented local default. No cloud secrets.

import { DEFAULT_DATABASE_URL } from './db.ts';

export async function resolveDatabaseUrl(): Promise<string> {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}
