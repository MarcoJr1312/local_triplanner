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

export const PORT = Number(process.env.LOCAL_PORT ?? 4000);

// ---- Servicio agente (FastAPI, :4100) ----
export const AGENT_BASE_URL = (process.env.AGENT_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');

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
