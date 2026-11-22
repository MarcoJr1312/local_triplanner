// Carga de configuracion del entorno local.
// Firebase y Resend se eliminaron; el buscador usa solo el catalogo local.

import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

try {
  process.loadEnvFile(ENV_PATH);
} catch {
  // .env opcional: la config tambien puede venir del entorno del proceso
}

// ---- Base publica para los links de invitacion ----
export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// ---- Servicio de catalogo (locations/activities, :4300) ----
export const LOCATIONS_URL = (process.env.LOCATIONS_URL ?? 'http://127.0.0.1:4300').replace(/\/+$/, '');
export const LOCATIONS_TIMEOUT_MS = Number(process.env.LOCATIONS_TIMEOUT_MS ?? 2000);

export const PORT = Number(process.env.LOCAL_PORT ?? 4000);

// ---- Servicio agente (FastAPI, :4100) ----
export const AGENT_BASE_URL = (process.env.AGENT_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');

// ---- Servicio de email (Kafka consumer + BYOK settings, :4200) ----
export const EMAIL_SERVICE_URL = (process.env.EMAIL_SERVICE_URL ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');

// ---- Trips service (:4400) ----
// The service owns trips, memberships, items and invitations. The API always
// calls it (remote-only after the M9.11 decommission).
export const TRIPS_URL = (process.env.TRIPS_URL ?? 'http://127.0.0.1:4400').replace(/\/+$/, '');
// Must exceed the trips service's own locations timeout (2 s) plus DB work.
export const TRIPS_TIMEOUT_MS = Number(process.env.TRIPS_TIMEOUT_MS ?? 5000);

// ---- Users service (:4500) ----
// The service owns accounts and notifications. The API always calls it.
export const USERS_URL = (process.env.USERS_URL ?? 'http://127.0.0.1:4500').replace(/\/+$/, '');
export const USERS_TIMEOUT_MS = Number(process.env.USERS_TIMEOUT_MS ?? 3000);

// ---- Token interno (endpoints REST /internal/*) ----
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';

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

// Local bootstrapping: schema + catalogue table on boot. The Compose stack
// keeps this on by default; set BOOTSTRAP_LOCAL=0 when an init job owns it.
export const BOOTSTRAP_LOCAL = process.env.BOOTSTRAP_LOCAL !== '0';

// ---- Adjuntos: secreto de firma de URLs (HMAC) ----
export const ATTACHMENT_TOKEN_SECRET = process.env.ATTACHMENT_TOKEN_SECRET || 'dev-attachment-secret';
