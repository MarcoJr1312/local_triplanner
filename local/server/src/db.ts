// Conexion a SQLite (node:sqlite built-in) + helpers de persistencia/upsert/FTS.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, LocationRow, UpsertLocationInput } from './schema-types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.resolve(__dirname, '..', '..', 'db', 'triplanner.sqlite');

// Migracion idempotente para bases existentes (sin framework de migraciones):
// la DDL canonica vive en db/schema.sql; aqui se replica para que el server
// la aplique al boot si la tabla falta.
const INVITATIONS_DDL = `
CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id),
  email       TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_trip ON invitations(trip_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
`;

const ATTACHMENTS_DDL = `
CREATE TABLE IF NOT EXISTS item_attachments (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES trip_items(id),
  file_name  TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  path       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  visibility TEXT NOT NULL DEFAULT 'legacy'
);
CREATE INDEX IF NOT EXISTS idx_item_attachments_item ON item_attachments(item_id);
`;

const ATTACHMENT_VIEWERS_DDL = `
CREATE TABLE IF NOT EXISTS attachment_viewers (
  attachment_id TEXT NOT NULL REFERENCES item_attachments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (attachment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attachment_viewers_user ON attachment_viewers(user_id);
`;

const FAVORITES_DDL = `
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id     TEXT NOT NULL REFERENCES users(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, location_id)
);
`;

const USER_INTERESTS_DDL = `
CREATE TABLE IF NOT EXISTS user_interests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  term       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('picked', 'custom')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, term)
);
CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests(user_id);
`;

const SUGGESTION_CHATS_DDL = `
CREATE TABLE IF NOT EXISTS suggestion_chats (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  messages   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_suggestion_chats_trip_user_day ON suggestion_chats(trip_id, user_id, day);
`;

export function openDb(): Db {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(INVITATIONS_DDL);
  db.exec(ATTACHMENTS_DDL);
  db.exec(ATTACHMENT_VIEWERS_DDL);
  migrateAttachmentVisibility(db);
  db.exec(FAVORITES_DDL);
  db.exec(USER_INTERESTS_DDL);
  db.exec(SUGGESTION_CHATS_DDL);
  migrateAvatarUrl(db);
  migrateUserLanguage(db);
  migrateFirebaseAuth(db);
  migrateTripCover(db);
  migrateActivityReminders(db);
  migrateItemLocationText(db);
  return db;
}

// Migracion idempotente: users.avatar_url (foto de perfil). ALTER TABLE ADD
// COLUMN no soporta IF NOT EXISTS, asi que se chequea pragma_table_info.
export function migrateAvatarUrl(db: Db): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'avatar_url')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
  }
}

// Migracion idempotente: users.language (idioma de la UI, 'es' | 'en').
// SQLite permite ADD COLUMN NOT NULL con DEFAULT no nulo sobre tablas existentes.
export function migrateUserLanguage(db: Db): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'language')) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'es'");
  }
}

// Migracion idempotente: columnas de vinculacion con Firebase Auth (M2).
// - firebase_uid: uid del IdP; NULL hasta el primer login (indice unico parcial).
// - email_verified: espejo de claims.email_verified (0/1).
// - welcome_sent_at: NULL = email de bienvenida aun no enviado (idempotencia).
export function migrateFirebaseAuth(db: Db): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('firebase_uid')) {
    db.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT');
  }
  if (!has('email_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!has('welcome_sent_at')) {
    db.exec('ALTER TABLE users ADD COLUMN welcome_sent_at TEXT');
  }
  // La columna ya existe (existia o la acabamos de crear): indice unico parcial.
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL'
  );
}

// Migracion idempotente: columnas de portada del viaje (M1).
// - cover_preset: id de un preset de gradiente permitido (ver src/covers.ts).
// - cover_photo_url: ruta relativa /uploads/covers/<tripId>/<uuid>.<ext>.
export function migrateTripCover(db: Db): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('trips')").all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('cover_preset')) {
    db.exec('ALTER TABLE trips ADD COLUMN cover_preset TEXT');
  }
  if (!has('cover_photo_url')) {
    db.exec('ALTER TABLE trips ADD COLUMN cover_photo_url TEXT');
  }
}

// Migracion idempotente: recordatorios de actividad (M1).
// - trips.timezone: zona IANA del viaje; los items se interpretan en ella.
// - trip_items.reminder_enabled: preferencia por actividad (1 = activado).
// - trip_items.reminder_sent: 1 = terminal (enviado, vencido o desactivado).
// - trip_items.reminder_due_at: instante UTC (ISO) en que toca enviar.
export function migrateActivityReminders(db: Db): void {
  const tripCols = db.prepare("SELECT name FROM pragma_table_info('trips')").all() as { name: string }[];
  if (!tripCols.some((c) => c.name === 'timezone')) {
    db.exec("ALTER TABLE trips ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
  }
  const itemCols = db.prepare("SELECT name FROM pragma_table_info('trip_items')").all() as { name: string }[];
  const has = (name: string) => itemCols.some((c) => c.name === name);
  if (!has('reminder_enabled')) {
    db.exec('ALTER TABLE trip_items ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!has('reminder_sent')) {
    db.exec('ALTER TABLE trip_items ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0');
  }
  if (!has('reminder_due_at')) {
    db.exec('ALTER TABLE trip_items ADD COLUMN reminder_due_at TEXT');
  }
}

// Migracion idempotente: trip_items.location_text (ubicacion escrita a mano,
// alternativa a location_id cuando el lugar no esta en el catalogo).
export function migrateItemLocationText(db: Db): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('trip_items')").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'location_text')) {
    db.exec('ALTER TABLE trip_items ADD COLUMN location_text TEXT');
  }
}

// Migracion idempotente: item_attachments.visibility ('legacy' para filas
// existentes). ALTER TABLE ADD COLUMN no soporta IF NOT EXISTS.
export function migrateAttachmentVisibility(db: Db): void {
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('item_attachments')")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === 'visibility')) {
    db.exec("ALTER TABLE item_attachments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'legacy'");
  }
}

// ---- FTS5 sync ----

export function ftsSync(db: Db, locationId: string, name: string, description: string | null | undefined): void {
  db.prepare('DELETE FROM locations_fts WHERE location_id = ?').run(locationId);
  db.prepare(
    'INSERT INTO locations_fts (location_id, name, description) VALUES (?, ?, ?)'
  ).run(locationId, name, description ?? null);
}

// ---- upsert de lugares (cache HasData) ----
// place_id unico (o data_id como fallback); actualiza si ya existe, inserta si no.
// Mantiene el indice FTS5 sincronizado.

const UPDATE_LOCATION = `
  UPDATE locations SET
    source = :source,
    data_id = COALESCE(:data_id, data_id),
    name = :name,
    category = :category,
    raw_type = :raw_type,
    description = :description,
    lat = :lat,
    lng = :lng,
    address = :address,
    rating = :rating,
    rating_count = :rating_count,
    hours_json = :hours_json,
    website_url = :website_url,
    social_links_json = :social_links_json,
    phone = :phone,
    price_level = :price_level,
    image_url = :image_url,
    last_updated = :last_updated
  WHERE id = :id
`;

const INSERT_LOCATION = `
  INSERT INTO locations
    (id, source, place_id, data_id, slug, name, category, raw_type, country, description,
     lat, lng, address, rating, rating_count, hours_json, website_url, social_links_json,
     phone, price_level, image_url, cost, tags_json, duration_hours, parent_id, last_updated)
  VALUES
    (:id, :source, :place_id, :data_id, :slug, :name, :category, :raw_type, :country, :description,
     :lat, :lng, :address, :rating, :rating_count, :hours_json, :website_url, :social_links_json,
     :phone, :price_level, :image_url, :cost, :tags_json, :duration_hours, :parent_id, :last_updated)
`;

export function upsertLocation(db: Db, loc: UpsertLocationInput): LocationRow | undefined {
  let existingId: string | null = null;
  if (loc.place_id) {
    const row = db.prepare('SELECT id FROM locations WHERE place_id = ?').get(loc.place_id) as
      | { id: string }
      | undefined;
    existingId = row?.id ?? null;
  }
  if (!existingId && loc.data_id) {
    const row = db.prepare('SELECT id FROM locations WHERE data_id = ?').get(loc.data_id) as
      | { id: string }
      | undefined;
    existingId = row?.id ?? null;
  }

  const finalId = existingId ?? loc.id;
  // Solo pasar los parametros que la sentencia nombra (node:sqlite es estricto)
  const UPDATE_KEYS = ['source','data_id','name','category','raw_type','description','lat','lng',
    'address','rating','rating_count','hours_json','website_url','social_links_json','phone',
    'price_level','image_url','last_updated','id'] as const;
  const INSERT_KEYS = ['id','source','place_id','data_id','slug','name','category','raw_type',
    'country','description','lat','lng','address','rating','rating_count','hours_json',
    'website_url','social_links_json','phone','price_level','image_url','cost','tags_json',
    'duration_hours','parent_id','last_updated'] as const;
  const pickKeys = (obj: Record<string, unknown>, keys: readonly string[]): Record<string, SQLInputValue> =>
    Object.fromEntries(keys.map((k) => [k, (obj[k] ?? null) as SQLInputValue]));

  if (existingId) {
    db.prepare(UPDATE_LOCATION).run(pickKeys({ ...loc, id: finalId }, UPDATE_KEYS));
  } else {
    db.prepare(INSERT_LOCATION).run(pickKeys({ ...loc, id: finalId }, INSERT_KEYS));
  }
  ftsSync(db, finalId, loc.name, loc.description);
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(finalId) as LocationRow | undefined;
}
