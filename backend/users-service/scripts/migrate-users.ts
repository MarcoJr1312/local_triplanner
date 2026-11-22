// Fixed-UUID users migration (M10.10).
//
// Moves identity from the platform text ids (`demo-user`, `demo-friend`, ...)
// to UUIDs, copies accounts into the users service and rewrites every reference
// in the platform and trips databases.
//
// Dry-run by default:
//   LEGACY_DATABASE_URL=... TRIPS_DATABASE_URL=... USERS_DATABASE_URL=... \
//     bun scripts/migrate-users.ts
// Apply:
//   ... APPLY=1 bun scripts/migrate-users.ts
//
// Requirements: stop the API and users service first (the script locks the
// tables), back up both databases, and let the users service migrate its schema.
// The run is transactional per database and safe to repeat.

import { createHash } from 'node:crypto';
import { Client } from 'pg';
import {
  DEMO_FRIEND_UUID,
  DEMO_PASSWORD,
  DEMO_USER_UUID,
} from '../src/db/seed.ts';

const FIXED_IDS: Record<string, { id: string; username: string; email: string }> = {
  'demo-user': {
    id: DEMO_USER_UUID,
    username: 'demo',
    email: 'demo@triplanner.local',
  },
  'demo-friend': {
    id: DEMO_FRIEND_UUID,
    username: 'demo-friend',
    email: 'friend@triplanner.local',
  },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export interface MigrationOptions {
  legacyUrl: string;
  tripsUrl: string;
  usersUrl: string;
  /** False performs every read and prints the plan without writing. */
  apply: boolean;
  log?: (message: string) => void;
}

export interface Mapping {
  oldId: string;
  newId: string;
  username: string;
  email: string | null;
  displayName: string;
  passwordHash: string | null;
  color: string | null;
  avatarUrl: string | null;
  language: string;
  createdAt: string;
  deletedAt: string | null;
  placeholder: boolean;
}

export interface MigrationReport {
  applied: boolean;
  users: number;
  mappings: Mapping[];
  placeholders: string[];
  warnings: string[];
  updated: Record<string, number>;
  verification: Record<string, string | number | boolean>;
}

interface SourceUser {
  id: string;
  username: string | null;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  language: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface ServiceUser {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Deterministic UUIDv5-style id for legacy ids that are not fixed demos. */
export function stableUuid(seed: string): string {
  const bytes = createHash('sha1').update(`triplanner:${seed}`).digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function slugUsername(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 28);
  if (slug.length >= 3 && /^[a-z0-9]/.test(slug)) return slug;
  return `user-${slug || 'demo'}`.slice(0, 32);
}

export function uniqueUsername(base: string, used: Set<string>): string {
  const root = slugUsername(base);
  let candidate = root;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `-${suffix}`;
    candidate = `${root.slice(0, 32 - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function columnType(
  client: Client,
  table: string,
  column: string,
): Promise<string | null> {
  const { rows } = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows[0]?.data_type ?? null;
}

async function collectIds(
  client: Client,
  table: string,
  column: string,
  cache: Map<string, Set<string>>,
): Promise<string[]> {
  let columns = cache.get(table);
  if (!columns) {
    columns = await tableColumns(client, table);
    cache.set(table, columns);
  }
  if (!columns.has(column)) return [];
  const { rows } = await client.query<{ id: string }>(
    `SELECT DISTINCT ${column} AS id FROM ${table}
      WHERE ${column} IS NOT NULL AND ${column} <> ''`,
  );
  return rows.map((row) => String(row.id));
}

async function updateReference(
  client: Client,
  table: string,
  column: string,
  columns: Map<string, Set<string>>,
  updated: Record<string, number>,
): Promise<void> {
  let known = columns.get(table);
  if (!known) {
    known = await tableColumns(client, table);
    columns.set(table, known);
  }
  if (!known.has(column)) return;

  const result = await client.query(
    `UPDATE ${table} t
        SET ${column} = m.new_id::text
       FROM user_id_map m
      WHERE t.${column} = m.old_id
        AND m.old_id <> m.new_id::text`,
  );
  const key = `${table}.${column}`;
  updated[key] = (updated[key] ?? 0) + (result.rowCount ?? 0);
}

async function dropUserForeignKeys(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string; constraint_name: string }>(
    `SELECT tc.table_name, tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'users'`,
  );
  for (const row of rows) {
    await client.query(
      `ALTER TABLE "${row.table_name.replace(/"/g, '""')}" DROP CONSTRAINT IF EXISTS "${row.constraint_name.replace(/"/g, '""')}"`,
    );
  }
  return rows.map((row) => `${row.table_name}.${row.constraint_name}`);
}

function buildMappings(
  legacy: SourceUser[],
  service: ServiceUser[],
  referenced: Set<string>,
): { mappings: Mapping[]; placeholders: string[]; warnings: string[] } {
  const serviceById = new Map(service.map((row) => [row.id, row]));
  const usedUsernames = new Set(service.map((row) => row.username.toLowerCase()));
  const usedEmails = new Map(
    service
      .filter((row) => row.email)
      .map((row) => [(row.email as string).toLowerCase(), row.id] as const),
  );

  const mappings: Mapping[] = [];
  const placeholders: string[] = [];
  const warnings: string[] = [];
  const legacyById = new Map(legacy.map((row) => [row.id, row]));

  const ordered: SourceUser[] = [...legacy];
  for (const id of referenced) {
    if (!legacyById.has(id)) {
      ordered.push({
        id,
        username: null,
        email: null,
        password_hash: null,
        display_name: id,
        color: null,
        avatar_url: null,
        language: 'es',
        created_at: new Date().toISOString(),
        deleted_at: null,
      });
    }
  }

  for (const source of ordered) {
    const fixed = FIXED_IDS[source.id];
    const newId = fixed?.id ?? (isUuid(source.id) ? source.id : stableUuid(source.id));
    const existing = serviceById.get(newId);
    const placeholder = !legacyById.has(source.id);

    let username: string;
    if (existing) {
      username = existing.username;
    } else if (fixed) {
      username = fixed.username;
      usedUsernames.add(username);
    } else {
      const base =
        source.username ??
        source.email?.split('@')[0] ??
        source.display_name ??
        `user-${newId.slice(0, 8)}`;
      username = uniqueUsername(base, usedUsernames);
    }

    const fixedEmail = fixed?.email ?? null;
    let email = normalizeEmail(existing?.email) ?? normalizeEmail(fixedEmail) ?? normalizeEmail(source.email);
    if (email) {
      const owner = usedEmails.get(email);
      if (owner && owner !== newId) {
        warnings.push(`email ${email} already belongs to ${owner}; ${source.id} keeps no email`);
        email = null;
      } else {
        usedEmails.set(email, newId);
      }
    }

    const passwordHash =
      existing?.password_hash ??
      (typeof source.password_hash === 'string' && source.password_hash.startsWith('$argon2')
        ? source.password_hash
        : null);

    if (placeholder) placeholders.push(source.id);

    mappings.push({
      oldId: source.id,
      newId,
      username,
      email,
      displayName: existing?.display_name ?? source.display_name ?? username,
      passwordHash,
      color: asText(source.color),
      avatarUrl: asText(source.avatar_url),
      language: source.language === 'en' ? 'en' : 'es',
      createdAt: source.created_at || new Date().toISOString(),
      deletedAt: source.deleted_at ?? null,
      placeholder,
    });
  }

  return { mappings, placeholders, warnings };
}

async function readPlatformUsers(client: Client): Promise<SourceUser[]> {
  const columns = await tableColumns(client, 'users');
  if (!columns.has('id')) throw new Error('legacy database has no users table');
  const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM users');
  return rows.map((row) => ({
    id: String(row.id),
    username: asText(row.username),
    email: asText(row.email),
    password_hash: asText(row.password_hash),
    display_name: asText(row.display_name) ?? String(row.id),
    color: asText(row.color),
    avatar_url: asText(row.avatar_url),
    language: asText(row.language),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? new Date().toISOString()),
    deleted_at:
      row.deleted_at instanceof Date
        ? row.deleted_at.toISOString()
        : asText(row.deleted_at),
  }));
}

async function readServiceUsers(client: Client): Promise<ServiceUser[]> {
  const columns = await tableColumns(client, 'users');
  if (!columns.has('id') || !columns.has('username')) {
    throw new Error('users service database is not migrated; run the users service first');
  }
  const { rows } = await client.query<ServiceUser>(
    'SELECT id, username, email, password_hash, display_name FROM users',
  );
  return rows;
}

async function createUserIdMap(
  client: Client,
  mappings: Mapping[],
  hashes: Map<string, string>,
): Promise<void> {
  await client.query(
    `CREATE TEMP TABLE user_id_map (
       old_id text PRIMARY KEY,
       new_id uuid NOT NULL,
       username text NOT NULL,
       email text,
       password_hash text
     ) ON COMMIT DROP`,
  );
  for (const mapping of mappings) {
    await client.query(
      `INSERT INTO user_id_map (old_id, new_id, username, email, password_hash)
       VALUES ($1, $2::uuid, $3, $4, $5)
       ON CONFLICT (old_id) DO NOTHING`,
      [
        mapping.oldId,
        mapping.newId,
        mapping.username,
        mapping.email,
        mapping.passwordHash ?? hashes.get(mapping.newId),
      ],
    );
  }
}

export async function migrateUsers(options: MigrationOptions): Promise<MigrationReport> {
  const log = options.log ?? ((message: string) => console.log(message));
  const legacy = new Client({ connectionString: options.legacyUrl });
  const trips = new Client({ connectionString: options.tripsUrl });
  const users = new Client({ connectionString: options.usersUrl });
  await Promise.all([legacy.connect(), trips.connect(), users.connect()]);

  try {
    const legacyUsers = await readPlatformUsers(legacy);
    const serviceUsers = await readServiceUsers(users);

    const legacyColumns = new Map<string, Set<string>>();
    const tripColumns = new Map<string, Set<string>>();
    const referenced = new Set<string>(legacyUsers.map((row) => row.id));

    const platformRefs: [string, string][] = [
      ['item_attachments', 'created_by'],
      ['attachment_viewers', 'user_id'],
      ['user_favorites', 'user_id'],
      ['user_interests', 'user_id'],
      ['suggestion_chats', 'user_id'],
      ['agent_embeddings', 'user_id'],
      ['notifications', 'user_id'],
      ['notifications', 'inviter_user_id'],
    ];
    for (const [table, column] of platformRefs) {
      for (const id of await collectIds(legacy, table, column, legacyColumns)) referenced.add(id);
    }

    const tripRefs: [string, string][] = [
      ['trips', 'owner_id'],
      ['trip_members', 'user_id'],
      ['trip_items', 'created_by'],
      ['invitations', 'created_by'],
      ['invitations', 'invitee_user_id'],
    ];
    for (const [table, column] of tripRefs) {
      for (const id of await collectIds(trips, table, column, tripColumns)) referenced.add(id);
    }

    const { mappings, placeholders, warnings } =
      buildMappings(legacyUsers, serviceUsers, referenced);

    log(
      `[migrate-users] ${mappings.length} identities (${placeholders.length} placeholders), ` +
        `${legacyUsers.length} platform users, ${warnings.length} warnings`,
    );
    for (const mapping of mappings) {
      log(
        `  ${mapping.oldId} -> ${mapping.newId} @${mapping.username}` +
          (mapping.placeholder ? ' (placeholder)' : ''),
      );
    }
    for (const warning of warnings) log(`  warning: ${warning}`);

    const report: MigrationReport = {
      applied: options.apply,
      users: legacyUsers.length,
      mappings,
      placeholders,
      warnings,
      updated: {},
      verification: {},
    };

    if (!options.apply) {
      log('[migrate-users] dry-run: no rows written (set APPLY=1 to apply)');
      return report;
    }

    // Hash temp passwords before taking locks.
    const hashes = new Map<string, string>();
    for (const mapping of mappings) {
      if (mapping.passwordHash) continue;
      hashes.set(
        mapping.newId,
        await Bun.password.hash(DEMO_PASSWORD, { algorithm: 'argon2id' }),
      );
    }

    // ---- users service: insert missing accounts ----
    await users.query('BEGIN');
    try {
      await users.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      for (const mapping of mappings) {
        if (serviceUsers.some((row) => row.id === mapping.newId)) continue;
        await users.query(
          `INSERT INTO users
             (id, username, email, password_hash, display_name, color, avatar_url,
              language, created_at, deleted_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            mapping.newId,
            mapping.username,
            mapping.email,
            mapping.passwordHash ?? hashes.get(mapping.newId),
            mapping.displayName,
            mapping.color,
            mapping.avatarUrl,
            mapping.language,
            mapping.createdAt,
            mapping.deletedAt,
          ],
        );
      }
      await users.query('COMMIT');
    } catch (error) {
      await users.query('ROLLBACK');
      throw error;
    }

    // ---- platform: references, users table ----
    const idType = await columnType(legacy, 'users', 'id');
    await legacy.query('BEGIN');
    try {
      await legacy.query('LOCK TABLE users IN ACCESS EXCLUSIVE MODE');
      const dropped = await dropUserForeignKeys(legacy);
      report.verification.foreign_keys_dropped = dropped.length;

      await createUserIdMap(legacy, mappings, hashes);

      await legacy.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS username text');
      await legacy.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text');
      await legacy.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz');
      await legacy.query('ALTER TABLE users ALTER COLUMN email DROP NOT NULL');

      for (const [table, column] of platformRefs) {
        await updateReference(legacy, table, column, legacyColumns, report.updated);
      }

      await legacy.query(
        `UPDATE users u
            SET username = m.username,
                email = m.email,
                password_hash = COALESCE(u.password_hash, m.password_hash)
           FROM user_id_map m
          WHERE ${idType === 'uuid' ? 'u.id::text = m.old_id' : 'u.id = m.old_id'}`,
      );

      if (idType !== 'uuid') {
        await legacy.query(
          `UPDATE users u SET id = m.new_id::text
             FROM user_id_map m
            WHERE u.id = m.old_id AND m.old_id <> m.new_id::text`,
        );
        await legacy.query('ALTER TABLE users ALTER COLUMN id TYPE uuid USING id::uuid');
      }

      await legacy.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active
           ON users (lower(username))
         WHERE deleted_at IS NULL AND username IS NOT NULL`,
      );
      await legacy.query('COMMIT');
    } catch (error) {
      await legacy.query('ROLLBACK');
      throw error;
    }

    // ---- trips: references only ----
    await trips.query('BEGIN');
    try {
      await createUserIdMap(trips, mappings, hashes);
      for (const [table, column] of tripRefs) {
        await updateReference(trips, table, column, tripColumns, report.updated);
      }
      await trips.query('COMMIT');
    } catch (error) {
      await trips.query('ROLLBACK');
      throw error;
    }

    // ---- verification ----
    const platformCount = await legacy.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM users',
    );
    report.verification.platform_users = platformCount.rows[0]?.count ?? 0;
    report.verification.expected_users = legacyUsers.length;

    const badIds = await legacy.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users
        WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    );
    report.verification.non_uuid_platform_ids = badIds.rows[0]?.count ?? 0;

    const serviceIds = new Set(
      (
        await users.query<{ id: string }>('SELECT id::text AS id FROM users')
      ).rows.map((row) => row.id),
    );
    const dangling: string[] = [];
    for (const [table, column] of [...platformRefs, ...tripRefs]) {
      const client = platformRefs.some(([t, c]) => t === table && c === column)
        ? legacy
        : trips;
      const cache = client === legacy ? legacyColumns : tripColumns;
      for (const id of await collectIds(client, table, column, cache)) {
        if (!serviceIds.has(id)) dangling.push(`${table}.${column}=${id}`);
      }
    }
    report.verification.dangling_references = dangling.length;
    if (dangling.length > 0) {
      report.warnings.push(`dangling references: ${dangling.slice(0, 10).join(', ')}`);
    }

    log(
      `[migrate-users] applied: ${report.verification.platform_users} platform users, ` +
        `${Object.keys(report.updated).length} columns updated, ` +
        `${report.verification.dangling_references} dangling references`,
    );
    for (const [key, value] of Object.entries(report.updated)) {
      log(`  ${key}: ${value} row(s)`);
    }
    return report;
  } finally {
    await Promise.all([
      legacy.end().catch(() => undefined),
      trips.end().catch(() => undefined),
      users.end().catch(() => undefined),
    ]);
  }
}

if (import.meta.main) {
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  const tripsUrl = process.env.TRIPS_DATABASE_URL?.trim();
  const usersUrl = process.env.USERS_DATABASE_URL?.trim();
  if (!legacyUrl || !tripsUrl || !usersUrl) {
    console.error(
      'LEGACY_DATABASE_URL, TRIPS_DATABASE_URL and USERS_DATABASE_URL are required.',
    );
    process.exit(1);
  }
  const apply = process.env.APPLY === '1';
  migrateUsers({ legacyUrl, tripsUrl, usersUrl, apply })
    .then((report) => {
      console.log(
        JSON.stringify({
          applied: report.applied,
          users: report.users,
          placeholders: report.placeholders.length,
          updated: report.updated,
          verification: report.verification,
        }),
      );
    })
    .catch((error) => {
      console.error('[migrate-users] failed:', error);
      process.exit(1);
    });
}
