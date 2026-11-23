// One-time copy from the legacy platform Postgres to the trips service DB.
//
// Usage:
//   LEGACY_DATABASE_URL=... TRIPS_DATABASE_URL=... bun scripts/import-legacy.ts
//
// Idempotent: ON CONFLICT DO NOTHING. The outbox is intentionally NOT copied:
// legacy invitations were already handled by the API publisher, and replaying
// them would resend emails.
//
// The source must be frozen (stop the API) while this runs. The script verifies
// that every source key exists in the target and that the key checksums match.

import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();

interface TableSpec {
  name: string;
  /** SQL expression used as the identity/key for verification. */
  key: string;
  columns: string[];
  conflict: string;
}

const TABLES: TableSpec[] = [
  {
    name: 'trips',
    key: 'id',
    columns: [
      'id',
      'name',
      'destination_id',
      'destination_name',
      'destination_lat',
      'destination_lng',
      'start_date',
      'end_date',
      'total_budget',
      'cover_preset',
      'cover_photo_url',
      'timezone',
      'owner_id',
      'invite_code',
      'created_at',
      'updated_at',
    ],
    conflict: '(id)',
  },
  {
    name: 'trip_members',
    key: "trip_id || ':' || user_id",
    columns: ['trip_id', 'user_id', 'role', 'joined_at', 'invited_email'],
    conflict: '(trip_id, user_id)',
  },
  {
    name: 'trip_items',
    key: 'id',
    columns: [
      'id',
      'trip_id',
      'location_id',
      'location_text',
      'location_name',
      'location_address',
      'lat',
      'lng',
      'title',
      'category',
      'cost',
      'day',
      '"order"',
      'start_time',
      'notes',
      'image_url',
      'created_by',
      'created_at',
    ],
    conflict: '(id)',
  },
  {
    name: 'invitations',
    key: 'id',
    columns: [
      'id',
      'trip_id',
      'email',
      'code',
      'role',
      'status',
      'created_by',
      'created_at',
      'accepted_at',
    ],
    conflict: '(id)',
  },
];

function checksum(keys: readonly string[]): string {
  return createHash('md5').update([...keys].sort().join('\n')).digest('hex');
}

async function main(): Promise<void> {
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  const targetUrl = process.env.TRIPS_DATABASE_URL?.trim();
  if (!legacyUrl || !targetUrl) {
    console.error('LEGACY_DATABASE_URL and TRIPS_DATABASE_URL are required.');
    process.exitCode = 1;
    return;
  }
  if (legacyUrl === targetUrl) {
    console.error('LEGACY_DATABASE_URL and TRIPS_DATABASE_URL must be different databases.');
    process.exitCode = 1;
    return;
  }

  const legacy = new Pool({ connectionString: legacyUrl });
  const target = new Pool({ connectionString: targetUrl });

  try {
    for (const spec of TABLES) {
      const source = await legacy.query<Record<string, unknown>>(
        `SELECT ${spec.columns.join(', ')} FROM ${spec.name} ORDER BY ${spec.key}`,
      );

      const rows = source.rows;
      const keys = rows.map((row) => {
        const keyColumn = spec.key.includes('||') ? null : spec.key;
        if (keyColumn) return String(row[keyColumn]);
        return `${String(row.trip_id)}:${String(row.user_id)}`;
      });

      await target.query('BEGIN');
      try {
        for (const row of rows) {
          const values = spec.columns.map((column) => row[column.replaceAll('"', '')]);
          const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
          await target.query(
            `INSERT INTO ${spec.name} (${spec.columns.join(', ')})
             VALUES (${placeholders})
             ON CONFLICT ${spec.conflict} DO NOTHING`,
            values,
          );
        }
        await target.query('COMMIT');
      } catch (error) {
        await target.query('ROLLBACK');
        throw error;
      }

      const present = await target.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${spec.name} WHERE (${spec.key}) = ANY($1::text[])`,
        [keys],
      );
      const targetKeys = await target.query<{ key: string }>(
        `SELECT (${spec.key})::text AS key FROM ${spec.name} WHERE (${spec.key}) = ANY($1::text[])`,
        [keys],
      );

      const expected = checksum(keys);
      const actual = checksum(targetKeys.rows.map((row) => row.key));
      if (Number(present.rows[0]?.count ?? 0) !== keys.length || expected !== actual) {
        throw new Error(
          `${spec.name}: verification failed (source=${keys.length}, target=${present.rows[0]?.count}, checksum ${expected} != ${actual})`,
        );
      }

      console.log(
        `[trips:import] ${spec.name}: ${keys.length} rows, checksum ${expected.slice(0, 12)}`,
      );
    }

    console.log('[trips:import] done; outbox was not copied (legacy events already handled)');
  } finally {
    await legacy.end();
    await target.end();
  }
}

await main();
