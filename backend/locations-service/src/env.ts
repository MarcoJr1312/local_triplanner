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

export const PORT = Number(process.env.PORT ?? 4300);
export const MONGODB_URL = process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017/triplanner';
export const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION ?? 'locations';
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';
export const SEED_CATALOGUE = booleanEnv(process.env.SEED_CATALOGUE, true);
export const SEED_DATA_PATH = resolveSeedPath();
export const SEED_STARTUP_TIMEOUT_MS = Number(process.env.SEED_ON_STARTUP_TIMEOUT_MS ?? 30_000);
export const MONGO_CONNECT_ATTEMPTS = Number(process.env.MONGO_CONNECT_ATTEMPTS ?? 30);
export const MONGO_CONNECT_DELAY_MS = Number(process.env.MONGO_CONNECT_DELAY_MS ?? 500);

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
