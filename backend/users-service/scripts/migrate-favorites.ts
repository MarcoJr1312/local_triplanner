// One-time copy of platform `user_favorites` into the users service.
//
// Dry-run by default:
//   LEGACY_DATABASE_URL=... USERS_DATABASE_URL=... bun scripts/migrate-favorites.ts
// Apply:
//   ... APPLY=1 bun scripts/migrate-favorites.ts
//
// Requirements: the users service schema must be migrated first, and both
// databases should be backed up. The copy is additive and idempotent; the
// platform table is dropped separately after Gate 2.

import { Client } from 'pg';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FavoriteMigrationOptions {
  legacyUrl: string;
  usersUrl: string;
  apply: boolean;
  log?: (message: string) => void;
}

export interface FavoriteMigrationReport {
  applied: boolean;
  read: number;
  copied: number;
  alreadyPresent: number;
  skippedInvalidUser: number;
  skippedMissingUser: number;
  skippedInvalidLocation: number;
}

interface LegacyFavorite {
  user_id: string;
  location_id: string;
  created_at: string;
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  );
  return Boolean(rows[0]?.exists);
}

async function readLegacy(client: Client): Promise<LegacyFavorite[]> {
  if (!(await tableExists(client, 'user_favorites'))) return [];
  const { rows } = await client.query<LegacyFavorite>(
    `SELECT user_id, location_id, created_at::text
       FROM user_favorites
      ORDER BY created_at ASC, user_id ASC, location_id ASC`,
  );
  return rows;
}

async function readUserIds(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>('SELECT id::text FROM users');
  return new Set(rows.map((row) => row.id));
}

export async function migrateFavorites(
  options: FavoriteMigrationOptions,
): Promise<FavoriteMigrationReport> {
  const log = options.log ?? ((message: string) => console.log(message));
  const legacy = new Client({ connectionString: options.legacyUrl });
  const users = new Client({ connectionString: options.usersUrl });
  await Promise.all([legacy.connect(), users.connect()]);

  const report: FavoriteMigrationReport = {
    applied: options.apply,
    read: 0,
    copied: 0,
    alreadyPresent: 0,
    skippedInvalidUser: 0,
    skippedMissingUser: 0,
    skippedInvalidLocation: 0,
  };

  try {
    const source = await readLegacy(legacy);
    const userIds = await readUserIds(users);
    report.read = source.length;

    const valid: LegacyFavorite[] = [];
    for (const row of source) {
      const userId = String(row.user_id);
      const locationId = String(row.location_id ?? '').trim();
      if (!UUID_RE.test(userId)) {
        report.skippedInvalidUser += 1;
        continue;
      }
      if (!userIds.has(userId)) {
        report.skippedMissingUser += 1;
        continue;
      }
      if (locationId.length < 1 || locationId.length > 128) {
        report.skippedInvalidLocation += 1;
        continue;
      }
      valid.push({ ...row, user_id: userId, location_id: locationId });
    }

    if (options.apply && valid.length > 0) {
      await users.query('BEGIN');
      try {
        for (const row of valid) {
          const result = await users.query(
            `INSERT INTO favorite_locations (user_id, location_id, created_at)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [row.user_id, row.location_id, row.created_at],
          );
          if (result.rowCount === 1) report.copied += 1;
          else report.alreadyPresent += 1;
        }
        await users.query('COMMIT');
      } catch (error) {
        await users.query('ROLLBACK');
        throw error;
      }
    } else if (!options.apply) {
      report.copied = valid.length;
    }

    log(
      `[favorites] ${options.apply ? 'copied' : 'would copy'} ${report.copied}/${report.read}; ` +
        `already_present=${report.alreadyPresent} invalid_user=${report.skippedInvalidUser} ` +
        `missing_user=${report.skippedMissingUser} invalid_location=${report.skippedInvalidLocation}`,
    );
    return report;
  } finally {
    await Promise.allSettled([legacy.end(), users.end()]);
  }
}

if (import.meta.main) {
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  const usersUrl = process.env.USERS_DATABASE_URL?.trim();
  if (!legacyUrl || !usersUrl) {
    console.error('Set LEGACY_DATABASE_URL and USERS_DATABASE_URL.');
    process.exit(1);
  }
  await migrateFavorites({
    legacyUrl,
    usersUrl,
    apply: process.env.APPLY === '1',
  });
}
