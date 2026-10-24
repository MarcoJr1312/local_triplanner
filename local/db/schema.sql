-- Triplanner local database schema (SQLite, node:sqlite built-in)
-- Fuente unica de verdad para el esquema. El archivo .sqlite NO se commitea.
-- Idempotente: se puede re-ejecutar sin duplicar (CREATE TABLE IF NOT EXISTS + seed INSERT OR IGNORE).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================= USERS =============================
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  color           TEXT,
  avatar_url      TEXT,
  language        TEXT NOT NULL DEFAULT 'es',
  firebase_uid    TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  welcome_sent_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Dos usuarios no comparten firebase_uid; parcial para permitir multiples NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;

-- =========================== LOCATIONS ===========================
-- Guarda destinos (parent_id NULL, slug set, category NULL) y lugares/actividades
-- (parent_id -> destino; category SIEMPRE una de sight|food|activity|nightlife para lugares).
-- Es la cache de HasData: todo resultado externo se normaliza aqui (place_id unico).
CREATE TABLE IF NOT EXISTS locations (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'hasdata')),
  place_id          TEXT UNIQUE,
  data_id           TEXT,
  slug              TEXT UNIQUE,
  name              TEXT NOT NULL,
  category          TEXT CHECK (category IN ('sight', 'food', 'activity', 'nightlife')),
  raw_type          TEXT,
  country           TEXT,
  description       TEXT,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  address           TEXT,
  rating            REAL,
  rating_count      INTEGER,
  hours_json        TEXT,
  website_url       TEXT,
  social_links_json TEXT,
  phone             TEXT,
  price_level       TEXT,
  image_url         TEXT,
  cost              REAL,
  tags_json         TEXT,
  duration_hours    REAL,
  parent_id         TEXT REFERENCES locations(id),
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_parent   ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_category ON locations(category);
CREATE INDEX IF NOT EXISTS idx_locations_source   ON locations(source);
CREATE INDEX IF NOT EXISTS idx_locations_slug     ON locations(slug);

-- ====================== FTS5 (busqueda tipada) =====================
-- Indice de texto completo sobre name/description de locations.
CREATE VIRTUAL TABLE IF NOT EXISTS locations_fts USING fts5(
  location_id UNINDEXED,
  name,
  description
);

-- ============================= TRIPS =============================
CREATE TABLE IF NOT EXISTS trips (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  destination_id   TEXT REFERENCES locations(id),
  destination_name TEXT,
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  total_budget     REAL NOT NULL DEFAULT 0,
  cover_preset     TEXT,
  cover_photo_url  TEXT,
  -- Zona horaria IANA del viaje (ej. America/Panama). Base para recordatorios.
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  owner_id         TEXT NOT NULL REFERENCES users(id),
  invite_code      TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id);

-- ========================== TRIP MEMBERS ==========================
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id   TEXT NOT NULL REFERENCES trips(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);

-- =========================== TRIP ITEMS ===========================
-- "spent" SIEMPRE se calcula (SUM de cost), nunca es columna redundante.
CREATE TABLE IF NOT EXISTS trip_items (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips(id),
  location_id TEXT REFERENCES locations(id),
  location_text TEXT,
  title      TEXT NOT NULL,
  category   TEXT,
  cost       REAL NOT NULL DEFAULT 0,
  day        TEXT NOT NULL,
  "order"    INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  notes      TEXT,
  image_url  TEXT,
  created_by TEXT,
  -- Recordatorios por email (M1): 1h antes del inicio en la tz del viaje.
  -- reminder_sent=1 es terminal (enviado, vencido o desactivado): nunca duplica.
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  reminder_sent    INTEGER NOT NULL DEFAULT 0,
  reminder_due_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_trip_items_trip ON trip_items(trip_id);

-- =========================== INVITATIONS ==========================
-- Invitaciones por email (Resend). Codigo unico ligado al email del
-- destinatario: solo ese email puede aceptarla y solo se puede usar una vez.
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

-- =========================== ITEM ATTACHMENTS ==========================
-- Boletos/adjuntos subidos por el usuario a una actividad guardada (item).
CREATE TABLE IF NOT EXISTS item_attachments (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES trip_items(id),
  file_name  TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  path       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- 'legacy' = previo a M1 (visible a todos los miembros); 'private'|'shared' M1.
  visibility TEXT NOT NULL DEFAULT 'legacy'
);

CREATE INDEX IF NOT EXISTS idx_item_attachments_item ON item_attachments(item_id);

-- ======================= ATTACHMENT VIEWERS ========================
-- Visibilidad por archivo: uploader implicito + miembros otorgados.
-- Sin filas para un adjunto = legacy (visible para todos los miembros).
-- Con filas = solo uploader + users listados.
CREATE TABLE IF NOT EXISTS attachment_viewers (
  attachment_id TEXT NOT NULL REFERENCES item_attachments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (attachment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_viewers_user ON attachment_viewers(user_id);

-- =========================== USER FAVORITES ==========================
-- Favoritos personales de lugares (corazon). Por usuario, nunca global.
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id     TEXT NOT NULL REFERENCES users(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, location_id)
);

-- ========================== USER INTERESTS ==========================
-- Intereses declarados por el usuario (chips o texto libre). Verdad del CRUD
-- en SQLite; Chroma (agente) es solo un indice semantico sincronizado.
CREATE TABLE IF NOT EXISTS user_interests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  term       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('picked', 'custom')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, term)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests(user_id);

-- ========================= SUGGESTION CHATS ==========================
-- Historial de chats de sugerencias (agente M3) por (trip, user, day).
-- messages es JSON ([{role, content}]). Upsert idempotente por (trip_id, user_id, day).
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
