// Configuracion del servicio de catalogo. El servicio solo depende de MongoDB
// y del token interno; no conoce Postgres, el agente ni el broker.

import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch {
  // .env opcional: la config tambien puede venir del entorno del proceso.
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function resolveSeedPath(): string {
  const explicit = process.env.SEED_DATA_PATH;
  if (explicit) return explicit;
  const candidates = [
    path.resolve(__dirname, '..', '..', 'db', 'toronto-locations.json'),
    path.resolve(__dirname, '..', 'db', 'toronto-locations.json'),
    '/app/db/toronto-locations.json',
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function resolveSettingsPath(): string {
  const explicit = process.env.SETTINGS_FILE;
  if (explicit) return explicit;
  const candidates = [
    path.resolve(__dirname, '..', '.data', 'locations.json'),
    '/app/.data/locations.json',
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function buildMongoUrl(): string {
  const host = process.env.MONGODB_HOST ?? '127.0.0.1:27017';
  const db = process.env.MONGODB_DB ?? 'triplanner';
  const username = (process.env.MONGODB_USERNAME ?? '').trim();
  const password = process.env.MONGODB_PASSWORD ?? '';
  if (!username) return `mongodb://${host}/${db}`;
  const authSource = process.env.MONGODB_AUTH_SOURCE ?? 'admin';
  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}/${db}?authSource=${authSource}`;
}

export const PORT = Number(process.env.PORT ?? 4300);
export const MONGODB_URL = process.env.MONGODB_URL ?? buildMongoUrl();
export const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION ?? 'locations';
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';
export const SEED_CATALOGUE = booleanEnv(process.env.SEED_CATALOGUE, true);
export const SEED_DATA_PATH = resolveSeedPath();
export const SEED_STARTUP_TIMEOUT_MS = Number(process.env.SEED_ON_STARTUP_TIMEOUT_MS ?? 30_000);
export const MONGO_CONNECT_ATTEMPTS = Number(process.env.MONGO_CONNECT_ATTEMPTS ?? 30);
export const MONGO_CONNECT_DELAY_MS = Number(process.env.MONGO_CONNECT_DELAY_MS ?? 500);

// ---- HasData BYOK (optional runtime provider) ----
export const HASDATA_API_BASE =
  process.env.HASDATA_API_BASE ?? 'https://api.hasdata.com/scrape/google-maps';
export const HASDATA_API_KEY = (process.env.HASDATA_API_KEY ?? '').trim();
export const HASDATA_TIMEOUT_MS = Number(process.env.HASDATA_TIMEOUT_MS ?? 8_000);
// Cached HasData rows expire after 5 days by default. The Mongo TTL index uses
// the row's expires_at field; preloaded rows keep expires_at=null.
export const HASDATA_CACHE_TTL_HOURS = Math.max(
  Number(process.env.HASDATA_CACHE_TTL_HOURS ?? 120),
  1,
);
export const HASDATA_CACHE_TTL_MS = HASDATA_CACHE_TTL_HOURS * 60 * 60 * 1000;
export const HASDATA_HL = process.env.HASDATA_HL ?? 'en';
export const HASDATA_GL = process.env.HASDATA_GL ?? 'ca';
export const SETTINGS_FILE = process.env.SETTINGS_FILE ?? resolveSettingsPath();

export function isUsingDefaultInternalToken(): boolean {
  return !process.env.INTERNAL_TOKEN;
}

export function verifyInternalToken(provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
